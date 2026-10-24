import json
from datetime import datetime

from extensions import db


class HotelOfferConfig(db.Model):
    """One JSON settings blob per organization ("" = no organization)."""
    __tablename__ = "hotel_offer_config"

    id = db.Column(db.Integer, primary_key=True)
    organization_id = db.Column(db.String(36), nullable=False, unique=True, index=True, default="")
    data = db.Column(db.Text, nullable=False, default="{}")
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def load(self):
        try:
            return json.loads(self.data or "{}")
        except ValueError:
            return {}


class HotelOffer(db.Model):
    """A saved offer: the parsed/edited fields plus the template and photos chosen."""
    __tablename__ = "hotel_offer"

    id = db.Column(db.Integer, primary_key=True)
    organization_id = db.Column(db.String(36), nullable=False, index=True, default="")
    user_id = db.Column(db.String(36), nullable=True)
    title = db.Column(db.String(255), nullable=False, default="")
    data = db.Column(db.Text, nullable=False, default="{}")
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self, with_data=True):
        out = {
            "id": self.id,
            "title": self.title,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
        if with_data:
            try:
                out["data"] = json.loads(self.data or "{}")
            except ValueError:
                out["data"] = {}
        return out


class HotelOfferLive(db.Model):
    """A published offer: the poster picture the agent approved plus a public-safe snapshot of its details."""
    __tablename__ = "hotel_offer_live"

    id = db.Column(db.Integer, primary_key=True)
    offer_id = db.Column(db.Integer, nullable=False, unique=True, index=True)
    organization_id = db.Column(db.String(36), nullable=False, index=True, default="")
    slug = db.Column(db.String(80), nullable=False, unique=True, index=True)
    template_id = db.Column(db.String(40), nullable=False, default="")
    valid_till = db.Column(db.Date, nullable=True)
    is_live = db.Column(db.Boolean, nullable=False, default=True)
    snapshot = db.Column(db.Text, nullable=False, default="{}")
    image = db.Column(db.LargeBinary, nullable=True)
    image_mime = db.Column(db.String(40), nullable=False, default="image/jpeg")
    image_w = db.Column(db.Integer, nullable=False, default=0)
    image_h = db.Column(db.Integer, nullable=False, default=0)
    views = db.Column(db.Integer, nullable=False, default=0)
    published_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def snap(self):
        try:
            return json.loads(self.snapshot or "{}")
        except ValueError:
            return {}


class HotelOfferLead(db.Model):
    """A client who tapped Book now on a live offer."""
    __tablename__ = "hotel_offer_lead"

    id = db.Column(db.Integer, primary_key=True)
    live_id = db.Column(db.Integer, nullable=True, index=True)
    offer_id = db.Column(db.Integer, nullable=True)
    organization_id = db.Column(db.String(36), nullable=False, index=True, default="")
    offer_title = db.Column(db.String(255), nullable=False, default="")
    name = db.Column(db.String(120), nullable=False, default="")
    phone = db.Column(db.String(32), nullable=False, default="")
    status = db.Column(db.String(16), nullable=False, default="new")  # new | contacted | won | lost
    note = db.Column(db.Text, nullable=False, default="")
    stay_from = db.Column(db.Date, nullable=True)
    stay_to = db.Column(db.Date, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)

    def to_dict(self):
        return {
            "id": self.id, "offer_id": self.offer_id, "offer_title": self.offer_title, "name": self.name, "phone": self.phone,
            "status": self.status, "note": self.note,
            "stay_from": self.stay_from.isoformat() if self.stay_from else None, "stay_to": self.stay_to.isoformat() if self.stay_to else None,
            "created_at": self.created_at.isoformat() + "Z" if self.created_at else None,
        }


class HotelTrip(db.Model):
    """A client trip: a container of hotel quotes, optionally shared by link."""
    __tablename__ = "hotel_trip"

    id = db.Column(db.Integer, primary_key=True)
    organization_id = db.Column(db.String(36), nullable=False, index=True, default="")
    user_id = db.Column(db.String(36), nullable=True)
    lead_id = db.Column(db.Integer, nullable=True)  # HotelOfferLead this trip was converted from
    title = db.Column(db.String(255), nullable=False, default="")
    client_name = db.Column(db.String(120), nullable=False, default="")
    client_phone = db.Column(db.String(32), nullable=False, default="")
    destination = db.Column(db.String(160), nullable=False, default="")
    start_date = db.Column(db.Date, nullable=True)
    end_date = db.Column(db.Date, nullable=True)
    notes = db.Column(db.Text, nullable=False, default="")
    currency = db.Column(db.String(8), nullable=False, default="INR")
    share_slug = db.Column(db.String(40), nullable=True, unique=True, index=True)
    is_shared = db.Column(db.Boolean, nullable=False, default=False)
    selection = db.Column(db.Text, nullable=True)  # JSON {group key: option key} chosen by the guest on the shared page
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def selection_map(self):
        try:
            data = json.loads(self.selection or "{}")
        except ValueError:
            return {}
        return data if isinstance(data, dict) else {}

    def to_dict(self, quote_count=None, total=None):
        out = {
            "id": self.id, "lead_id": self.lead_id, "title": self.title, "client_name": self.client_name,
            "client_phone": self.client_phone, "destination": self.destination,
            "start_date": self.start_date.isoformat() if self.start_date else None,
            "end_date": self.end_date.isoformat() if self.end_date else None,
            "notes": self.notes, "currency": self.currency, "is_shared": bool(self.is_shared), "share_slug": self.share_slug, "selection": self.selection_map(),
            "updated_at": self.updated_at.isoformat() + "Z" if self.updated_at else None,
        }
        if quote_count is not None:
            out["quote_count"], out["total"] = quote_count, total
        return out


class HotelQuote(db.Model):
    """One hotel quote inside a trip (a row of the quotation sheet). Fields live in the JSON blob."""
    __tablename__ = "hotel_quote"

    id = db.Column(db.Integer, primary_key=True)
    trip_id = db.Column(db.Integer, nullable=False, index=True)
    organization_id = db.Column(db.String(36), nullable=False, index=True, default="")
    position = db.Column(db.Integer, nullable=False, default=0)
    data = db.Column(db.Text, nullable=False, default="{}")
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def load(self):
        try:
            return json.loads(self.data or "{}")
        except ValueError:
            return {}

    def to_dict(self):
        d = self.load()
        d["id"], d["position"] = self.id, self.position
        return d


class HotelTripPhoto(db.Model):
    """A hotel picture added by hand (upload, clipboard or image link), stored shrunk as JPEG."""
    __tablename__ = "hotel_trip_photo"

    id = db.Column(db.Integer, primary_key=True)
    organization_id = db.Column(db.String(36), nullable=False, index=True, default="")
    mime = db.Column(db.String(40), nullable=False, default="image/jpeg")
    data = db.Column(db.LargeBinary, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
