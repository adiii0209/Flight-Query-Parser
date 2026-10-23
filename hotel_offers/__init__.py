"""Hotel Offers module: turns pasted hotel offer text into branded promo templates.

Self-contained: models, parsing, photo search, routes, templates and static assets all live here.
The host app only needs `app.register_blueprint(hotel_offers_bp)`.
"""
from .routes import hotel_offers_bp

__all__ = ["hotel_offers_bp"]
