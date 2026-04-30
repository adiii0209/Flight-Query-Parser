"""
hotel_parser.py
===============
Hotel Booking Parser — reuses the OpenRouter LLM client pattern from query_parser.py.

Dates are extracted PURELY by the LLM (YYYY-MM-DD instruction in prompt).
Post-extraction validation ensures check_in < check_out.
"""

import json
import os
import re
import uuid
from datetime import datetime
from typing import Optional

import requests
from dotenv import load_dotenv

load_dotenv()

# ── Reuse the same OpenRouter config as query_parser.py ──────────────────────
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
OPENROUTER_URL = os.getenv("OPENROUTER_URL", "https://openrouter.ai/api/v1/chat/completions")
MODEL = os.getenv("MODEL", "openai/gpt-4o-mini")

HOTEL_MAX_TOKENS = 1200
TEMPERATURE = 0

# ── Schema ────────────────────────────────────────────────────────────────────
HOTEL_BOOKING_SCHEMA = {
    "booking_id":            "string | null",
    "hotel_name":            "string | null",
    "hotel_address":         "string | null",
    "hotel_phone":           "string | null",
    "guest_name":            "string | null",
    "num_guests":            "integer | null",
    "check_in_date":         "YYYY-MM-DD | null",
    "check_out_date":        "YYYY-MM-DD | null",
    "check_in_time":         "string e.g. 14:00 or 2:00 PM | null",
    "check_out_time":        "string e.g. 11:00 or 11:00 AM | null",
    "room_type":             "string | null",
    "room_count":            "integer | null",
    "rooms": [{
        "room_type":         "string | null",
        "guest_count":       "integer | null",
        "guests":            ["array of guest names or guest labels"],
        "guest_summary":     "string | null",
    }],
    "amenities":             ["array of strings"],
    "meal_plan":             "string | null",
    "total_amount":          "number | null",
    "currency":              "currency code or symbol text exactly as written, e.g. INR, USD, AED, Rs, $ | null",
    "special_instructions":  "string | null",
}

SYSTEM_PROMPT = f"""You are a hotel booking data extraction assistant.

Extract structured hotel booking data from the provided text.

Return ONLY valid JSON matching this exact schema:
{json.dumps(HOTEL_BOOKING_SCHEMA, indent=2)}

CRITICAL RULES:
- Return JSON ONLY — no prose, no markdown fences, no explanation
- Use null for any missing or unclear fields
- Dates MUST be output in YYYY-MM-DD format — convert any other format you find
- check_in_date is the arrival / check-in date at the hotel
- check_out_date is the departure / check-out date from the hotel
- check_in_date MUST be before check_out_date — if they appear swapped, correct them
- amenities MUST always be an array of strings (use [] if none found)
- num_guests and room_count MUST be integers
- extract all rooms and all guests when present
- if guest-to-room segmentation is unclear, still keep the room and guest information in the rooms array using guest_summary or a best-effort guests list
- total_amount MUST be a plain number (no currency symbols, commas, or spaces)
- extract the actual currency written near the total amount; keep the real code or symbol text if present instead of defaulting to INR
"""


class HotelParser:
    """
    Parses raw hotel booking text into a structured BookingData dict.
    Dates are fully LLM-extracted; only strict ISO validation happens post-LLM.
    """

    # ── LLM call ──────────────────────────────────────────────────────────────

    def _call_llm_raw(self, text: str) -> Optional[str]:
        """POST to OpenRouter. Returns raw content string or None on failure."""
        if not OPENROUTER_API_KEY:
            raise RuntimeError("OPENROUTER_API_KEY is not set in .env")
        try:
            response = requests.post(
                OPENROUTER_URL,
                headers={
                    "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": MODEL,
                    "messages": [
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user",   "content": text},
                    ],
                    "max_tokens": HOTEL_MAX_TOKENS,
                    "temperature": TEMPERATURE,
                },
                timeout=60,
            )
            if response.status_code != 200:
                print(f"[HotelParser] API error {response.status_code}: {response.text}")
                return None
            content = response.json()["choices"][0]["message"]["content"].strip()
            # Strip markdown fences (same cleanup as query_parser)
            content = re.sub(r"^```(?:json)?\s*", "", content, flags=re.IGNORECASE)
            content = re.sub(r"\s*```$", "", content)
            return content.strip()
        except Exception as exc:
            print(f"[HotelParser] LLM call failed: {exc}")
            return None

    def _call_llm(self, text: str) -> Optional[dict]:
        """Call LLM and parse the outermost JSON object."""
        content = self._call_llm_raw(text)
        if not content:
            return None
        start = content.find("{")
        end   = content.rfind("}")
        if start == -1 or end == -1 or end <= start:
            print(f"[HotelParser] No JSON object in response: {content[:200]}")
            return None
        try:
            return json.loads(content[start:end + 1])
        except json.JSONDecodeError as exc:
            print(f"[HotelParser] JSON parse error: {exc}")
            return None

    # ── Type-safe helpers ─────────────────────────────────────────────────────

    @staticmethod
    def _safe_str(value) -> Optional[str]:
        s = str(value).strip() if value is not None else None
        return None if (not s or s.lower() in ("null", "none", "n/a")) else s

    @staticmethod
    def _safe_int(value) -> Optional[int]:
        if value is None:
            return None
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _safe_float(value) -> Optional[float]:
        if value is None:
            return None
        try:
            # Remove commas/spaces that LLM might sneak in despite the prompt
            cleaned = str(value).replace(",", "").replace(" ", "")
            return float(cleaned)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _normalize_currency(value) -> Optional[str]:
        s = HotelParser._safe_str(value)
        if not s:
            return None
        cleaned = re.sub(r"\s+", " ", s).strip()
        symbol_map = {
            "\u20b9": "INR",
            "rs": "INR",
            "rs.": "INR",
            "inr": "INR",
            "$": "USD",
            "usd": "USD",
            "us$": "USD",
            "\u20ac": "EUR",
            "eur": "EUR",
            "\u00a3": "GBP",
            "gbp": "GBP",
            "aed": "AED",
            "sgd": "SGD",
            "cad": "CAD",
            "aud": "AUD",
        }
        mapped = symbol_map.get(cleaned.lower())
        return mapped or cleaned.upper()

    @staticmethod
    def _extract_booking_id(text: str) -> Optional[str]:
        patterns = [
            r"(?i)\b(?:booking\s*(?:id|no|number)|confirmation\s*(?:id|no|number)?|reservation\s*(?:id|no|number)?)\b\s*[:#-]?\s*([A-Z0-9][A-Z0-9\-\/]{4,})",
            r"(?i)\b(?:conf(?:irmation)?\.?)\b\s*[:#-]?\s*([A-Z0-9][A-Z0-9\-\/]{4,})",
        ]
        for pattern in patterns:
            match = re.search(pattern, text or "")
            if match:
                return match.group(1).strip()
        return None

    @staticmethod
    def _extract_amount_and_currency(text: str) -> tuple[Optional[float], Optional[str]]:
        if not text:
            return None, None

        patterns = [
            r"(?is)\b(?:total\s*(?:amount|amt)?|amount\s*payable|grand\s*total|total\s*charges|booking\s*amount)\b[^0-9A-Z$\u20B9\u20AC\u00A3]{0,20}([A-Z]{3}|Rs\.?|\u20B9|\$|\u20AC|\u00A3|AED|SGD|USD|EUR|GBP)?\s*([0-9][0-9,\s]*(?:\.\d{1,2})?)",
            r"(?is)([A-Z]{3}|Rs\.?|\u20B9|\$|\u20AC|\u00A3|AED|SGD|USD|EUR|GBP)\s*([0-9][0-9,\s]*(?:\.\d{1,2})?)",
        ]

        for pattern in patterns:
            for match in re.finditer(pattern, text):
                amount = HotelParser._safe_float(match.group(2))
                if amount is None:
                    continue
                currency = HotelParser._normalize_currency(match.group(1))
                return amount, currency
        return None, None

    @staticmethod
    def _normalize_rooms(raw_rooms, fallback_room_type: Optional[str], fallback_room_count: Optional[int],
                         fallback_guest_name: Optional[str], fallback_num_guests: Optional[int]):
        rooms = []
        if isinstance(raw_rooms, list):
            for item in raw_rooms:
                if not isinstance(item, dict):
                    continue
                guests = item.get("guests") or []
                if not isinstance(guests, list):
                    guests = [guests]
                guest_values = [
                    str(g).strip() for g in guests
                    if g is not None and str(g).strip()
                ]
                room = {
                    "room_type": HotelParser._safe_str(item.get("room_type")),
                    "guest_count": HotelParser._safe_int(item.get("guest_count")),
                    "guests": guest_values,
                    "guest_summary": HotelParser._safe_str(item.get("guest_summary")),
                }
                if room["guest_count"] is None and guest_values:
                    room["guest_count"] = len(guest_values)
                if room["room_type"] or room["guests"] or room["guest_summary"]:
                    rooms.append(room)

        if rooms:
            return rooms

        fallback_rooms = max(fallback_room_count or 0, 1 if fallback_room_type or fallback_guest_name or fallback_num_guests else 0)
        if not fallback_rooms:
            return []

        if fallback_guest_name:
            guest_values = [fallback_guest_name.strip()]
        else:
            guest_values = []

        summary = None
        if fallback_num_guests and not guest_values:
            summary = f"{fallback_num_guests} guest(s)"

        return [{
            "room_type": fallback_room_type,
            "guest_count": len(guest_values) or fallback_num_guests,
            "guests": guest_values,
            "guest_summary": summary,
        } for _ in range(fallback_rooms)]

    @staticmethod
    def _rooms_guest_count(rooms) -> Optional[int]:
        total = 0
        seen = False
        for room in rooms or []:
            guests = room.get("guests") or []
            if guests:
                total += len(guests)
                seen = True
            elif room.get("guest_count"):
                total += int(room["guest_count"])
                seen = True
        return total if seen else None

    @staticmethod
    def _primary_guest_name(rooms) -> Optional[str]:
        for room in rooms or []:
            guests = room.get("guests") or []
            for guest in guests:
                guest_name = HotelParser._safe_str(guest)
                if guest_name:
                    return guest_name
            summary = HotelParser._safe_str(room.get("guest_summary"))
            if summary:
                return summary
        return None

    # ── Date validation (pure ISO check — no regex date parsing) ─────────────

    @staticmethod
    def _validate_iso_date(value) -> Optional[str]:
        """
        Accept ONLY YYYY-MM-DD strings from the LLM.
        If the LLM ignored the format instruction, try a lightweight
        fallback for the most common slip-ups, then give up.
        Returns None if the date cannot be made valid.
        """
        if not value:
            return None
        s = str(value).strip()

        # Already correct
        if re.match(r"^\d{4}-\d{2}-\d{2}$", s):
            try:
                datetime.strptime(s, "%Y-%m-%d")
                return s
            except ValueError:
                return None  # e.g. 2024-13-01

        # LLM occasionally returns DD/MM/YYYY or DD-MM-YYYY despite the prompt
        for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%m/%d/%Y", "%d %b %Y",
                    "%d %B %Y", "%B %d, %Y", "%d %b %y", "%Y/%m/%d"):
            try:
                return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
            except ValueError:
                continue

        print(f"[HotelParser] Could not parse date: '{s}'")
        return None

    @staticmethod
    def _validate_date_order(ci: Optional[str], co: Optional[str]):
        """
        Validate check_in < check_out.
        Returns (ci, co) — swapped if they were reversed, or (None, None) if invalid.
        """
        if not ci or not co:
            return ci, co
        try:
            d_in  = datetime.strptime(ci, "%Y-%m-%d")
            d_out = datetime.strptime(co, "%Y-%m-%d")
        except ValueError:
            return ci, co  # can't compare — pass through as-is

        if d_in == d_out:
            print("[HotelParser] Warning: check_in == check_out. Keeping as-is.")
            return ci, co

        if d_in > d_out:
            print(f"[HotelParser] Dates swapped ({ci} > {co}), correcting.")
            return co, ci   # swap

        return ci, co       # correct order

    # ── Normalisation ─────────────────────────────────────────────────────────

    def _normalize(self, raw: dict, original_text: str) -> dict:
        """Validate and normalise LLM output into a clean BookingData dict."""
        amenities = raw.get("amenities") or []
        if not isinstance(amenities, list):
            amenities = [str(amenities)]
        amenities = [str(a).strip() for a in amenities if a and str(a).strip()]

        # Dates — validated via strict ISO check, then cross-validated
        ci = self._validate_iso_date(raw.get("check_in_date"))
        co = self._validate_iso_date(raw.get("check_out_date"))
        ci, co = self._validate_date_order(ci, co)
        amount = self._safe_float(raw.get("total_amount"))
        currency = self._normalize_currency(raw.get("currency"))
        fallback_amount, fallback_currency = self._extract_amount_and_currency(original_text)
        booking_id = self._safe_str(raw.get("booking_id")) or self._extract_booking_id(original_text)
        raw_guest_name = self._safe_str(raw.get("guest_name"))
        raw_num_guests = self._safe_int(raw.get("num_guests"))
        raw_room_type = self._safe_str(raw.get("room_type"))
        raw_room_count = self._safe_int(raw.get("room_count")) or 1
        rooms = self._normalize_rooms(
            raw.get("rooms"),
            raw_room_type,
            raw_room_count,
            raw_guest_name,
            raw_num_guests,
        )
        derived_guest_name = self._primary_guest_name(rooms)
        derived_num_guests = self._rooms_guest_count(rooms)
        primary_room_type = next((room.get("room_type") for room in rooms if room.get("room_type")), raw_room_type)

        return {
            "booking_id":            booking_id or str(uuid.uuid4())[:8].upper(),
            "hotel_name":            self._safe_str(raw.get("hotel_name")),
            "hotel_address":         self._safe_str(raw.get("hotel_address")),
            "hotel_phone":           self._safe_str(raw.get("hotel_phone")),
            "guest_name":            raw_guest_name or derived_guest_name,
            "num_guests":            raw_num_guests or derived_num_guests,
            "check_in_date":         ci,
            "check_out_date":        co,
            "check_in_time":         self._safe_str(raw.get("check_in_time")),
            "check_out_time":        self._safe_str(raw.get("check_out_time")),
            "room_type":             primary_room_type,
            "room_count":            raw_room_count or max(len(rooms), 1),
            "rooms":                 rooms,
            "amenities":             amenities,
            "meal_plan":             self._safe_str(raw.get("meal_plan")),
            "total_amount":          amount if amount is not None else fallback_amount,
            "currency":              currency or fallback_currency,
            "special_instructions":  self._safe_str(raw.get("special_instructions")),
            "image_url":             None,       # filled by HotelImageService
            "raw_text":              original_text,
        }

    # ── Public API ────────────────────────────────────────────────────────────

    def parse(self, raw_text: str) -> dict:
        """
        Parse raw hotel booking text → normalised BookingData dict.
        Dates are extracted by LLM and validated post-extraction.
        """
        if not raw_text or not raw_text.strip():
            raise ValueError("raw_text is empty — nothing to parse")

        raw = self._call_llm(raw_text)
        if not raw:
            return self._normalize({}, raw_text)

        return self._normalize(raw, raw_text)
