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
