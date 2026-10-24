"""Public trip page (no login): the client sees one shared trip, its hotel quotes with photos, and the map."""
import hashlib

from flask import Blueprint, Response, abort, jsonify, render_template
import requests

from . import photos, settings
from .common import ensure_tables, org_slug, public_base
from .models import HotelQuote, HotelTrip, HotelTripPhoto

trips_public_bp = bp = Blueprint("hotel_trips_public", __name__, template_folder="templates", static_folder="static", static_url_path="/trips-static")

# fields the client may see; internal notes, place ids and the agent's remarks stay private
PUBLIC_FIELDS = ("date", "day", "nights", "city", "hotel_name", "guests", "cancellation", "meal_plan", "room", "room_size",
                 "rooms", "items", "cost_per_item", "total", "nutshell", "address", "lat", "lng", "landmarks")


@bp.before_request
def _before():
    ensure_tables()


def _shared_trip(slug):
    trip = HotelTrip.query.filter_by(share_slug=slug, is_shared=True).first()
    if trip is None:
        abort(404)
    return trip


def _public_quote(row):
    d = row.load()
    out = {k: d.get(k) for k in PUBLIC_FIELDS}
    out["landmarks"] = [{k: m.get(k) for k in ("name", "lat", "lng")} for m in d.get("landmarks") or []]
    out["id"] = row.id
    out["photos"] = [f"/api/public/trips/photo/{row.id}/{i}?v={hashlib.sha1(ref.encode()).hexdigest()[:10]}" for i, ref in enumerate(d.get("photos") or [])]
    return out


@bp.route("/t/<slug>")
def trip_page(slug):
    trip = _shared_trip(slug)
    cfg = settings.get_config(trip.organization_id, include_env=False)
    og = {"title": trip.title, "url": f"{public_base(trip.organization_id)}/t/{trip.share_slug}"}
    return render_template("hotel_offers/trip_client.html", slug=slug, og=og, brand=cfg["client_title"], map_tiles=cfg["map_tile_url"], whatsapp=cfg["whatsapp_number"],
                           org_slug=org_slug(trip.organization_id))


@bp.route("/api/public/trips/<slug>")
def trip_data(slug):
    trip = _shared_trip(slug)
    rows = HotelQuote.query.filter_by(trip_id=trip.id).order_by(HotelQuote.position, HotelQuote.id).all()
    quotes = [_public_quote(r) for r in rows]
    resp = jsonify({"trip": {
        "title": trip.title, "client_name": trip.client_name, "destination": trip.destination, "currency": trip.currency,
        "start_date": trip.start_date.isoformat() if trip.start_date else None,
        "end_date": trip.end_date.isoformat() if trip.end_date else None,
        "total": sum(q["total"] or 0 for q in quotes)}, "quotes": quotes})
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@bp.route("/api/public/trips/photo/<int:quote_id>/<int:index>")
def trip_photo(quote_id, index):
    """Serves only photo references already stored on a quote of a shared trip, so this is not an open proxy."""
    row = HotelQuote.query.filter_by(id=quote_id).first()
    trip = HotelTrip.query.filter_by(id=row.trip_id, is_shared=True).first() if row else None
    refs = row.load().get("photos") or [] if trip else []
    if index >= len(refs):
        abort(404)
    if refs[index].startswith("u:"):
        pic = HotelTripPhoto.query.filter_by(id=int(refs[index][2:]), organization_id=row.organization_id).first()
        if pic is None:
            abort(404)
        return Response(pic.data, mimetype=pic.mime, headers={"Cache-Control": "public, max-age=86400"})
    cfg = settings.get_config(row.organization_id)
    try:
        body, ctype = photos.fetch_proxied("google", refs[index], cfg, 1200)
    except (ValueError, requests.RequestException):
        abort(404)
    return Response(body, content_type=ctype, headers={"Cache-Control": "public, max-age=86400"})
