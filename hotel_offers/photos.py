"""Photo search (Unsplash / Google Places) and an allow-listed image proxy so html2canvas can export them."""
import re
from urllib.parse import quote, urlparse

import requests

UNSPLASH_HOSTS = ("images.unsplash.com", "plus.unsplash.com")
MAX_BYTES = 12 * 1024 * 1024
GOOGLE_NAME_RE = re.compile(r"^places/[\w-]+/photos/[\w-]+$")


def proxy_url(src, ref):
    return f"/api/hotel-offers/photo?src={src}&ref={quote(ref, safe='')}"


def search_unsplash(query, key, orientation="landscape", per_page=12, page=1):
    r = requests.get(
        "https://api.unsplash.com/search/photos", timeout=15,
        params={"query": query, "orientation": orientation, "per_page": per_page, "page": page},
        headers={"Authorization": f"Client-ID {key}", "Accept-Version": "v1"})
    r.raise_for_status()
    out = []
    for p in r.json().get("results", []):
        u = p["urls"]
        out.append({
            "id": p["id"],
            "thumb": proxy_url("unsplash", u["small"]),
            "full": proxy_url("unsplash", u["regular"]),
            "width": p["width"], "height": p["height"],
            "credit": p["user"]["name"],
            "credit_url": p["user"]["links"]["html"] + "?utm_source=time_tours&utm_medium=referral",
            "source": "unsplash",
        })
    return out


def search_google(query, key, per_page=12):
    r = requests.post(
        "https://places.googleapis.com/v1/places:searchText", timeout=15,
        headers={"X-Goog-Api-Key": key, "X-Goog-FieldMask": "places.displayName,places.photos"},
        json={"textQuery": query, "maxResultCount": 3})
    r.raise_for_status()
    out = []
    for place in r.json().get("places", []):
        for ph in place.get("photos", []):
            name = ph["name"]
            out.append({
                "id": name,
                "thumb": proxy_url("google", name) + "&w=400",
                "full": proxy_url("google", name),
                "width": ph.get("widthPx"), "height": ph.get("heightPx"),
                "credit": place.get("displayName", {}).get("text", "Google Places"),
                "credit_url": "", "source": "google",
            })
    return out[:per_page]


def fetch_proxied(src, ref, cfg, width=None):
    """Return (bytes, content_type). Raises ValueError for anything not allow-listed."""
    if src == "unsplash":
        parsed = urlparse(ref)
        if parsed.scheme != "https" or parsed.hostname not in UNSPLASH_HOSTS:
            raise ValueError("Host not allowed")
        url, headers, params = ref, {}, None
    elif src == "google":
        if not GOOGLE_NAME_RE.match(ref) or not cfg.get("google_places_key"):
            raise ValueError("Bad Google photo reference")
        url = f"https://places.googleapis.com/v1/{ref}/media"
        headers = {"X-Goog-Api-Key": cfg["google_places_key"]}
        params = {"maxWidthPx": width or 1600}
    else:
        raise ValueError("Unknown source")
    r = requests.get(url, params=params, headers=headers, timeout=20, stream=True)
    r.raise_for_status()
    body = r.raw.read(MAX_BYTES + 1, decode_content=True)
    if len(body) > MAX_BYTES:
        raise ValueError("Image too large")
    ctype = r.headers.get("Content-Type", "image/jpeg")
    if not ctype.startswith("image/"):
        raise ValueError("Not an image")
    return body, ctype
