"""reviews.timetours.in: the QR lands here, the customer writes (or speaks) their own review, and Google's review panel opens."""
import os
from datetime import datetime, timedelta

from flask import Flask, abort, jsonify, redirect, render_template, request
from sqlalchemy import func, inspect

from extensions import db
from hotel_offers.standalone import _database_uri

DEFAULT_REVIEW_LINK = "https://g.page/r/CVAJ_EaMmS9uEBM/review"
KINDS = ("view", "start", "open")  # page opened, Give review tapped, Google opened


class ReviewEvent(db.Model):
    __tablename__ = "review_event"

    id = db.Column(db.Integer, primary_key=True)
    kind = db.Column(db.String(16), nullable=False, index=True)
    source = db.Column(db.String(40), nullable=False, default="")  # ?s=front-desk, ?s=goa ... one QR per place or person
    copied = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)


def _review_link():
    return (os.getenv("GOOGLE_REVIEW_LINK") or DEFAULT_REVIEW_LINK).strip()


def _clean_source(raw):
    return "".join(c for c in (raw or "").lower() if c.isalnum() or c in "-_")[:40]


def create_reviews_app():
    app = Flask(__name__)
    app.config["SQLALCHEMY_DATABASE_URI"] = _database_uri()
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {"pool_pre_ping": True, "pool_recycle": 300, "pool_size": 3, "max_overflow": 3}
    db.init_app(app)

    ready = {"ok": False}

    @app.before_request
    def _tables():
        if not ready["ok"]:
            ReviewEvent.__table__.create(db.engine, checkfirst=True)
            ready["ok"] = True

    def _log(kind, source, copied=False):
        db.session.add(ReviewEvent(kind=kind, source=_clean_source(source), copied=bool(copied)))
        db.session.commit()

    @app.route("/")
    def home():
        source = request.args.get("s", "")
        try:
            _log("view", source)
        except Exception:
            db.session.rollback()
        return render_template("reviews/index.html", link=_review_link(), source=_clean_source(source))

    @app.route("/e", methods=["POST"])
    def event():
        data = request.get_json(silent=True) or {}
        kind = data.get("kind")
        if kind not in KINDS:
            abort(400)
        try:
            _log(kind, data.get("source"), data.get("copied"))
        except Exception:
            db.session.rollback()
        return jsonify({"ok": True})

    @app.route("/go")
    def go():
        """Plain redirect for a QR that should skip the helper page."""
        try:
            _log("open", request.args.get("s", ""))
        except Exception:
            db.session.rollback()
        return redirect(_review_link(), code=302)

    @app.route("/stats")
    def stats():
        key = (os.getenv("REVIEWS_STATS_KEY") or "").strip()
        if not key or request.args.get("key") != key:
            abort(404)
        since = datetime.utcnow() - timedelta(days=int(request.args.get("days", 30)))
        rows = (db.session.query(ReviewEvent.source, ReviewEvent.kind, func.count())
                .filter(ReviewEvent.created_at >= since).group_by(ReviewEvent.source, ReviewEvent.kind).all())
        out = {}
        for source, kind, n in rows:
            out.setdefault(source or "(none)", {k: 0 for k in KINDS})[kind] = n
        return jsonify({"since": since.date().isoformat(), "by_source": out})

    @app.route("/healthz")
    def healthz():
        return jsonify({"ok": True})

    return app
