"""Google Places (New) text search, used to pin hotels and landmarks on the trip map."""
import requests

FIELDS = "places.id,places.displayName,places.formattedAddress,places.location,places.photos"
MAX_PHOTOS = 6


def search(query, key, limit=5, near=None):
    body = {"textQuery": query, "maxResultCount": limit}
    if near and near.get("lat") is not None and near.get("lng") is not None:
        body["locationBias"] = {"circle": {"center": {"latitude": near["lat"], "longitude": near["lng"]}, "radius": 20000.0}}
    r = requests.post("https://places.googleapis.com/v1/places:searchText", timeout=15, json=body,
                      headers={"X-Goog-Api-Key": key, "X-Goog-FieldMask": FIELDS})
    r.raise_for_status()
    out = []
    for p in r.json().get("places", []):
        loc = p.get("location") or {}
        if "latitude" not in loc:
            continue
        out.append({"place_id": p.get("id", ""), "name": (p.get("displayName") or {}).get("text", ""),
                    "address": p.get("formattedAddress", ""),
                    "photos": [ph["name"] for ph in p.get("photos", [])[:MAX_PHOTOS] if ph.get("name")], "lat": loc["latitude"], "lng": loc["longitude"]})
    return out
