"""Authenticated routes for the quotation module: trip leads, trips and the hotel quotes inside them."""
import json
import re
import secrets
from datetime import date, datetime

import requests
from flask import Response, jsonify, render_template, request, session

from extensions import db
from routes.auth import login_required

from . import settings, trip_facts, trip_groups, trip_photos, trip_places
from .common import public_base
from .models import HotelOfferLead, HotelQuote, HotelTrip, HotelTripPhoto
from .routes import _err, _org, hotel_offers_bp as bp
from .parser import ICONS as PERK_ICONS
from .trip_parser import parse_quotes

PHOTO_RE = re.compile(r"^(places/[\w-]+/photos/[\w-]+|u:\d+)$")  # Google Places photo, or a stored picture
MAX_PHOTOS = 10
TEXT_FIELDS = ("day", "city", "hotel_name", "guests", "guest_name", "cancellation", "meal_plan", "room", "room_size",
               "nutshell", "notes", "place_id", "address")
LONG_FIELDS = ("nutshell", "notes", "address", "cancellation", "room", "guests")


def _d(value):
    try:
        return date.fromisoformat(str(value)[:10]) if value else None
    except ValueError:
        return None


def _s(value, n=200):
    return re.sub(r"[ \t]+", " ", str(value or "")).strip()[:n]


def _url(value):
    v = str(value or "").strip()
    return v[:500] if re.match(r"^https?://[^\s<>\"']+$", v) else ""


def _coord(value, lo, hi):
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return v if lo <= v <= hi else None


def clean_quote(raw):
    """Whitelist and size-limit the fields of a quote coming from the browser."""
    q = {k: _s(raw.get(k), 1200 if k in LONG_FIELDS else 200) for k in TEXT_FIELDS}
    d = _d(raw.get("date"))
    q["date"] = d.isoformat() if d else None
    if d:
        q["day"] = d.strftime("%a")
    cb = _d(raw.get("cancel_by"))
    q["cancel_by"] = cb.isoformat() if cb else None
    for k, hi in (("nights", 365), ("rooms", 99), ("items", 999)):
        try:
            q[k] = max(0, min(int(float(raw.get(k) or 0)), hi))
        except (TypeError, ValueError):
            q[k] = 0
    for k in ("cost_per_item", "total", "online_total"):
        try:
            q[k] = max(0, min(round(float(raw.get(k) or 0)), 10 ** 9))
        except (TypeError, ValueError):
            q[k] = 0
    q["local_currency"] = re.sub(r"[^A-Z]", "", str(raw.get("local_currency") or "").upper())[:3]
    try:  # what one unit of the local currency is worth in the trip currency
        q["local_rate"] = max(0, min(round(float(raw.get("local_rate") or 0), 4), 10 ** 7))
    except (TypeError, ValueError):
        q["local_rate"] = 0
    if not q["rooms"]:
        q["rooms"] = max(1, round(q["items"] / q["nights"])) if q["nights"] else max(1, q["items"])
    q["lat"], q["lng"] = _coord(raw.get("lat"), -90, 90), _coord(raw.get("lng"), -180, 180)
    if q["lat"] is None or q["lng"] is None:
        q["lat"] = q["lng"] = None
    marks = []
    for m in (raw.get("landmarks") or [])[:2]:  # an agent may pin at most two landmarks per hotel
        if not isinstance(m, dict):
            continue
        lat, lng = _coord(m.get("lat"), -90, 90), _coord(m.get("lng"), -180, 180)
        if lat is None or lng is None or not _s(m.get("name")):
            continue
        marks.append({"name": _s(m.get("name"), 120), "address": _s(m.get("address"), 300),
                      "place_id": _s(m.get("place_id"), 200), "lat": lat, "lng": lng})
    q["landmarks"] = marks
    try:
        q["stars"] = max(0, min(int(float(raw.get("stars") or 0)), 5))
    except (TypeError, ValueError):
        q["stars"] = 0
    q["style"], q["age_info"], q["brief"] = _s(raw.get("style"), 60), _s(raw.get("age_info"), 120), _s(raw.get("brief"), 300)
    q["location_info"], q["room_desc"] = _s(raw.get("location_info"), 300), _s(raw.get("room_desc"), 600)
    q["hide_rating"], q["hide_reviews"] = bool(raw.get("hide_rating")), bool(raw.get("hide_reviews"))
    q["perks"] = [{"icon": p.get("icon") if p.get("icon") in PERK_ICONS else "gift", "label": _s(p.get("label"), 60)}
                  for p in (raw.get("perks") or [])[:6] if isinstance(p, dict) and _s(p.get("label"), 60)]
    q["website"], q["maps_url"] = _url(raw.get("website")), _url(raw.get("maps_url"))
    try:
        rating = round(float(raw.get("rating") or 0), 1)
    except (TypeError, ValueError):
        rating = 0
    q["rating"] = rating if 0 < rating <= 5 else 0
    try:
        q["rating_count"] = max(0, min(int(float(raw.get("rating_count") or 0)), 10 ** 7))
    except (TypeError, ValueError):
        q["rating_count"] = 0
    gd = _d(raw.get("google_at"))
    q["google_at"] = gd.isoformat() if gd else None
    q["photos"] = [p for p in (raw.get("photos") or []) if isinstance(p, str) and PHOTO_RE.match(p)][:MAX_PHOTOS]
    stored = [int(p[2:]) for p in q["photos"] if p.startswith("u:")]
    if stored:  # a quote may only point at pictures that belong to this workspace
        ok = {r[0] for r in db.session.query(HotelTripPhoto.id).filter(HotelTripPhoto.id.in_(stored), HotelTripPhoto.organization_id == _org())}
        q["photos"] = [p for p in q["photos"] if not p.startswith("u:") or int(p[2:]) in ok]
    return q


def _trip(trip_id):
    return HotelTrip.query.filter_by(id=trip_id, organization_id=_org()).first()


def _quotes(trip_id):
    return HotelQuote.query.filter_by(trip_id=trip_id).order_by(HotelQuote.position, HotelQuote.id).all()


def trip_url(trip):
    return f"{public_base(trip.organization_id)}/t/{trip.share_slug}" if trip.share_slug else None


def _trip_payload(trip):
    quotes = [q.to_dict() for q in _quotes(trip.id)]
    groups = trip_groups.group_quotes(quotes, trip.selection_map())
    out = trip.to_dict(quote_count=len(groups), total=trip_groups.selected_total(groups))  # the total counts the selected option per city
    out["share_url"], out["quotes"] = trip_url(trip), quotes
    return out


def _apply_trip_fields(trip, body):
    for k, n in (("title", 255), ("client_name", 120), ("client_phone", 32), ("destination", 160)):
        if k in body:
            setattr(trip, k, _s(body[k], n))
    if "notes" in body:
        trip.notes = str(body["notes"] or "")[:4000]
    if "currency" in body:
        trip.currency = re.sub(r"[^A-Z]", "", str(body["currency"]).upper())[:8] or "INR"
    for k in ("start_date", "end_date"):
        if k in body:
            setattr(trip, k, _d(body[k]))


@bp.route("/hotel-offers/trips")
@login_required
def trips_page():
    return render_template("hotel_offers/trips.html", map_tiles=settings.get_config(_org())["map_tile_url"])


# ------------------------------------------------------------------ places
@bp.route("/api/hotel-offers/places")
@login_required
def places_search():
    query = _s(request.args.get("q"), 200)
    if len(query) < 3:
        return _err("Type at least 3 letters.")
    key = settings.get_config(_org())["google_places_key"]
    if not key:
        return _err("Google Places key is not configured (Hotel Offers settings).")
    near = {"lat": _coord(request.args.get("lat"), -90, 90), "lng": _coord(request.args.get("lng"), -180, 180)}
    try:
        return jsonify({"results": trip_places.search(query, key, 5, near)})
    except requests.HTTPError as exc:
        return _err(f"Google Places rejected the request ({exc.response.status_code}).", 502)
    except requests.RequestException as exc:
        return _err(f"Could not reach Google Places: {exc}", 502)


# ------------------------------------------------------------------ hand-added photos
@bp.route("/api/hotel-offers/trips/photos", methods=["POST"])
@login_required
def add_photo():
    """Accepts an uploaded/pasted file (multipart 'file') or a pasted image link (JSON {url}); returns the ref to store on a quote."""
    try:
        if request.files.get("file"):
            raw = request.files["file"].read(trip_photos.MAX_UPLOAD_BYTES + 1)
        else:
            url = str((request.get_json(silent=True) or {}).get("url") or "").strip()
            if not url:
                return _err("Choose a picture or paste an image link.")
            raw = trip_photos.fetch_image_url(url)
        data, mime = trip_photos.normalise(raw)
    except ValueError as exc:
        return _err(str(exc))
    row = HotelTripPhoto(organization_id=_org(), mime=mime, data=data)
    db.session.add(row)
    db.session.commit()
    return jsonify({"ref": f"u:{row.id}"})


@bp.route("/api/hotel-offers/trips/photos/<int:photo_id>")
@login_required
def get_photo(photo_id):
    row = HotelTripPhoto.query.filter_by(id=photo_id, organization_id=_org()).first()
    if not row:
        return _err("Not found", 404)
    return Response(row.data, mimetype=row.mime, headers={"Cache-Control": "private, max-age=86400"})


@bp.route("/api/hotel-offers/places/distance")
@login_required
def place_distance():
    """"2.4 km from Pattaya centre": distance from a pinned hotel to the city centre or to a spot the agent names."""
    key = settings.get_config(_org())["google_places_key"]
    if not key:
        return _err("Google Places key is not configured (Hotel Offers settings).")
    lat, lng = _coord(request.args.get("lat"), -90, 90), _coord(request.args.get("lng"), -180, 180)
    if lat is None or lng is None:
        return _err("Pin the hotel on the map first.")
    ref, city = _s(request.args.get("ref"), 120), _s(request.args.get("city"), 120)
    if not ref and not city:
        return _err("Add the city, or type a place to measure from.")
    try:
        point = trip_places.centre(ref or city, key, {"lat": lat, "lng": lng})
    except requests.HTTPError as exc:
        return _err(f"Google Places rejected the request ({exc.response.status_code}).", 502)
    except requests.RequestException as exc:
        return _err(f"Could not reach Google Places: {exc}", 502)
    if not point:
        return _err("Could not find that place.")
    label = ref or f"{city} centre"
    return jsonify({"text": trip_places.distance_text(trip_places.km_between(lat, lng, point["lat"], point["lng"]), label)})


@bp.route("/api/hotel-offers/places/details")
@login_required
def place_details():
    """Fresh rating, review count, website and photos for a hotel that is already pinned (the Refresh button)."""
    key = settings.get_config(_org())["google_places_key"]
    if not key:
        return _err("Google Places key is not configured (Hotel Offers settings).")
    try:
        place = trip_places.details(request.args.get("place_id", ""), key)
    except requests.HTTPError as exc:
        return _err(f"Google Places rejected the request ({exc.response.status_code}).", 502)
    except requests.RequestException as exc:
        return _err(f"Could not reach Google Places: {exc}", 502)
    if not place:
        return _err("Pin the hotel on the map first.")
    place["google_at"] = date.today().isoformat()
    return jsonify({"place": place})


# ------------------------------------------------------------------ convert an offer lead into a trip
@bp.route("/api/hotel-offers/leads/<int:lead_id>/to-trip", methods=["POST"])
@login_required
def lead_to_trip(lead_id):
    """Leads come from the Book now button on live offers; converting one is optional and creates (or returns) its trip."""
    lead = HotelOfferLead.query.filter_by(id=lead_id, organization_id=_org()).first()
    if not lead:
        return _err("Not found", 404)
    existing = HotelTrip.query.filter_by(lead_id=lead.id, organization_id=_org()).first()
    if existing:
        return jsonify({"trip": existing.to_dict(), "created": False})
    trip = HotelTrip(organization_id=_org(), user_id=session.get("user_id"), lead_id=lead.id, title=(lead.name or "Untitled trip")[:255],
                     client_name=lead.name, client_phone=lead.phone, start_date=lead.stay_from, end_date=lead.stay_to,
                     notes="\n".join(x for x in (f"From offer: {lead.offer_title}" if lead.offer_title else "", lead.note or "") if x))
    db.session.add(trip)
    db.session.commit()
    return jsonify({"trip": trip.to_dict(), "created": True})


# ------------------------------------------------------------------ trips
@bp.route("/api/hotel-offers/trips", methods=["GET"])
@login_required
def list_trips():
    rows = HotelTrip.query.filter_by(organization_id=_org()).order_by(HotelTrip.updated_at.desc()).limit(200).all()
    by_trip = {}
    for tid, data, qid in (db.session.query(HotelQuote.trip_id, HotelQuote.data, HotelQuote.id).filter(HotelQuote.organization_id == _org())
                           .order_by(HotelQuote.position, HotelQuote.id).all()):
        try:
            q = json.loads(data)
        except ValueError:
            q = {}
        q["id"] = qid
        by_trip.setdefault(tid, []).append(q)
    out = []
    for r in rows:
        quotes = by_trip.get(r.id, [])
        groups = trip_groups.group_quotes(quotes, r.selection_map())
        item = r.to_dict(len(groups), trip_groups.selected_total(groups))
        item["cities"] = list(dict.fromkeys((q.get("city") or "").strip() for q in quotes if (q.get("city") or "").strip()))[:6]
        item["cover"] = next((q["photos"][0] for q in quotes if q.get("photos")), "")
        out.append(item)
    return jsonify({"trips": out})


@bp.route("/api/hotel-offers/trips", methods=["POST"])
@login_required
def create_trip():
    body = request.get_json(silent=True) or {}
    trip = HotelTrip(organization_id=_org(), user_id=session.get("user_id"))
    _apply_trip_fields(trip, body)
    if not trip.title:
        trip.title = trip.client_name or "Untitled trip"
    db.session.add(trip)
    db.session.commit()
    return jsonify({"trip": _trip_payload(trip)})


@bp.route("/api/hotel-offers/trips/<int:trip_id>", methods=["GET"])
@login_required
def get_trip(trip_id):
    trip = _trip(trip_id)
    return jsonify({"trip": _trip_payload(trip)}) if trip else _err("Not found", 404)


@bp.route("/api/hotel-offers/trips/<int:trip_id>", methods=["PATCH"])
@login_required
def update_trip(trip_id):
    trip = _trip(trip_id)
    if not trip:
        return _err("Not found", 404)
    body = request.get_json(silent=True) or {}
    _apply_trip_fields(trip, body)
    if "is_shared" in body:
        trip.is_shared = bool(body["is_shared"])
        if trip.is_shared and not trip.share_slug:
            trip.share_slug = secrets.token_hex(8)
    db.session.commit()
    return jsonify({"trip": _trip_payload(trip)})


@bp.route("/api/hotel-offers/trips/<int:trip_id>", methods=["DELETE"])
@login_required
def delete_trip(trip_id):
    trip = _trip(trip_id)
    if not trip:
        return _err("Not found", 404)
    HotelQuote.query.filter_by(trip_id=trip.id).delete()
    db.session.delete(trip)
    db.session.commit()
    return jsonify({"ok": True})


# ------------------------------------------------------------------ quotes
@bp.route("/api/hotel-offers/trips/<int:trip_id>/parse", methods=["POST"])
@login_required
def parse_trip_quotes(trip_id):
    """Parse pasted text into quotes, add them to the trip and pin each hotel on the map."""
    trip = _trip(trip_id)
    if not trip:
        return _err("Not found", 404)
    text = ((request.get_json(silent=True) or {}).get("text") or "").strip()
    if len(text) < 20:
        return _err("Paste the hotel quotation first.")
    if len(text) > 60000:
        return _err("Text is too long.")
    cfg = settings.get_config(_org())
    try:
        quotes, source = parse_quotes(text, cfg)
    except Exception as exc:
        return _err(f"Parsing failed: {exc}", 502)
    if not quotes:
        return _err("No hotel stays found in that text.")
    quotes = quotes[:60]
    warning = None
    centres = {}  # city -> coordinates, so a city is looked up once
    if cfg["google_places_key"]:
        for q in quotes:
            try:
                hits = trip_places.search(f"{q['hotel_name']} {q['city']}".strip(), cfg["google_places_key"], 1)
            except requests.RequestException:
                warning = "Some hotels could not be placed on the map; search for them on each card."
                break
            if hits:
                h = hits[0]
                q.update(place_id=h["place_id"], address=h["address"], photos=h["photos"], lat=h["lat"], lng=h["lng"], rating=h["rating"],
                         rating_count=h["rating_count"], website=h["website"], maps_url=h["maps_url"], google_at=date.today().isoformat())
                if not q.get("location_info") and q.get("city"):  # "2.4 km from Pattaya centre", if the agent has not written something
                    ck = q["city"].strip().lower()
                    if ck not in centres:
                        centres[ck] = trip_places.centre(q["city"], cfg["google_places_key"], {"lat": h["lat"], "lng": h["lng"]})
                    if centres[ck]:
                        q["location_info"] = trip_places.distance_text(trip_places.km_between(h["lat"], h["lng"], centres[ck]["lat"], centres[ck]["lng"]), f"{q['city'].strip()} centre")
    else:
        warning = "No Google Places key is set, so hotels were not placed on the map."
    if cfg.get("ai_api_key"):
        trip_facts.fill(quotes, cfg)  # star class, "Boutique hotel · 50 rooms", opening year and a short brief, where the paste left them empty
    pos = (db.session.query(db.func.max(HotelQuote.position)).filter_by(trip_id=trip.id).scalar() or 0) + 1
    rows = []
    for i, q in enumerate(quotes):
        row = HotelQuote(trip_id=trip.id, organization_id=_org(), position=pos + i, data=json.dumps(clean_quote(q)))
        db.session.add(row)
        rows.append(row)
    trip.updated_at = db.func.now()
    db.session.commit()
    return jsonify({"quotes": [r.to_dict() for r in rows], "source": source, "warning": warning})


@bp.route("/api/hotel-offers/trips/<int:trip_id>/quotes", methods=["POST"])
@login_required
def add_quote(trip_id):
    trip = _trip(trip_id)
    if not trip:
        return _err("Not found", 404)
    pos = (db.session.query(db.func.max(HotelQuote.position)).filter_by(trip_id=trip.id).scalar() or 0) + 1
    row = HotelQuote(trip_id=trip.id, organization_id=_org(), position=pos, data=json.dumps(clean_quote(request.get_json(silent=True) or {})))
    db.session.add(row)
    trip.updated_at = db.func.now()
    db.session.commit()
    return jsonify({"quote": row.to_dict()})


def _quote(quote_id):
    return HotelQuote.query.filter_by(id=quote_id, organization_id=_org()).first()


@bp.route("/api/hotel-offers/quotes/<int:quote_id>/facts", methods=["POST"])
@login_required
def quote_facts(quote_id):
    """Auto-fill the hotel details (stars, style, age, brief) of one quote with the AI model. Returns the suggestions; the page decides what to keep."""
    row = _quote(quote_id)
    if not row:
        return _err("Not found", 404)
    d = json.loads(row.data or "{}")
    facts = trip_facts.fetch([{"name": d.get("hotel_name", ""), "city": d.get("city", ""), "address": d.get("address", "")}], settings.get_config(_org()))
    if not facts:
        return _err("Could not fetch details for this hotel. Check the AI key in Hotel Offers settings.", 502)
    return jsonify({"facts": facts[0]})


@bp.route("/api/hotel-offers/trips/<int:trip_id>/order", methods=["POST"])
@login_required
def reorder_quotes(trip_id):
    """Sets the order of a trip's quotes. The first option in a city is the default the guest sees selected."""
    trip = _trip(trip_id)
    if not trip:
        return _err("Not found", 404)
    ids = [i for i in ((request.get_json(silent=True) or {}).get("ids") or []) if isinstance(i, int)]
    rows = {r.id: r for r in HotelQuote.query.filter(HotelQuote.trip_id == trip.id, HotelQuote.id.in_(ids or [0])).all()}
    for pos, qid in enumerate(i for i in ids if i in rows):
        rows[qid].position = pos
    trip.updated_at = db.func.now()
    db.session.commit()
    return jsonify({"ok": True})


@bp.route("/api/hotel-offers/quotes/<int:quote_id>", methods=["PUT"])
@login_required
def save_quote(quote_id):
    row = _quote(quote_id)
    if not row:
        return _err("Not found", 404)
    row.data = json.dumps(clean_quote(request.get_json(silent=True) or {}))
    HotelTrip.query.filter_by(id=row.trip_id).update({"updated_at": db.func.now()})
    db.session.commit()
    return jsonify({"quote": row.to_dict()})


@bp.route("/api/hotel-offers/quotes/<int:quote_id>", methods=["DELETE"])
@login_required
def delete_quote(quote_id):
    row = _quote(quote_id)
    if not row:
        return _err("Not found", 404)
    db.session.delete(row)
    db.session.commit()
    return jsonify({"ok": True})
