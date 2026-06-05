"""
hotel_image.py
==============
Hotel image enrichment service.

- Auto-fetches a hotel photo via Unsplash (no API key needed for demo URLs)
  or optionally Google Places API (set GOOGLE_PLACES_API_KEY in .env).
- Handles manual image upload override (saves to existing uploads/ folder).
- Completely decoupled from parser and PDF logic.

Usage:
    from hotel_image import HotelImageService
    svc = HotelImageService()
    url = svc.fetch_image("Taj Mahal Palace")          # auto-fetch
    url = svc.save_uploaded_image(file_storage_obj)    # manual override
"""

import os
import uuid

import requests
from dotenv import load_dotenv

load_dotenv()

GOOGLE_PLACES_API_KEY = os.getenv("GOOGLE_PLACES_API_KEY", "")
UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads", "hotel_images")
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "webp", "gif"}


def _allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


class HotelImageService:
    """
    Handles hotel image fetching (auto) and upload override (manual).
    Reuses the uploads/ folder already used by the rest of the app.
    """

    def fetch_image(self, hotel_name: str) -> str | None:
        """
        Try to fetch a hotel image URL.

        Priority:
          1. Google Places API (if GOOGLE_PLACES_API_KEY is set)

        Returns:
            Public image URL string, or None on failure.
        """
        if not hotel_name:
            return None

        if GOOGLE_PLACES_API_KEY:
            url = self._fetch_from_google_places(hotel_name)
            if url:
                return url

        return None

    def _fetch_from_google_places(self, hotel_name: str) -> str | None:
        """Fetch a photo via Google Places API. Returns CDN photo URL or None."""
        try:
            find_url = "https://maps.googleapis.com/maps/api/place/findplacefromtext/json"
            r = requests.get(
                find_url,
                params={
                    "input": f"{hotel_name} hotel exterior",
                    "inputtype": "textquery",
                    "fields": "place_id,photos",
                    "key": GOOGLE_PLACES_API_KEY,
                },
                timeout=10,
            )
            data = r.json()
            candidates = data.get("candidates") or []
            if not candidates:
                return None

            photos = candidates[0].get("photos") or []
            if not photos:
                place_id = candidates[0].get("place_id")
                if not place_id:
                    return None
                details_url = "https://maps.googleapis.com/maps/api/place/details/json"
                dr = requests.get(
                    details_url,
                    params={
                        "place_id": place_id,
                        "fields": "photos",
                        "key": GOOGLE_PLACES_API_KEY,
                    },
                    timeout=10,
                )
                photos = (dr.json().get("result") or {}).get("photos") or []

            if not photos:
                return None

            photo_ref = photos[0].get("photo_reference")
            if not photo_ref:
                return None

            return (
                f"https://maps.googleapis.com/maps/api/place/photo"
                f"?maxwidth=800&photo_reference={photo_ref}&key={GOOGLE_PLACES_API_KEY}"
            )
        except Exception as exc:
            print(f"[HotelImageService] Google Places fetch failed: {exc}")
            return None



    def save_uploaded_image(self, file_storage) -> str | None:
        """
        Save a Werkzeug FileStorage object to uploads/hotel_images/.
        Returns the public URL path (/uploads/hotel_images/<filename>).
        """
        if not file_storage or not file_storage.filename:
            return None
        if not _allowed_file(file_storage.filename):
            raise ValueError(
                f"File type not allowed. Allowed: {', '.join(ALLOWED_EXTENSIONS)}"
            )

        ext = file_storage.filename.rsplit(".", 1)[1].lower()
        safe_name = f"{uuid.uuid4().hex}.{ext}"
        save_path = os.path.join(UPLOAD_FOLDER, safe_name)

        file_storage.save(save_path)
        return f"/uploads/hotel_images/{safe_name}"

    @staticmethod
    def resolve_image(fetched_url: str | None, uploaded_url: str | None) -> str | None:
        return uploaded_url if uploaded_url else fetched_url
