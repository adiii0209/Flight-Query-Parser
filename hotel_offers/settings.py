import os

from extensions import db
from .models import HotelOfferConfig

DEFAULTS = {
    # AI parsing
    "ai_provider": "openrouter",         # openrouter | anthropic | openai | gemini
    "ai_api_key": "",
    "ai_model": "google/gemini-2.0-flash-001",
    "ai_temperature": 0.2,
    "ai_max_tokens": 1500,
    "ai_timeout": 45,
    "ai_use_fallback": True,             # regex parser when the AI call fails / no key
    "ai_system_prompt": "",              # empty = built-in prompt
    # Photos
    "photo_default_source": "unsplash",  # unsplash | google
    "unsplash_access_key": "",
    "google_places_key": "",
    "photo_per_page": 12,
    # Trip maps (Leaflet raster tile template)
    "map_tile_url": "https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&scale=2",
    # Pricing suggestions (all editable per offer)
    "markup_percent": 0,                 # our deal = net total + markup
    "online_rate_multiplier": 1.35,      # struck-through "online rate" = net total x this
    "price_rounding": 1000,
    # Client page (public) and leads
    "whatsapp_number": "919831020008",    # digits only, with country code
    "wa_message": "Hi Time Tours, I'm interested in {offer}. My name is {name} ({phone}).",
    "lead_notify": True,
    "lead_email": "mail@timetours.in",
    "public_base_url": "",               # e.g. https://elevate.timetours.in (domain used in share links)
    "client_title": "Time Elevate",
    "client_subtitle": "Hand-picked luxury stays, curated by Time Tours.",
    # Fixed brand text printed on every template
    "brand_name": "Time Elevate",
    "brand_tagline": "Luxury stays.\nMore to enjoy.",
    "brand_header_note": "Exclusive offers\nat the world's finest\nhotels & resorts.",
    "brand_footer": "Curated by Time Tours",
    "brand_est": "EST. 1978",
    "enquire_label": "Enquire now",
    "loyalty_note": "Earn your standard hotel loyalty points and elite night credits on eligible stays.",
    "availability_note": "*Subject to availability.",
    "inr_disclaimer": "INR rates are indicative and may change with the exchange rate on the day of payment. The final amount is confirmed at the time of booking.",
}

SECRET_KEYS = ("ai_api_key", "unsplash_access_key", "google_places_key")
ENV_FALLBACKS = {
    "unsplash_access_key": "UNSPLASH_ACCESS_KEY",
    "google_places_key": "GOOGLE_PLACES_API_KEY",
}
AI_ENV = {"openrouter": "OPENROUTER_API_KEY", "anthropic": "ANTHROPIC_API_KEY", "openai": "OPENAI_API_KEY", "gemini": "GEMINI_API_KEY"}


def _row(org_id):
    row = HotelOfferConfig.query.filter_by(organization_id=org_id or "").first()
    return row


def get_config(org_id, include_env=True):
    cfg = dict(DEFAULTS)
    row = _row(org_id)
    if row:
        cfg.update({k: v for k, v in row.load().items() if k in DEFAULTS})
    if include_env:
        for key, env in ENV_FALLBACKS.items():
            if not cfg.get(key):
                cfg[key] = os.getenv(env, "")
        if not cfg.get("ai_api_key"):
            cfg["ai_api_key"] = os.getenv(AI_ENV.get(cfg["ai_provider"], ""), "")
    return cfg


def public_config(org_id):
    """Config for the browser: secrets replaced by a flag + masked tail."""
    cfg = get_config(org_id, include_env=False)
    for key in SECRET_KEYS:
        value = cfg.get(key) or ""
        cfg[key] = ""
        cfg[key + "_set"] = bool(value) or bool(os.getenv(ENV_FALLBACKS.get(key, "") or AI_ENV.get(cfg["ai_provider"], ""), ""))
        cfg[key + "_hint"] = ("…" + value[-4:]) if len(value) >= 8 else ""
    return cfg


def _coerce(key, value):
    default = DEFAULTS[key]
    if isinstance(default, bool):
        return value if isinstance(value, bool) else str(value).lower() in ("1", "true", "yes", "on")
    if isinstance(default, int):
        return int(float(value))
    if isinstance(default, float):
        return float(value)
    return str(value)


def save_config(org_id, incoming):
    row = _row(org_id)
    current = row.load() if row else {}
    for key, value in (incoming or {}).items():
        if key not in DEFAULTS:
            continue
        if key in SECRET_KEYS and (value is None or value == ""):
            continue  # blank = keep the stored secret
        if key in SECRET_KEYS and value == "__clear__":
            current.pop(key, None)
            continue
        if key == "map_tile_url" and value and not str(value).strip().startswith("https://"):
            continue  # tile templates must be https URLs
        try:
            current[key] = _coerce(key, value)
        except (TypeError, ValueError):
            continue
    import json
    if row is None:
        row = HotelOfferConfig(organization_id=org_id or "")
        db.session.add(row)
    row.data = json.dumps(current)
    db.session.commit()
