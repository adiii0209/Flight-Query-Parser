"""reviews.timetours.in: the QR lands here, the customer writes (or speaks) their own review, and Google's review panel opens."""
import hashlib
import os
import random
import secrets
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta

from flask import Flask, abort, jsonify, redirect, render_template, request, session
from sqlalchemy import func, or_

from extensions import db
from hotel_offers.models import HotelOfferConfig
from hotel_offers.parser import llm_text
from hotel_offers.standalone import _database_uri

DEFAULT_REVIEW_LINK = "https://g.page/r/CVAJ_EaMmS9uEBM/review"
DEFAULT_REVIEW_TEXT = "Had a wonderful trip planned by Time Tours. The team was helpful and quick to reply, and everything was arranged smoothly. Happy to recommend them for your next holiday."
POOL_SIZE = 5
POOL_SYSTEM = (
    "You write short, natural Google reviews for Time Tours, an Indian travel agency, as a happy customer would. "
    "Write 2 to 3 sentences in the first person, plain and warm. Mention only general things (helpful team, quick replies, "
    "smooth planning, hotels and flights arranged well, good value). Do not invent names, destinations, prices, dates or "
    "specific incidents, and do not exaggerate. Output only the review text, no quotes or preamble."
)
POOL_ANGLES = ("how quickly the team replied", "how smoothly the whole trip was planned", "the hotels and flights being arranged well",
               "good value for the money", "a friendly team that helped during the trip", "how easy it was to book")
KINDS = ("view", "start", "open")  # page opened, Give review tapped, Google opened
PROVIDERS = ("openrouter", "anthropic", "openai", "gemini")
AI_ENV = {"openrouter": "OPENROUTER_API_KEY", "anthropic": "ANTHROPIC_API_KEY", "openai": "OPENAI_API_KEY", "gemini": "GEMINI_API_KEY"}
TOPICS = ("Hotels", "Flights", "Trip planning", "Quick replies", "Value for money", "Sightseeing", "Support during the trip")
DRAFT_SYSTEM = (
    "You help a travel-agency customer write their own Google review. Write 2 to 4 short sentences in the first person, "
    "in a natural, plain voice, using ONLY the details the customer gave (destination, what they liked, their own note). "
    "Do not invent facts, names, prices or dates, and do not exaggerate. Output only the review text, no quotes or preamble."
)


class ReviewEvent(db.Model):
    __tablename__ = "review_event"

    id = db.Column(db.Integer, primary_key=True)
    kind = db.Column(db.String(16), nullable=False, index=True)
    source = db.Column(db.String(40), nullable=False, default="")  # ?s=front-desk, ?s=goa ... one QR per place or person
    copied = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)


class ReviewPool(db.Model):
    """Pre-generated reviews waiting to be handed out. A review is deleted once a customer uses it, then a new one is written."""
    __tablename__ = "review_pool"

    id = db.Column(db.Integer, primary_key=True)
    text = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class ReviewSetting(db.Model):
    """Key/value settings edited on the admin page: ai_provider, ai_model, ai_api_key, review_link."""
    __tablename__ = "review_setting"

    key = db.Column(db.String(40), primary_key=True)
    value = db.Column(db.Text, nullable=False, default="")


def _get_settings():
    return {r.key: r.value for r in ReviewSetting.query.all()}


def _review_link():
    return (_get_settings().get("review_link") or os.getenv("GOOGLE_REVIEW_LINK") or DEFAULT_REVIEW_LINK).strip()


def _review_text():
    return (_get_settings().get("review_text") or DEFAULT_REVIEW_TEXT).strip()


_refill_lock = threading.Lock()
_last_refill = {"t": 0.0}


def _refill_pool(app):
    """Top the pool back up to POOL_SIZE in the background; the page never waits for the AI."""
    if time.time() - _last_refill["t"] < 60:
        return
    _last_refill["t"] = time.time()

    def run():
        if not _refill_lock.acquire(blocking=False):
            return
        try:
            with app.app_context():
                cfg = _ai_config()
                if not cfg["ai_api_key"]:
                    return
                for _ in range(POOL_SIZE * 2):
                    have = [r.text for r in ReviewPool.query.all()]
                    if len(have) >= POOL_SIZE:
                        break
                    prompt = "Focus on: " + random.choice(POOL_ANGLES)
                    if have:
                        prompt += "\nWrite it differently from these existing reviews:\n- " + "\n- ".join(have)
                    text = llm_text(cfg, POOL_SYSTEM, prompt, max_tokens=200, temperature=0.9).strip().strip('"')[:1000]
                    if text and text not in have:
                        db.session.add(ReviewPool(text=text))
                        db.session.commit()
        except Exception as exc:
            app.logger.warning("review pool refill failed: %s", exc)
        finally:
            _refill_lock.release()

    threading.Thread(target=run, daemon=True).start()


def _pick_review():
    """A random pooled review (id, text), or (None, the fixed text) when the pool is empty."""
    rows = ReviewPool.query.all()
    if rows:
        r = random.choice(rows)
        return r.id, r.text
    return None, _review_text()


def _ai_config():
    """AI settings: this page's admin first, then the ones already saved for Hotel Offers, then env vars."""
    st = _get_settings()
    cfg = {"ai_provider": st.get("ai_provider") or "", "ai_model": st.get("ai_model") or "", "ai_api_key": st.get("ai_api_key") or "", "ai_timeout": 30}
    if not cfg["ai_api_key"]:
        for row in HotelOfferConfig.query.all():
            data = row.load()
            if data.get("ai_api_key"):
                cfg.update(ai_provider=data.get("ai_provider") or "openrouter", ai_model=data.get("ai_model") or cfg["ai_model"], ai_api_key=data["ai_api_key"])
                break
    cfg["ai_provider"] = cfg["ai_provider"] or "openrouter"
    if not cfg["ai_api_key"]:
        cfg["ai_api_key"] = os.getenv(AI_ENV.get(cfg["ai_provider"], ""), "")
    cfg["ai_model"] = cfg["ai_model"] or "google/gemini-2.0-flash-001"
    return cfg


def _clean_source(raw):
    return "".join(c for c in (raw or "").lower() if c.isalnum() or c in "-_")[:40]


_hits = defaultdict(deque)  # (bucket, ip) -> recent timestamps (per worker; blunts casual abuse)


def _limited(bucket, limit, window):
    ip = (request.headers.get("X-Forwarded-For", request.remote_addr or "").split(",")[0]).strip()
    q, now = _hits[(bucket, ip)], time.time()
    while q and now - q[0] > window:
        q.popleft()
    if len(q) >= limit:
        return True
    q.append(now)
    return False


def _is_admin(user):
    from models_rbac import Membership, Role
    return db.session.query(Membership.id).filter(
        Membership.user_id == user.id, Membership.is_active.is_(True),
        Membership.role.in_([Role.PLATFORM_SUPER_ADMIN, Role.AGENCY_ADMIN])).first() is not None


def _admin_user():
    from models import User
    uid = session.get("admin_id")
    user = db.session.get(User, uid) if uid else None
    return user if user and _is_admin(user) else None


def _stats(days=30):
    since = datetime.utcnow() - timedelta(days=days)
    rows = (db.session.query(ReviewEvent.source, ReviewEvent.kind, func.count())
            .filter(ReviewEvent.created_at >= since).group_by(ReviewEvent.source, ReviewEvent.kind).all())
    out = {}
    for source, kind, n in rows:
        out.setdefault(source or "(none)", {k: 0 for k in KINDS})[kind] = n
    return since, out


def create_reviews_app():
    app = Flask(__name__)
    app.config["SQLALCHEMY_DATABASE_URI"] = _database_uri()
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {"pool_pre_ping": True, "pool_recycle": 300, "pool_size": 3, "max_overflow": 3}
    app.config.update(
        SECRET_KEY=os.getenv("SECRET_KEY") or hashlib.sha256(("reviews|" + app.config["SQLALCHEMY_DATABASE_URI"]).encode()).hexdigest(),
        SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=bool(os.getenv("PORT")), PERMANENT_SESSION_LIFETIME=timedelta(hours=8))
    db.init_app(app)

    import models  # noqa: F401  (User must be registered before the models that reference it)
    import models_rbac  # noqa: F401

    ready = {"ok": False}

    @app.before_request
    def _tables():
        if not ready["ok"]:
            ReviewEvent.__table__.create(db.engine, checkfirst=True)
            ReviewSetting.__table__.create(db.engine, checkfirst=True)
            ReviewPool.__table__.create(db.engine, checkfirst=True)
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
        rid, text = None, _review_text()
        try:
            rid, text = _pick_review()
            if ReviewPool.query.count() < POOL_SIZE:
                _refill_pool(app)
        except Exception:
            db.session.rollback()
        return render_template("reviews/index.html", link=_review_link(), source=_clean_source(source), text=text, rid=rid)

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

    @app.route("/used", methods=["POST"])
    def used():
        """The customer tapped Give review with this pooled review: retire it and write a new one."""
        data = request.get_json(silent=True) or {}
        if not _limited("used", 30, 600):
            try:
                rid = int(data.get("id"))
                ReviewPool.query.filter_by(id=rid).delete()
                db.session.commit()
                _refill_pool(app)
            except Exception:
                db.session.rollback()
        return jsonify({"ok": True})

    @app.route("/draft", methods=["POST"])
    def draft():
        """AI turns the customer's own picks into a first draft that they then edit."""
        data = request.get_json(silent=True) or {}
        place = str(data.get("place") or "").strip()[:80]
        note = str(data.get("note") or "").strip()[:400]
        liked = [t for t in (data.get("liked") or []) if t in TOPICS][:7]
        if not place or not (liked or note):
            return jsonify({"error": "Add where you went and at least one thing you liked."}), 400
        if _limited("draft", 8, 600):
            return jsonify({"error": "Too many requests. Please try again in a few minutes."}), 429
        cfg = _ai_config()
        if not cfg["ai_api_key"]:
            return jsonify({"error": "Drafting is not switched on. Please write your review below."}), 503
        prompt = f"Destination: {place}\nThings I liked: {', '.join(liked) or '(none listed)'}\nMy own note: {note or '(none)'}"
        try:
            text = llm_text(cfg, DRAFT_SYSTEM, prompt, max_tokens=220, temperature=0.8).strip().strip('"')
        except Exception as exc:
            app.logger.warning("review draft failed (%s %s): %s", cfg["ai_provider"], cfg["ai_model"], exc)
            return jsonify({"error": "Could not write a draft right now. Please write your review below."}), 502
        return jsonify({"text": text[:1000]})

    @app.route("/go")
    def go():
        """Plain redirect for a QR that should skip the helper page."""
        try:
            _log("open", request.args.get("s", ""))
        except Exception:
            db.session.rollback()
        return redirect(_review_link(), code=302)

    @app.route("/admin", methods=["GET", "POST"])
    def admin():
        """Settings for this page. Sign in with a Time Tours account that is an agency admin."""
        from models import User
        error = ""
        if request.method == "POST":
            if _limited("login", 8, 600):
                error = "Too many attempts. Try again in a few minutes."
            else:
                ident = (request.form.get("user") or "").strip()
                user = User.query.filter(or_(User.email == ident.lower(), User.username == ident)).first()
                if user and user.check_password(request.form.get("password") or "") and _is_admin(user):
                    session.clear()
                    session.update(admin_id=user.id, csrf=secrets.token_urlsafe(24))
                    session.permanent = True
                    return redirect("/admin")
                error = "Wrong login, or this account is not an admin."
        user = _admin_user()
        if not user:
            session.clear()
            return render_template("reviews/admin.html", user=None, error=error)
        st, cfg = _get_settings(), _ai_config()
        since, stats = _stats()
        return render_template("reviews/admin.html", user=user, error="", csrf=session["csrf"], providers=PROVIDERS, stats=stats,
                               since=since.date().isoformat(), provider=cfg["ai_provider"], model=cfg["ai_model"],
                               key_set=bool(cfg["ai_api_key"]), key_from_here=bool(st.get("ai_api_key")), link=_review_link(), text=_review_text(),
                               pool=ReviewPool.query.count())

    @app.route("/admin/save", methods=["POST"])
    def admin_save():
        if not _admin_user() or not secrets.compare_digest(request.headers.get("X-CSRF", ""), session.get("csrf") or "-"):
            abort(403)
        data = request.get_json(silent=True) or {}
        updates = {}
        if data.get("ai_provider") in PROVIDERS:
            updates["ai_provider"] = data["ai_provider"]
        if isinstance(data.get("ai_model"), str):
            updates["ai_model"] = data["ai_model"].strip()[:120]
        if isinstance(data.get("review_link"), str):
            link = data["review_link"].strip()
            if link and not link.startswith("https://"):
                return jsonify({"error": "The review link must start with https://"}), 400
            updates["review_link"] = link
        if isinstance(data.get("review_text"), str):
            updates["review_text"] = data["review_text"].strip()[:1000]
        if data.get("clear_key"):
            updates["ai_api_key"] = ""
        elif isinstance(data.get("ai_api_key"), str) and data["ai_api_key"].strip():
            updates["ai_api_key"] = data["ai_api_key"].strip()
        for k, v in updates.items():
            row = db.session.get(ReviewSetting, k) or ReviewSetting(key=k)
            row.value = v
            db.session.add(row)
        db.session.commit()
        return jsonify({"ok": True})

    @app.route("/admin/logout", methods=["POST"])
    def admin_logout():
        session.clear()
        return redirect("/admin")

    @app.route("/stats")
    def stats():
        key = (os.getenv("REVIEWS_STATS_KEY") or "").strip()
        if not key or request.args.get("key") != key:
            abort(404)
        since, out = _stats(int(request.args.get("days", 30)))
        return jsonify({"since": since.date().isoformat(), "by_source": out})

    @app.route("/healthz")
    def healthz():
        return jsonify({"ok": True})

    return app
