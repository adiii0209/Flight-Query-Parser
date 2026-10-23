"""Authenticated routes: publishing offers to the client page, and managing leads."""
import base64
import csv
import io
import json
import re
import secrets
from datetime import date, datetime

from flask import Response, jsonify, request

from extensions import db
from routes.auth import login_required

from . import settings
from .models import HotelOffer, HotelOfferLead, HotelOfferLive
from .common import base_url, org_slug, public_base  # noqa: F401
from .routes import _err, _org, hotel_offers_bp as bp

MAX_IMAGE_BYTES = 4 * 1024 * 1024
LEAD_STATUSES = ("new", "contacted", "won", "lost")


def _slugify(text):
    return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")[:40] or "offer"


def live_info(row):
    return {
        "is_live": bool(row.is_live), "slug": row.slug, "template_id": row.template_id,
        "valid_till": row.valid_till.isoformat() if row.valid_till else None,
        "views": row.views, "url": f"{public_base(row.organization_id)}/o/{row.slug}",
        "expired": bool(row.valid_till and row.valid_till < date.today()),
    }


def build_snapshot(offer_json, title):
    d = (offer_json or {}).get("data") or {}
    keep = ("hotel_name", "brand_line", "place_line", "city", "tagline", "offer_headline", "currency", "room", "check_in", "check_out")
    snap = {k: str(d.get(k) or "")[:200] for k in keep}
    for k in ("online_rate", "our_deal", "nights", "adults", "rooms"):
        try:
            snap[k] = float(d.get(k) or 0)
        except (TypeError, ValueError):
            snap[k] = 0
    snap["perks"] = [str(p.get("label") or "").replace("\n", " ")[:60] for p in (d.get("perks") or [])[:6] if isinstance(p, dict) and p.get("label")]
    snap["title"] = title
    return snap


def parse_data_url(value):
    m = re.match(r"^data:(image/(?:jpeg|png));base64,(.+)$", value or "", re.S)
    if not m:
        raise ValueError("The poster picture is missing or not a JPEG/PNG.")
    raw = base64.b64decode(m.group(2), validate=False)
    if len(raw) > MAX_IMAGE_BYTES:
        raise ValueError("The poster picture is too large.")
    if not (raw.startswith(b"\xff\xd8") or raw.startswith(b"\x89PNG")):
        raise ValueError("That file is not a valid image.")
    return raw, m.group(1)


@bp.route("/api/hotel-offers/offers/<int:offer_id>/live", methods=["POST"])
@login_required
def go_live(offer_id):
    offer = HotelOffer.query.filter_by(id=offer_id, organization_id=_org()).first()
    if not offer:
        return _err("Save the offer first.", 404)
    body = request.get_json(silent=True) or {}
    try:
        image, mime = parse_data_url(body.get("image"))
    except ValueError as exc:
        return _err(str(exc))
    template_id = re.sub(r"[^a-z0-9-]", "", str(body.get("template_id") or ""))[:40]
    if not template_id:
        return _err("Choose a template.")
    valid_till = None
    if body.get("valid_till"):
        try:
            valid_till = date.fromisoformat(str(body["valid_till"])[:10])
        except ValueError:
            return _err("The valid-till date is not valid.")
    try:
        offer_json = json.loads(offer.data or "{}")
    except ValueError:
        offer_json = {}
    row = HotelOfferLive.query.filter_by(offer_id=offer.id).first()
    if row is None:
        snap = build_snapshot(offer_json, offer.title)
        slug = f"{_slugify(offer.title)}-{secrets.token_hex(3)}"
        row = HotelOfferLive(offer_id=offer.id, organization_id=_org(), slug=slug)
        db.session.add(row)
    row.snapshot = json.dumps(build_snapshot(offer_json, offer.title))
    row.template_id, row.valid_till, row.is_live = template_id, valid_till, True
    row.image, row.image_mime = image, mime
    row.image_w, row.image_h = max(0, min(int(body.get("width") or 0), 6000)), max(0, min(int(body.get("height") or 0), 12000))
    row.published_at = datetime.utcnow()
    db.session.commit()
    return jsonify({"live": live_info(row)})


@bp.route("/api/hotel-offers/offers/<int:offer_id>/live/off", methods=["POST"])
@login_required
def go_offline(offer_id):
    row = HotelOfferLive.query.filter_by(offer_id=offer_id, organization_id=_org()).first()
    if not row:
        return _err("This offer is not live.", 404)
    row.is_live = False
    db.session.commit()
    return jsonify({"live": live_info(row)})


@bp.route("/api/hotel-offers/offers/<int:offer_id>/live/on", methods=["POST"])
@login_required
def go_online_again(offer_id):
    """Switch a previously published offer back on without re-picking the template."""
    row = HotelOfferLive.query.filter_by(offer_id=offer_id, organization_id=_org()).first()
    if not row or not row.image:
        return _err("Choose a template to go live.", 404)
    body = request.get_json(silent=True) or {}
    if body.get("valid_till"):
        try:
            row.valid_till = date.fromisoformat(str(body["valid_till"])[:10])
        except ValueError:
            return _err("The valid-till date is not valid.")
    row.is_live = True
    db.session.commit()
    return jsonify({"live": live_info(row)})


@bp.route("/api/hotel-offers/dashboard-link")
@login_required
def dashboard_link():
    return jsonify({"url": f"{public_base(_org())}/offers/{org_slug(_org())}"})


# ------------------------------------------------------------------ leads
def _lead_query():
    q = HotelOfferLead.query.filter_by(organization_id=_org())
    status = request.args.get("status")
    if status in LEAD_STATUSES:
        q = q.filter_by(status=status)
    term = (request.args.get("q") or "").strip()
    if term:
        like = f"%{term}%"
        q = q.filter(db.or_(HotelOfferLead.name.ilike(like), HotelOfferLead.phone.ilike(like), HotelOfferLead.offer_title.ilike(like)))
    return q.order_by(HotelOfferLead.created_at.desc())


@bp.route("/api/hotel-offers/leads")
@login_required
def list_leads():
    counts = {s: 0 for s in LEAD_STATUSES}
    for status, n in db.session.query(HotelOfferLead.status, db.func.count()).filter_by(organization_id=_org()).group_by(HotelOfferLead.status):
        counts[status] = n
    return jsonify({"leads": [l.to_dict() for l in _lead_query().limit(500)], "counts": counts, "total": sum(counts.values())})


@bp.route("/api/hotel-offers/leads/summary")
@login_required
def lead_summary():
    n = HotelOfferLead.query.filter_by(organization_id=_org(), status="new").count()
    return jsonify({"new": n})


@bp.route("/api/hotel-offers/leads/<int:lead_id>", methods=["PATCH"])
@login_required
def update_lead(lead_id):
    lead = HotelOfferLead.query.filter_by(id=lead_id, organization_id=_org()).first()
    if not lead:
        return _err("Not found", 404)
    body = request.get_json(silent=True) or {}
    if "status" in body:
        if body["status"] not in LEAD_STATUSES:
            return _err("Unknown status.")
        lead.status = body["status"]
    if "note" in body:
        lead.note = str(body["note"] or "")[:2000]
    db.session.commit()
    return jsonify({"lead": lead.to_dict()})


@bp.route("/api/hotel-offers/leads/<int:lead_id>", methods=["DELETE"])
@login_required
def delete_lead(lead_id):
    lead = HotelOfferLead.query.filter_by(id=lead_id, organization_id=_org()).first()
    if not lead:
        return _err("Not found", 404)
    db.session.delete(lead)
    db.session.commit()
    return jsonify({"ok": True})


@bp.route("/api/hotel-offers/leads.csv")
@login_required
def export_leads():
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["Received (UTC)", "Name", "Phone", "Offer", "Stay from", "Stay to", "Status", "Note"])
    for l in _lead_query().all():
        # a leading = + - @ would be run as a formula by spreadsheets
        safe = lambda v: ("'" + v) if v[:1] in ("=", "+", "-", "@") else v
        w.writerow([l.created_at.strftime("%Y-%m-%d %H:%M"), safe(l.name), safe(l.phone), safe(l.offer_title), l.stay_from or "", l.stay_to or "", l.status, safe(l.note)])
    return Response(out.getvalue(), mimetype="text/csv", headers={"Content-Disposition": "attachment; filename=hotel-offer-leads.csv"})
