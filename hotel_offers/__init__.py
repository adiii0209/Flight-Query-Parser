"""Hotel Offers module: turns pasted hotel offer text into branded promo templates and a public client page.

Self-contained: models, parsing, photo search, routes, templates and static assets all live here.
Main app:        app.register_blueprint(hotel_offers_bp)       (admin + client page)
Public service:  hotel_offers.standalone.create_public_app()    (client page only, own domain)
"""


def __getattr__(name):  # imported lazily so `hotel_offers.standalone` doesn't pull in the admin/login code
    if name == "hotel_offers_bp":
        from .routes import hotel_offers_bp
        return hotel_offers_bp
    raise AttributeError(name)
