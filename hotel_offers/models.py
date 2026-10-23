import json
from datetime import datetime

from extensions import db


class HotelOfferConfig(db.Model):
    """One JSON settings blob per organization (0 = no organization)."""
    __tablename__ = "hotel_offer_config"

    id = db.Column(db.Integer, primary_key=True)
    organization_id = db.Column(db.Integer, nullable=False, unique=True, index=True, default=0)
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
    organization_id = db.Column(db.Integer, nullable=False, index=True, default=0)
    user_id = db.Column(db.Integer, nullable=True)
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
