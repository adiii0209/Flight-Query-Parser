import json

import requests
from sqlalchemy import Integer, inspect
from flask import Blueprint, Response, jsonify, render_template, request, session

from extensions import db
from models_rbac import Role
from routes.auth import login_required

from . import photos, settings
from .models import HotelOffer, HotelOfferConfig
from .parser import call_llm, parse_offer

hotel_offers_bp = Blueprint(
    "hotel_offers", __name__,
    template_folder="templates",
    static_folder="static",
    static_url_path="/hotel-offers/static",
)

_tables_ready = False


def _ensure_tables():
    global _tables_ready
    if not _tables_ready:
        insp = inspect(db.engine)
        for model in (HotelOfferConfig, HotelOffer):
            name = model.__tablename__
            if insp.has_table(name):
                col = next(c for c in insp.get_columns(name) if c["name"] == "organization_id")
                if isinstance(col["type"], Integer):
                    # first release used an integer org id; org ids are UUID strings. Table was unusable, so rebuild.
                    model.__table__.drop(db.engine)
            model.__table__.create(db.engine, checkfirst=True)
        _tables_ready = True


@hotel_offers_bp.before_request
def _before():
    _ensure_tables()


def _org():
    return str(session.get("organization_id") or "")


def _is_admin():
    return session.get("role") in Role.ADMIN_ROLES


def _err(message, status=400):
    return jsonify({"error": message}), status


@hotel_offers_bp.route("/hotel-offers")
@login_required
def page():
    return render_template("hotel_offers/index.html", can_configure=_is_admin())


# ------------------------------------------------------------------ parse
@hotel_offers_bp.route("/api/hotel-offers/parse", methods=["POST"])
@login_required
def parse():
    text = ((request.get_json(silent=True) or {}).get("text") or "").strip()
    if len(text) < 20:
        return _err("Paste the hotel offer text first.")
    if len(text) > 20000:
        return _err("Text is too long.")
    cfg = settings.get_config(_org())
    try:
        data, source, warning = parse_offer(text, cfg)
    except Exception as exc:
        return _err(f"Parsing failed: {exc}", 502)
    return jsonify({"data": data, "source": source, "warning": warning})


# ------------------------------------------------------------------ photos
@hotel_offers_bp.route("/api/hotel-offers/photos")
@login_required
def photo_search():
    cfg = settings.get_config(_org())
    query = (request.args.get("q") or "").strip()
    if not query:
        return _err("Search text required.")
    source = request.args.get("source") or cfg["photo_default_source"]
    orientation = request.args.get("orientation", "landscape")
    if orientation not in ("landscape", "portrait", "squarish"):
        orientation = "landscape"
    try:
        page = max(int(request.args.get("page", 1)), 1)
    except ValueError:
        page = 1
    try:
        if source == "google":
            if not cfg["google_places_key"]:
                return _err("Google Places key is not configured (Settings).", 400)
            results = photos.search_google(query, cfg["google_places_key"], cfg["photo_per_page"])
        else:
            if not cfg["unsplash_access_key"]:
                return _err("Unsplash access key is not configured (Settings).", 400)
            results = photos.search_unsplash(query, cfg["unsplash_access_key"], orientation, cfg["photo_per_page"], page)
    except requests.HTTPError as exc:
        return _err(f"{source.title()} rejected the request ({exc.response.status_code}). Check the key.", 502)
    except requests.RequestException as exc:
        return _err(f"Could not reach {source.title()}: {exc}", 502)
    return jsonify({"results": results})


@hotel_offers_bp.route("/api/hotel-offers/photo")
@login_required
def photo_proxy():
    cfg = settings.get_config(_org())
    try:
        width = int(request.args.get("w", 0)) or None
        body, ctype = photos.fetch_proxied(request.args.get("src", ""), request.args.get("ref", ""), cfg, width)
    except (ValueError, requests.RequestException) as exc:
        return _err(str(exc), 400)
    return Response(body, content_type=ctype, headers={"Cache-Control": "private, max-age=86400"})


# ------------------------------------------------------------------ settings
@hotel_offers_bp.route("/api/hotel-offers/settings", methods=["GET"])
@login_required
def get_settings():
    return jsonify({"settings": settings.public_config(_org()), "can_configure": _is_admin()})


@hotel_offers_bp.route("/api/hotel-offers/settings", methods=["PUT"])
@login_required
def put_settings():
    if not _is_admin():
        return _err("Only admins can change these settings.", 403)
    settings.save_config(_org(), request.get_json(silent=True) or {})
    return jsonify({"settings": settings.public_config(_org())})


@hotel_offers_bp.route("/api/hotel-offers/settings/test", methods=["POST"])
@login_required
def test_settings():
    if not _is_admin():
        return _err("Only admins can test these settings.", 403)
    kind = (request.get_json(silent=True) or {}).get("kind")
    cfg = settings.get_config(_org())
    try:
        if kind == "ai":
            call_llm(cfg, "Test Hotel\nhttps://example.com/paris/\nDeluxe Room\nTotal EUR 1,000.00")
            return jsonify({"ok": True, "message": f"{cfg['ai_provider']} / {cfg['ai_model']} responded."})
        if kind == "unsplash":
            if not cfg["unsplash_access_key"]:
                return _err("No Unsplash key set.")
            photos.search_unsplash("hotel", cfg["unsplash_access_key"], per_page=1)
            return jsonify({"ok": True, "message": "Unsplash key works."})
        if kind == "google":
            if not cfg["google_places_key"]:
                return _err("No Google Places key set.")
            photos.search_google("Taj Lake Palace Udaipur", cfg["google_places_key"], 1)
            return jsonify({"ok": True, "message": "Google Places key works."})
    except requests.HTTPError as exc:
        return _err(f"Rejected ({exc.response.status_code}): {exc.response.text[:200]}", 502)
    except Exception as exc:
        return _err(str(exc), 502)
    return _err("Unknown test.")


# ------------------------------------------------------------------ saved offers
@hotel_offers_bp.route("/api/hotel-offers/offers", methods=["GET"])
@login_required
def list_offers():
    rows = HotelOffer.query.filter_by(organization_id=_org()).order_by(HotelOffer.updated_at.desc()).limit(100).all()
    return jsonify({"offers": [r.to_dict(with_data=False) for r in rows]})


@hotel_offers_bp.route("/api/hotel-offers/offers", methods=["POST"])
@login_required
def save_offer():
    body = request.get_json(silent=True) or {}
    data = body.get("data")
    if not isinstance(data, dict):
        return _err("Nothing to save.")
    blob = json.dumps(data)
    if len(blob) > 500_000:
        return _err("Offer is too large to save (remove uploaded photos).")
    title = (body.get("title") or data.get("hotel_name") or "Untitled offer")[:255]
    row = None
    if body.get("id"):
        row = HotelOffer.query.filter_by(id=body["id"], organization_id=_org()).first()
    if row is None:
        row = HotelOffer(organization_id=_org(), user_id=session.get("user_id"))
        db.session.add(row)
    row.title, row.data = title, blob
    db.session.commit()
    return jsonify({"offer": row.to_dict(with_data=False)})


@hotel_offers_bp.route("/api/hotel-offers/offers/<int:offer_id>", methods=["GET"])
@login_required
def get_offer(offer_id):
    row = HotelOffer.query.filter_by(id=offer_id, organization_id=_org()).first()
    return jsonify({"offer": row.to_dict()}) if row else _err("Not found", 404)


@hotel_offers_bp.route("/api/hotel-offers/offers/<int:offer_id>", methods=["DELETE"])
@login_required
def delete_offer(offer_id):
    row = HotelOffer.query.filter_by(id=offer_id, organization_id=_org()).first()
    if not row:
        return _err("Not found", 404)
    db.session.delete(row)
    db.session.commit()
    return jsonify({"ok": True})
