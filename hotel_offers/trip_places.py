"""Google Places (New): text search and details, used to pin hotels and landmarks and to fetch a hotel's rating and website."""
import re

import requests

BASE_FIELDS = "id,displayName,formattedAddress,location"
RICH_FIELDS = "photos,rating,userRatingCount,websiteUri,googleMapsUri"
FIELDS = ",".join("places." + f for f in (BASE_FIELDS + "," + RICH_FIELDS).split(","))
MAX_PHOTOS = 6
PLACE_ID_RE = re.compile(r"^[\w-]{10,200}$")


def _shape(p):
    loc = p.get("location") or {}
    if "latitude" not in loc:
        return None
    return {"place_id": p.get("id", ""), "name": (p.get("displayName") or {}).get("text", ""), "address": p.get("formattedAddress", ""),
            "photos": [ph["name"] for ph in p.get("photos", [])[:MAX_PHOTOS] if ph.get("name")],
            "rating": p.get("rating") or 0, "rating_count": p.get("userRatingCount") or 0,
            "website": p.get("websiteUri") or "", "maps_url": p.get("googleMapsUri") or "",
            "lat": loc["latitude"], "lng": loc["longitude"]}


def search(query, key, limit=5, near=None):
    body = {"textQuery": query, "maxResultCount": limit}
    if near and near.get("lat") is not None and near.get("lng") is not None:
        body["locationBias"] = {"circle": {"center": {"latitude": near["lat"], "longitude": near["lng"]}, "radius": 20000.0}}
    r = requests.post("https://places.googleapis.com/v1/places:searchText", timeout=15, json=body,
                      headers={"X-Goog-Api-Key": key, "X-Goog-FieldMask": FIELDS})
    r.raise_for_status()
    return [x for x in (_shape(p) for p in r.json().get("places", [])) if x]


def details(place_id, key):
    """Fresh details for one place (used by the Refresh button). Returns None when the id is not valid."""
    if not PLACE_ID_RE.match(place_id or ""):
        return None
    r = requests.get(f"https://places.googleapis.com/v1/places/{place_id}", timeout=15,
                     headers={"X-Goog-Api-Key": key, "X-Goog-FieldMask": BASE_FIELDS + "," + RICH_FIELDS})
    r.raise_for_status()
    return _shape(r.json())
