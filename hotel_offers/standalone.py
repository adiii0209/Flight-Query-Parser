"""Client-page-only Flask app for hosting on its own domain (shares the main app's database)."""
import os

from flask import Flask, jsonify, redirect

from extensions import db


def _database_uri():
    url = (os.getenv("DATABASE_URL") or "").strip()
    if not url:
        raise RuntimeError("DATABASE_URL is required: the public service reads the same database as the main app.")
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    try:
        import psycopg  # noqa: F401
        has3 = True
    except ImportError:
        has3 = False
    for prefix in ("postgresql+psycopg3://", "postgresql+psycopg://", "postgresql://"):
        if url.startswith(prefix) and has3:
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


def create_public_app():
    import models  # noqa: F401  (the workspace model's relationships need User registered)
    import models_rbac  # noqa: F401

    from .public import public_bp
    from .trips_public import trips_public_bp

    app = Flask(__name__)  # templates live in hotel_offers/templates
    app.config["SQLALCHEMY_DATABASE_URI"] = _database_uri()
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {"pool_pre_ping": True, "pool_recycle": 300, "pool_size": 5, "max_overflow": 5, "pool_timeout": 30}
    db.init_app(app)
    app.register_blueprint(public_bp)
    app.register_blueprint(trips_public_bp)

    @app.route("/")
    def home():
        return redirect("/offers")

    @app.route("/healthz")
    def healthz():
        return jsonify({"ok": True})

    @app.route("/robots.txt")
    def robots():
        return "User-agent: *\nAllow: /\n", 200, {"Content-Type": "text/plain"}

    return app
