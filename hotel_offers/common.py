"""Helpers shared by the admin routes and the public client page (this file must not import login code)."""
import os

from flask import request
from sqlalchemy import Integer, inspect, text

from extensions import db
from models_rbac import Organization

from . import settings
from .models import HotelOffer, HotelOfferConfig, HotelOfferLead, HotelOfferLive, HotelQuote, HotelTrip, HotelTripPhoto

_tables_ready = False


def ensure_tables():
    global _tables_ready
    if _tables_ready:
        return
    insp = inspect(db.engine)
    for model in (HotelOfferConfig, HotelOffer, HotelOfferLive, HotelOfferLead, HotelTrip, HotelQuote, HotelTripPhoto):
        name = model.__tablename__
        if insp.has_table(name):
            col = next((c for c in insp.get_columns(name) if c["name"] == "organization_id"), None)
            if col is not None and isinstance(col["type"], Integer):
                # first release used an integer org id; org ids are UUID strings. Table was unusable, so rebuild.
                model.__table__.drop(db.engine)
        model.__table__.create(db.engine, checkfirst=True)
    # columns added after the first release (create_all never alters an existing table)
    have = {c["name"] for c in inspect(db.engine).get_columns("hotel_offer_lead")}
    for col in ("stay_from", "stay_to"):
        if col not in have:
            with db.engine.begin() as conn:
                conn.execute(text(f"ALTER TABLE hotel_offer_lead ADD COLUMN {col} DATE"))
    if "selection" not in {c["name"] for c in inspect(db.engine).get_columns("hotel_trip")}:
        with db.engine.begin() as conn:
            conn.execute(text("ALTER TABLE hotel_trip ADD COLUMN selection TEXT"))
    if "guide" not in {c["name"] for c in inspect(db.engine).get_columns("hotel_trip")}:
        with db.engine.begin() as conn:
            conn.execute(text("ALTER TABLE hotel_trip ADD COLUMN guide TEXT"))
    _tables_ready = True


def base_url():
    """Origin of the current request, honouring the proxy's forwarded headers."""
    proto = request.headers.get("X-Forwarded-Proto", request.scheme).split(",")[0].strip()
    host = request.headers.get("X-Forwarded-Host", request.host).split(",")[0].strip()
    return f"{proto}://{host}"


def public_base(org_id):
    """Origin used in share links: the configured public domain, else the one the request came in on."""
    cfg = settings.get_config(org_id, include_env=False)
    value = (cfg.get("public_base_url") or os.getenv("HOTEL_OFFERS_PUBLIC_URL") or "").strip().rstrip("/")
    if value and not value.startswith(("http://", "https://")):
        value = "https://" + value
    return value or base_url()


def org_slug(org_id):
    if not org_id:
        return "_"
    org = db.session.get(Organization, org_id)
    return org.slug if org else "_"
