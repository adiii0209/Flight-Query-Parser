"""Public client page: no login. Lists live offers, serves poster pictures, records leads."""
import re
import time
from collections import defaultdict, deque
from datetime import date, datetime, timedelta
from urllib.parse import quote

from flask import Response, abort, jsonify, redirect, render_template, request

from extensions import db
from models_rbac import Organization

from . import notify, settings
from .models import HotelOfferLead, HotelOfferLive
from .routes import hotel_offers_bp as bp
from .routes_live import base_url, org_slug

_hits = defaultdict(deque)  # ip -> recent lead timestamps (per worker; enough to blunt casual abuse)


def _today():
    return (datetime.utcnow() + timedelta(hours=5, minutes=30)).date()  # India date


def _org_id_for_slug(slug):
    if slug == "_":
        return ""
    org = Organization.query.filter_by(slug=slug).first()
    return org.id if org else None


def _live_rows(org_id):
    q = HotelOfferLive.query.filter_by(organization_id=org_id, is_live=True)
    return [r for r in q.order_by(HotelOfferLive.published_at.desc()).all() if not r.valid_till or r.valid_till >= _today()]


def _public(row):
    s = row.snap()
    s.update({
        "slug": row.slug, "valid_till": row.valid_till.isoformat() if row.valid_till else None,
        "image": f"/offers/img/{row.slug}?v={int(row.updated_at.timestamp()) if row.updated_at else 0}",
        "w": row.image_w, "h": row.image_h,
    })
    return s


def _client_cfg(cfg):
    return {k: cfg[k] for k in ("client_title", "client_subtitle", "whatsapp_number")}


@bp.route("/offers")
def offers_home():
    orgs = {r.organization_id for r in HotelOfferLive.query.filter_by(is_live=True).all()}
    if len(orgs) == 1:
        return redirect(f"/offers/{org_slug(next(iter(orgs)))}")
    abort(404)


@bp.route("/offers/<org_slug_>")
def client_dashboard(org_slug_):
    org_id = _org_id_for_slug(org_slug_)
    if org_id is None:
        abort(404)
    cfg = settings.get_config(org_id, include_env=False)
    return render_template("hotel_offers/client.html", org_slug=org_slug_, focus="", cfg=_client_cfg(cfg), og=None)


@bp.route("/o/<slug>")
def client_offer(slug):
    row = HotelOfferLive.query.filter_by(slug=slug).first()
    if row is None:
        abort(404)
    cfg = settings.get_config(row.organization_id, include_env=False)
    live = row.is_live and (not row.valid_till or row.valid_till >= _today())
    og = None
    if live:
        s = row.snap()
        price = f"{s.get('currency', '')} {int(s.get('our_deal') or 0):,}".strip() if s.get("our_deal") else ""
        og = {"title": s.get("title") or s.get("hotel_name") or "Offer", "desc": " · ".join(x for x in (s.get("offer_headline"), price and f"from {price}") if x) or cfg["client_subtitle"],
              "image": f"{base_url()}/offers/img/{row.slug}?v={int(row.updated_at.timestamp()) if row.updated_at else 0}", "url": f"{base_url()}/o/{row.slug}"}
    return render_template("hotel_offers/client.html", org_slug=org_slug(row.organization_id), focus=slug, cfg=_client_cfg(cfg), og=og)


@bp.route("/offers/img/<slug>")
def offer_image(slug):
    row = HotelOfferLive.query.filter_by(slug=slug).first()
    if row is None or not row.image:
        abort(404)
    return Response(row.image, mimetype=row.image_mime, headers={"Cache-Control": "public, max-age=31536000, immutable"})


@bp.route("/api/public/offers/<org_slug_>")
def public_list(org_slug_):
    org_id = _org_id_for_slug(org_slug_)
    if org_id is None:
        return jsonify({"error": "Not found"}), 404
    cfg = settings.get_config(org_id, include_env=False)
    resp = jsonify({"offers": [_public(r) for r in _live_rows(org_id)], "cfg": _client_cfg(cfg)})
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@bp.route("/api/public/offers/<slug>/view", methods=["POST"])
def public_view(slug):
    row = HotelOfferLive.query.filter_by(slug=slug, is_live=True).first()
    if row:
        row.views = (row.views or 0) + 1
        db.session.commit()
    return ("", 204)


def _clean_phone(raw):
    digits = re.sub(r"[^\d+]", "", raw or "")
    plus = digits.startswith("+")
    digits = re.sub(r"\D", "", digits)
    if not plus and len(digits) == 10 and digits[0] in "6789":
        digits = "91" + digits  # Indian mobile typed without country code
    if not 8 <= len(digits) <= 15:
        return None
    return "+" + digits


@bp.route("/api/public/offers/<slug>/lead", methods=["POST"])
def public_lead(slug):
    body = request.get_json(silent=True) or {}
    if body.get("website"):  # honeypot: real people never see this field
        return jsonify({"ok": True})
    row = HotelOfferLive.query.filter_by(slug=slug).first()
    if row is None or not row.is_live or (row.valid_till and row.valid_till < _today()):
        return jsonify({"error": "This offer is no longer available."}), 410
    name = re.sub(r"\s+", " ", str(body.get("name") or "")).strip()
    phone = _clean_phone(str(body.get("phone") or ""))
    if not 2 <= len(name) <= 80:
        return jsonify({"error": "Please enter your name.", "field": "name"}), 400
    if not phone:
        return jsonify({"error": "Please enter a valid phone number.", "field": "phone"}), 400

    ip = (request.headers.get("X-Forwarded-For", request.remote_addr or "").split(",")[0]).strip()
    now, q = time.time(), _hits[ip]
    while q and now - q[0] > 600:
        q.popleft()
    if len(q) >= 5:
        return jsonify({"error": "Too many requests. Please try again in a few minutes."}), 429
    q.append(now)

    cfg = settings.get_config(row.organization_id, include_env=False)
    title = row.snap().get("title") or "an offer"
    recent = HotelOfferLead.query.filter_by(live_id=row.id, phone=phone).order_by(HotelOfferLead.created_at.desc()).first()
    if not (recent and recent.created_at and datetime.utcnow() - recent.created_at < timedelta(minutes=10)):
        db.session.add(HotelOfferLead(live_id=row.id, offer_id=row.offer_id, organization_id=row.organization_id, offer_title=title, name=name, phone=phone))
        db.session.commit()
        if cfg.get("lead_notify"):
            notify.notify_lead(cfg.get("lead_email"), title, name, phone)

    message = (cfg["wa_message"] or "").format_map(defaultdict(str, offer=title, name=name, phone=phone))
    number = re.sub(r"\D", "", cfg["whatsapp_number"] or "")
    return jsonify({"ok": True, "wa_url": f"https://wa.me/{number}?text={quote(message)}"})
