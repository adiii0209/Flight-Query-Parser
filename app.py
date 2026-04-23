import os
if os.name == "nt":
    os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "C:\\pw-browsers")
else:
    os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "0")
import json
import uuid
import requests
import base64
import io
import subprocess
import sys
from flask import Flask, request, jsonify, render_template, render_template_string, session, redirect, url_for, send_file, send_from_directory, Response, stream_with_context
from dotenv import load_dotenv
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import inspect, text
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime, timedelta
from functools import wraps
import hashlib
from query_parser import extract_flight, extract_multiple_flights
from models import User, Customer, Itinerary, Ticket, Aggregator, LedgerEntry, TicketOperation, OperationLedgerLink, BookingGroup
from extensions import db

import gspread
from google.oauth2.service_account import Credentials
import re
import threading
import queue
import asyncio
import hashlib
import pytz
from collections import OrderedDict
from copy import deepcopy
from urllib.parse import urlparse
from werkzeug.utils import secure_filename
from mappings import AIRLINE_CODES, AIRPORT_CODES, AIRPORT_TZ_MAP

import pytesseract
try:
    import pdf417gen
except Exception:
    pdf417gen = None
try:
    from playwright.async_api import async_playwright
except Exception:
    async_playwright = None
try:
    from playwright.sync_api import sync_playwright
except Exception:
    sync_playwright = None

load_dotenv()
app = Flask(__name__)

def _resolve_database_uri():
    database_url = (os.getenv("DATABASE_URL") or "").strip()
    if database_url:
        if database_url.startswith("postgres://"):
            database_url = "postgresql://" + database_url[len("postgres://"):]
        return database_url

    railway_volume_path = (os.getenv("RAILWAY_VOLUME_MOUNT_PATH") or os.getenv("DB_STORAGE_PATH") or "").strip()
    if railway_volume_path:
        os.makedirs(railway_volume_path, exist_ok=True)
        return f"sqlite:///{os.path.join(railway_volume_path, 'app.db').replace(os.sep, '/')}"

    instance_db_path = os.path.join(app.instance_path, "app.db")
    os.makedirs(app.instance_path, exist_ok=True)
    return f"sqlite:///{instance_db_path.replace(os.sep, '/')}"

app.config["SQLALCHEMY_DATABASE_URI"] = _resolve_database_uri()
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {
    "pool_pre_ping": True,
    "pool_recycle": 280,
}
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "your-secret-key-change-in-production")
# 🔐 Shared secret for ticket parser
API_KEY ="timetours@1978"

UPLOAD_FOLDER = "uploads"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
RENDER_CACHE_FOLDER = os.path.join(UPLOAD_FOLDER, "render_cache")
os.makedirs(RENDER_CACHE_FOLDER, exist_ok=True)

db.init_app(app)

_playwright_runtime = None
_playwright_browser = None
_playwright_lock = threading.Lock()
_playwright_task_queue = queue.Queue(maxsize=12)
_playwright_worker_started = False
_playwright_install_attempted = False
_render_cache = OrderedDict()
_render_cache_lock = threading.Lock()
_render_cache_max = 20
_render_jobs = {}
_render_jobs_lock = threading.Lock()
_render_preview_store = {}
_render_preview_lock = threading.Lock()
_PLAYWRIGHT_RENDER_SCALE = 2
_PLAYWRIGHT_NAV_TIMEOUT_MS = 4500
_PLAYWRIGHT_READY_TIMEOUT_MS = 3000
_PLAYWRIGHT_ELEMENT_TIMEOUT_MS = 1800
_PLAYWRIGHT_QUEUE_WAIT_SECONDS = 6
_PLAYWRIGHT_RENDER_RETRIES = 2
_PLAYWRIGHT_EXTERNAL_ALLOWLIST = {"fonts.googleapis.com", "fonts.gstatic.com"}
_PLAYWRIGHT_ABORT_RESOURCE_TYPES = {"media", "websocket", "eventsource", "manifest"}
_PLAYWRIGHT_LAUNCH_ARGS = [
    "--headless=new",
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--no-zygote",
    "--single-process",
    "--disable-background-networking",
    "--disable-background-timer-throttling",
    "--disable-breakpad",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-features=Translate,BackForwardCache,AcceptCHFrame,MediaRouter,OptimizationHints",
    "--disable-hang-monitor",
    "--disable-ipc-flooding-protection",
    "--disable-popup-blocking",
    "--disable-renderer-backgrounding",
    "--force-color-profile=srgb",
    "--metrics-recording-only",
    "--mute-audio",
    "--no-first-run",
    "--password-store=basic",
    "--use-mock-keychain",
    "--font-render-hinting=medium",
]
_ticket_processing_batches = {}
_ticket_processing_lock = threading.Lock()
_TICKET_PROCESSING_TTL_SECONDS = 60 * 45
_TICKET_PROCESSING_MIN_VISIBLE_SECONDS = 6
_ticket_dashboard_streams = {}
_ticket_dashboard_streams_lock = threading.Lock()

# Register API v2 Blueprint
# Register API v2 Blueprint
from routes_v2 import api_v2
from extensions_v2 import db_session
from ocr import ocr_bp
app.register_blueprint(api_v2)
app.register_blueprint(ocr_bp)

@app.teardown_appcontext
def shutdown_session(exception=None):
    db_session.remove()

# ==================== AUTHENTICATION DECORATOR ====================

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            if not request.path.startswith("/api/"):
                return redirect(url_for("login_page", next=request.full_path if request.query_string else request.path))
            return jsonify({"error": "Authentication required"}), 401
        return f(*args, **kwargs)
    return decorated_function


# ==================== ROUTES ====================

@app.route("/")
def home():
    """Serve the main HTML page"""
    return render_template('index.html')


@app.route("/icons/<path:filename>")
def serve_icon_file(filename):
    return send_from_directory("icons", filename)


def _render_log(level, message, **kwargs):
    details = " ".join(f"{key}={value}" for key, value in kwargs.items() if value is not None)
    suffix = f" {details}" if details else ""
    print(f"[{level}] {message}{suffix}")


def _should_abort_playwright_request(route, allowed_origin):
    pw_request = route.request
    if pw_request.resource_type in _PLAYWRIGHT_ABORT_RESOURCE_TYPES:
        return True

    parsed = urlparse(pw_request.url)
    request_origin = f"{parsed.scheme}://{parsed.netloc}" if parsed.scheme and parsed.netloc else ""
    if not request_origin or request_origin == allowed_origin:
        return False
    if parsed.netloc in _PLAYWRIGHT_EXTERNAL_ALLOWLIST:
        return False
    return pw_request.resource_type not in {"document", "stylesheet", "image", "font"}


async def _get_playwright_browser():
    global _playwright_runtime, _playwright_browser
    if async_playwright is None:
        raise RuntimeError("Playwright async API is not installed on the server.")

    if _playwright_browser and _playwright_browser.is_connected():
        return _playwright_browser

    if _playwright_browser and not _playwright_browser.is_connected():
        _playwright_browser = None

    if _playwright_runtime is None:
        _playwright_runtime = await async_playwright().start()
        print("[INFO] Playwright browsers path:", os.environ.get("PLAYWRIGHT_BROWSERS_PATH", ""))

    try:
        _playwright_browser = await _playwright_runtime.chromium.launch(
            headless=True,
            args=_PLAYWRIGHT_LAUNCH_ARGS,
        )
    except Exception as exc:
        message = str(exc)
        if "Executable doesn't exist" in message and not _playwright_install_attempted:
            await _install_playwright_browsers()
            _playwright_browser = await _playwright_runtime.chromium.launch(
                headless=True,
                args=_PLAYWRIGHT_LAUNCH_ARGS,
            )
        else:
            raise

    def _handle_disconnect():
        global _playwright_browser
        _render_log("WARN", "Playwright browser disconnected. Clearing cached browser instance.")
        _playwright_browser = None

    _playwright_browser.on("disconnected", _handle_disconnect)
    return _playwright_browser


async def _reset_playwright_browser():
    global _playwright_browser, _playwright_runtime
    old_browser = _playwright_browser
    _playwright_browser = None
    if old_browser:
        try:
            await old_browser.close()
        except Exception:
            pass
    if _playwright_runtime:
        try:
            await _playwright_runtime.stop()
        except Exception:
            pass
        _playwright_runtime = None


async def _install_playwright_browsers():
    global _playwright_install_attempted
    if _playwright_install_attempted:
        return
    _playwright_install_attempted = True
    loop = asyncio.get_running_loop()
    cmd = [sys.executable, "-m", "playwright", "install", "chromium"]
    print("[INFO] Playwright browsers missing. Installing:", " ".join(cmd))

    def _run():
        return subprocess.run(cmd, capture_output=True, text=True)

    result = await loop.run_in_executor(None, _run)
    if result.stdout:
        print("[INFO] Playwright install stdout:", result.stdout.strip())
    if result.stderr:
        print("[WARN] Playwright install stderr:", result.stderr.strip())
    if result.returncode != 0:
        raise RuntimeError("Playwright install failed with exit code " + str(result.returncode))


async def _playwright_render_loop():
    loop = asyncio.get_running_loop()
    while True:
        task = await loop.run_in_executor(None, _playwright_task_queue.get)
        if task is None:
            _playwright_task_queue.task_done()
            break

        context = None
        page = None
        try:
            last_exc = None
            for render_attempt in range(_PLAYWRIGHT_RENDER_RETRIES):
                task_started_at = datetime.utcnow().timestamp()
                browser = await _get_playwright_browser()
                try:
                    context = await browser.new_context(
                        viewport={"width": task["viewport_width"], "height": task.get("viewport_height", 960)},
                        device_scale_factor=_PLAYWRIGHT_RENDER_SCALE,
                        color_scheme="light",
                        service_workers="block",
                        reduced_motion="reduce",
                    )
                except Exception as exc:
                    if "Target page, context or browser has been closed" not in str(exc):
                        raise
                    _render_log("WARN", "Browser context creation failed. Resetting Playwright browser and retrying once.")
                    await _reset_playwright_browser()
                    browser = await _get_playwright_browser()
                    context = await browser.new_context(
                        viewport={"width": task["viewport_width"], "height": task.get("viewport_height", 960)},
                        device_scale_factor=_PLAYWRIGHT_RENDER_SCALE,
                        color_scheme="light",
                        service_workers="block",
                        reduced_motion="reduce",
                    )
                try:
                    page = await context.new_page()
                    page.set_default_timeout(_PLAYWRIGHT_NAV_TIMEOUT_MS)
                    allowed_origin = "{uri.scheme}://{uri.netloc}".format(uri=urlparse(task["page_url"]))

                    async def _route_handler(route):
                        if _should_abort_playwright_request(route, allowed_origin):
                            await route.abort()
                        else:
                            await route.continue_()

                    await page.route("**/*", _route_handler)
                    await page.goto(task["page_url"], wait_until="domcontentloaded", timeout=_PLAYWRIGHT_NAV_TIMEOUT_MS)
                    await page.wait_for_function("window.__cardsRenderReady === true", timeout=_PLAYWRIGHT_READY_TIMEOUT_MS)
                    await page.locator(task.get("selector", "#cards")).wait_for(state="visible", timeout=_PLAYWRIGHT_ELEMENT_TIMEOUT_MS)
                    await page.wait_for_function(
                        """
                        (selector) => {
                          const el = document.querySelector(selector);
                          if (!el) return false;
                          const rect = el.getBoundingClientRect();
                          return rect.width > 0 && rect.height > 0;
                        }
                        """,
                        arg=task.get("selector", "#cards"),
                        timeout=_PLAYWRIGHT_ELEMENT_TIMEOUT_MS
                    )
                    await page.evaluate(
                        """
                        async () => {
                          if (document.fonts && document.fonts.ready) {
                            await document.fonts.ready;
                          }
                          await new Promise((resolve) => requestAnimationFrame(resolve));
                          const images = Array.from(document.images || []);
                          await Promise.all(images.map((img) => {
                            if (img.complete) return Promise.resolve();
                            return new Promise((resolve) => {
                              img.addEventListener('load', resolve, { once: true });
                              img.addEventListener('error', resolve, { once: true });
                            });
                          }));
                        }
                        """
                    )
                    image_bytes = await page.locator(task.get("selector", "#cards")).screenshot(
                        type="png",
                        animations="disabled"
                    )
                    task["result"]["image_bytes"] = image_bytes
                    task["result"].pop("error", None)
                    _render_log(
                        "INFO",
                        "Playwright card render succeeded",
                        cache_key=task.get("cache_key", "")[:8],
                        ms=int((datetime.utcnow().timestamp() - task_started_at) * 1000),
                        width=task["viewport_width"],
                        height=task.get("viewport_height", 960),
                    )
                    last_exc = None
                    break
                except Exception as exc:
                    last_exc = exc
                    if render_attempt < (_PLAYWRIGHT_RENDER_RETRIES - 1):
                        _render_log("WARN", "Playwright render pass failed, retrying once", error=exc)
                        await _reset_playwright_browser()
                        continue
                    raise
                finally:
                    if page:
                        try:
                            await page.close()
                        except Exception:
                            pass
                        page = None
                    if context:
                        try:
                            await context.close()
                        except Exception:
                            pass
                        context = None
            if last_exc is not None:
                raise last_exc
        except Exception as exc:
            task["result"]["error"] = exc
        finally:
            try:
                if page:
                    try:
                        await page.close()
                    except Exception:
                        pass
                if context:
                    try:
                        await context.close()
                    except Exception:
                        pass
            finally:
                task["event"].set()
                _playwright_task_queue.task_done()


def _playwright_render_worker():
    try:
        asyncio.run(_playwright_render_loop())
    except Exception:
        print("[ERROR] Playwright render worker failed to start.")
        import traceback
        traceback.print_exc()


def _ensure_playwright_worker():
    global _playwright_worker_started
    with _playwright_lock:
        if _playwright_worker_started:
            return
        worker = threading.Thread(target=_playwright_render_worker, name="playwright-render-worker", daemon=True)
        worker.start()
        _playwright_worker_started = True


def _store_render_cache(cache_key, image_bytes):
    with _render_cache_lock:
        _render_cache[cache_key] = image_bytes
        _render_cache.move_to_end(cache_key)
        while len(_render_cache) > _render_cache_max:
            _render_cache.popitem(last=False)
    try:
        cache_path = os.path.join(RENDER_CACHE_FOLDER, f"{cache_key}.png")
        temp_path = f"{cache_path}.tmp"
        with open(temp_path, "wb") as cache_file:
            cache_file.write(image_bytes)
        os.replace(temp_path, cache_path)
    except Exception as exc:
        _render_log("WARN", "Failed to persist render cache", cache_key=cache_key[:8], error=exc)


def _get_persisted_render_cache(cache_key):
    cache_path = os.path.join(RENDER_CACHE_FOLDER, f"{cache_key}.png")
    if not os.path.exists(cache_path):
        return None
    try:
        with open(cache_path, "rb") as cache_file:
            image_bytes = cache_file.read()
        with _render_cache_lock:
            _render_cache[cache_key] = image_bytes
            _render_cache.move_to_end(cache_key)
            while len(_render_cache) > _render_cache_max:
                _render_cache.popitem(last=False)
        return image_bytes
    except Exception as exc:
        _render_log("WARN", "Failed to load persisted render cache", cache_key=cache_key[:8], error=exc)
        return None


def _store_render_preview(payload):
    token = uuid.uuid4().hex
    preview_payload = {
        "theme": (payload.get("theme") or "light").strip(),
        "cards_html": payload.get("cards_html") or "",
        "expanded_indices": payload.get("expanded_indices") or [],
        "created_at": datetime.utcnow().timestamp(),
    }
    with _render_preview_lock:
        _render_preview_store[token] = preview_payload
        cutoff = datetime.utcnow().timestamp() - 900
        expired_tokens = [key for key, value in _render_preview_store.items() if value.get("created_at", 0) < cutoff]
        for key in expired_tokens:
            _render_preview_store.pop(key, None)
    return token


def _get_render_preview(token):
    with _render_preview_lock:
        preview_payload = _render_preview_store.get(token)
    if not preview_payload:
        return None
    if preview_payload.get("created_at", 0) < datetime.utcnow().timestamp() - 900:
        with _render_preview_lock:
            _render_preview_store.pop(token, None)
        return None
    return preview_payload


def _resolve_processing_user_id(payload=None):
    payload = payload or {}
    requested_user_id = (payload.get("user_id") or "").strip() if isinstance(payload.get("user_id"), str) else payload.get("user_id")
    if requested_user_id:
        user = User.query.filter_by(id=requested_user_id).first()
        if user:
            return user.id

    username = (payload.get("username") or "").strip()
    if username:
        user = User.query.filter_by(username=username).first()
        if user:
            return user.id

    user = User.query.order_by(User.created_at.asc()).first()
    return user.id if user else None


def _cleanup_ticket_processing_batches():
    now_ts = datetime.utcnow().timestamp()
    with _ticket_processing_lock:
        stale_keys = [
            key for key, batch in _ticket_processing_batches.items()
            if (now_ts - float(batch.get("updated_at_ts", batch.get("created_at_ts", now_ts)))) > _TICKET_PROCESSING_TTL_SECONDS
        ]
        for key in stale_keys:
            _ticket_processing_batches.pop(key, None)


def _register_ticket_processing_batch(payload):
    user_id = _resolve_processing_user_id(payload)
    if not user_id:
        raise ValueError("No target user found for processing notification.")

    batch_id = str((payload.get("batch_id") or "").strip())
    if not batch_id:
        raise ValueError("batch_id is required.")

    raw_count = payload.get("ticket_count", 0)
    try:
        ticket_count = int(raw_count)
    except (TypeError, ValueError):
        raise ValueError("ticket_count must be an integer.")
    if ticket_count <= 0:
        raise ValueError("ticket_count must be greater than 0.")

    now_iso = datetime.utcnow().isoformat()
    now_ts = datetime.utcnow().timestamp()
    with _ticket_processing_lock:
        _ticket_processing_batches[(str(user_id), batch_id)] = {
            "user_id": str(user_id),
            "batch_id": batch_id,
            "ticket_count": ticket_count,
            "pending_count": ticket_count,
            "display_count": ticket_count,
            "received_count": 0,
            "source": (payload.get("source") or "email").strip() if isinstance(payload.get("source"), str) else "email",
            "label": (payload.get("label") or "").strip() if isinstance(payload.get("label"), str) else "",
            "created_at": now_iso,
            "updated_at": now_iso,
            "created_at_ts": now_ts,
            "updated_at_ts": now_ts,
            "visible_until_ts": now_ts + _TICKET_PROCESSING_MIN_VISIBLE_SECONDS,
        }
    return user_id, batch_id


def _mark_ticket_processing_received(user_id, batch_id):
    if not user_id or not batch_id:
        return

    key = (str(user_id), str(batch_id))
    now_iso = datetime.utcnow().isoformat()
    now_ts = datetime.utcnow().timestamp()
    with _ticket_processing_lock:
        batch = _ticket_processing_batches.get(key)
        if not batch:
            return
        batch["received_count"] = int(batch.get("received_count", 0)) + 1
        batch["pending_count"] = max(0, int(batch.get("pending_count", 0)) - 1)
        batch["updated_at"] = now_iso
        batch["updated_at_ts"] = now_ts
        batch["display_count"] = batch["pending_count"]
        batch["visible_until_ts"] = max(float(batch.get("visible_until_ts", now_ts)), now_ts + _TICKET_PROCESSING_MIN_VISIBLE_SECONDS)
        if batch["pending_count"] <= 0 and now_ts >= float(batch.get("visible_until_ts", now_ts)):
            _ticket_processing_batches.pop(key, None)


def _get_user_ticket_processing_batches(user_id):
    _cleanup_ticket_processing_batches()
    now_ts = datetime.utcnow().timestamp()
    with _ticket_processing_lock:
        batches = []
        for key, batch in list(_ticket_processing_batches.items()):
            batch_user_id, _ = key
            if str(batch_user_id) != str(user_id):
                continue
            if int(batch.get("pending_count", 0)) <= 0 and now_ts >= float(batch.get("visible_until_ts", now_ts)):
                _ticket_processing_batches.pop(key, None)
                continue
            batch_copy = dict(batch)
            if int(batch_copy.get("pending_count", 0)) <= 0 and now_ts < float(batch_copy.get("visible_until_ts", now_ts)):
                batch_copy["display_count"] = max(1, int(batch_copy.get("ticket_count", 1)))
            else:
                batch_copy["display_count"] = int(batch_copy.get("pending_count", 0))
            batches.append(batch_copy)
    batches.sort(key=lambda item: item.get("created_at_ts", 0), reverse=True)
    return batches


def _ticket_notifications_payload(user_id):
    merge_groups = _build_pnr_merge_groups(user_id)
    pending_merges = [g for g in merge_groups if g["merged_ticket_count"] < g["ticket_count"]]
    dup_count = Ticket.query.filter_by(
        user_id=user_id,
        duplicate_status="pending"
    ).count()
    processing_batches = _get_user_ticket_processing_batches(user_id)
    return {
        "merge_count": len(pending_merges),
        "merge_groups": pending_merges,
        "duplicate_count": dup_count,
        "processing_count": sum(int(batch.get("display_count", batch.get("pending_count", 0))) for batch in processing_batches),
        "processing_batches": processing_batches,
    }


def _publish_ticket_dashboard_event(user_id, event_type="dashboard_refresh", **payload):
    if not user_id:
        return
    event_payload = {
        "event": event_type,
        "timestamp": datetime.utcnow().isoformat() + "Z",
        **payload,
    }
    with _ticket_dashboard_streams_lock:
        listeners = list(_ticket_dashboard_streams.get(user_id) or [])
    for listener in listeners:
        try:
            listener.put_nowait(event_payload)
        except queue.Full:
            continue


def _build_render_request(payload):
    viewport_width = max(int(payload.get("viewport_width") or 1280), 320)
    requested_cards_width = payload.get("cards_width")
    cards_width = max(int(requested_cards_width), 1) if requested_cards_width else None
    requested_cards_height = payload.get("cards_height")
    cards_height = max(int(requested_cards_height), 1) if requested_cards_height else None
    cards_child_count = max(int(payload.get("cards_child_count") or 0), 0)
    cards_html = (payload.get("cards_html") or "").strip()
    if not cards_html:
        raise ValueError("No flight card snapshot to render")

    preview_state = {
        "theme": (payload.get("theme") or "light").strip(),
        "cards_html": cards_html,
        "expanded_indices": payload.get("expanded_indices") or [],
    }
    cache_payload = {
        "theme": preview_state["theme"],
        "cards_html": cards_html,
        "viewport_width": cards_width or min(viewport_width, 1400),
        "viewport_height": min(max((cards_height or 900) + 40, 240), 4000),
    }
    cache_key = hashlib.sha256(json.dumps(cache_payload, sort_keys=True).encode("utf-8")).hexdigest()
    preview_token = _store_render_preview(preview_state)
    return {
        "cache_key": cache_key,
        "page_url": f"{request.host_url}?render_preview_token={preview_token}",
        "viewport_width": cache_payload["viewport_width"],
        "viewport_height": cache_payload["viewport_height"],
        "selector": "#cards > :first-child" if cards_child_count == 1 else "#cards",
    }


def _queue_render_request(render_request):
    cache_key = render_request["cache_key"]
    with _render_cache_lock:
        if cache_key in _render_cache:
            return {"status": "cached", "event": None, "result": {"image_bytes": _render_cache[cache_key]}}
    persisted_image = _get_persisted_render_cache(cache_key)
    if persisted_image is not None:
        return {"status": "cached", "event": None, "result": {"image_bytes": persisted_image}}
    with _render_jobs_lock:
        existing_job = _render_jobs.get(cache_key)
        if existing_job:
            return {"status": "queued", "event": existing_job["event"], "result": existing_job["result"]}

        done_event = threading.Event()
        result = {}
        _render_jobs[cache_key] = {"event": done_event, "result": result}

    _ensure_playwright_worker()
    try:
        _playwright_task_queue.put_nowait({
            "cache_key": cache_key,
            "page_url": render_request["page_url"],
            "viewport_width": render_request["viewport_width"],
            "viewport_height": render_request["viewport_height"],
            "selector": render_request["selector"],
            "event": done_event,
            "result": result,
        })
    except queue.Full:
        with _render_jobs_lock:
            _render_jobs.pop(cache_key, None)
        raise RuntimeError("Render queue is busy. Please retry in a moment.")

    def _finalize():
        done_event.wait()
        try:
            if result.get("image_bytes"):
                _store_render_cache(cache_key, result["image_bytes"])
        finally:
            with _render_jobs_lock:
                _render_jobs.pop(cache_key, None)

    threading.Thread(target=_finalize, name=f"render-cache-{cache_key[:8]}", daemon=True).start()
    return {"status": "queued", "event": done_event, "result": result}


def _get_cached_render_bytes(cache_key):
    with _render_cache_lock:
        cached = _render_cache.get(cache_key)
        if cached:
            _render_cache.move_to_end(cache_key)
            return cached
    return _get_persisted_render_cache(cache_key)


def _render_request_bytes(render_request, timeout=_PLAYWRIGHT_QUEUE_WAIT_SECONDS):
    cache_key = render_request["cache_key"]
    cached = _get_cached_render_bytes(cache_key)
    if cached is not None:
        return cached

    job = _queue_render_request(render_request)
    if job["status"] == "cached":
        return job["result"]["image_bytes"]

    job["event"].wait(timeout=timeout)
    if not job["event"].is_set():
        raise RuntimeError("Timed out waiting for pre-rendered image")
    if job["result"].get("error"):
        raise job["result"]["error"]
    return job["result"]["image_bytes"]


def _render_saved_cabin_value(flight, segment=None):
    if segment is not None:
        if not segment.get("show_booking_class"):
            return ""
        return (segment.get("class_of_travel") or segment.get("cabin_class") or "").strip()
    if not flight.get("show_cabin_class"):
        return ""
    return (flight.get("class_of_travel") or flight.get("cabin_class") or "").strip()


def _build_cards_render_groups(flights, trip_type, unit_flights):
    trip_type = (trip_type or "one_way").strip().lower()
    flights = flights or []
    unit_flights = unit_flights or {}

    def build_flight_view(flight, part_label=""):
        segments = flight.get("segments") or []
        display_stops = flight.get("stops") or ("Direct" if len(segments) <= 1 else f"{max(0, len(segments) - 1)} Stop(s)")
        has_multi_segment = len(segments) > 1 and "direct" not in display_stops.lower() and "non-stop" not in display_stops.lower()
        airline_rows = []
        if has_multi_segment:
            for segment in segments:
                airline_rows.append({
                    "airline": segment.get("airline") or flight.get("airline") or "Airline",
                    "flight_number": segment.get("flight_number") or "",
                    "cabin": _render_saved_cabin_value(flight, segment),
                })
        else:
            airline_rows.append({
                "airline": flight.get("airline") or "Airline",
                "flight_number": flight.get("flight_number") or "",
                "cabin": _render_saved_cabin_value(flight),
            })

        return {
            "part_label": part_label,
            "airline_rows": airline_rows,
            "date": flight.get("departure_date") or "",
            "departure_time": flight.get("departure_time") or "--:--",
            "arrival_time": flight.get("arrival_time") or "--:--",
            "departure_city": flight.get("departure_city") or flight.get("departure_airport") or "",
            "arrival_city": flight.get("arrival_city") or flight.get("arrival_airport") or "",
            "departure_airport": flight.get("departure_airport") or "",
            "arrival_airport": flight.get("arrival_airport") or "",
            "duration": flight.get("duration") or "--",
            "stops": display_stops,
            "days_offset": flight.get("days_offset") or 0,
            "fares": flight.get("fares") or {},
        }

    groups = []
    if trip_type in ("round_trip", "multi_city") and unit_flights:
        for unit_id, indices in unit_flights.items():
            option_flights = [flights[idx] for idx in indices if 0 <= idx < len(flights)]
            if not option_flights:
                continue
            label_prefix = "Round Trip Option" if trip_type == "round_trip" else "Multi-City Option"
            flight_views = []
            for idx, flight in enumerate(option_flights):
                if trip_type == "round_trip":
                    part_label = "Outbound" if idx == 0 else "Return"
                else:
                    part_label = f"Flight {idx + 1}"
                flight_views.append(build_flight_view(flight, part_label))
            groups.append({
                "label": f"{label_prefix} {unit_id}",
                "flights": flight_views,
            })
    else:
        for idx, flight in enumerate(flights):
            groups.append({
                "label": f"Option {idx + 1}",
                "flights": [build_flight_view(flight)],
            })
    return groups

@app.route("/itineraries")
def itineraries_page():
    """Serve the itineraries management page"""
    return render_template('itineraries.html')

@app.route("/passengers")
def passengers_page():
    """Serve the passengers management page"""
    return render_template('passengers.html')

@app.route("/corporates")
def corporates_page():
    """Serve the corporates management page"""
    return render_template('corporates.html')

@app.route("/billing")
def billing_dashboard_page():
    """Serve the billing dashboard page"""
    return render_template('billing_dashboard.html')

@app.route("/ledger")
def ledger_page():
    """Serve the aggregator ledger dashboard"""
    return render_template('ledger.html')

@app.route("/login")
def login_page():
    """Serve the login/registration page"""
    return render_template('login.html')

# ==================== AUTH ROUTES ====================

@app.route("/api/register", methods=["POST"])
def register():
    """Register a new user"""
    try:
        data = request.get_json()
        
        if not data or not data.get('username') or not data.get('email') or not data.get('password'):
            return jsonify({"error": "Missing required fields"}), 400
        
        # Check if user already exists
        if User.query.filter_by(username=data['username']).first():
            return jsonify({"error": "Username already exists"}), 400
        
        if User.query.filter_by(email=data['email']).first():
            return jsonify({"error": "Email already exists"}), 400
        
        # Create new user
        user = User(
            username=data['username'],
            email=data['email'],
            full_name=data.get('full_name', '')
        )
        user.set_password(data['password'])
        
        db.session.add(user)
        db.session.commit()
        
        # Log the user in
        session['user_id'] = user.id
        session['username'] = user.username
        
        return jsonify({
            "message": "Registration successful",
            "user": {
                "id": user.id,
                "username": user.username,
                "email": user.email,
                "full_name": user.full_name
            }
        }), 201
        
    except Exception as e:
        db.session.rollback()
        print(f"Registration error: {str(e)}")
        return jsonify({"error": "Registration failed"}), 500

@app.route("/api/login", methods=["POST"])
def login():
    """Login user"""
    try:
        data = request.get_json()
        
        if not data or not data.get('username') or not data.get('password'):
            return jsonify({"error": "Missing credentials"}), 400
        
        user = User.query.filter_by(username=data['username']).first()
        
        if not user or not user.check_password(data['password']):
            return jsonify({"error": "Invalid credentials"}), 401
        
        session['user_id'] = user.id
        session['username'] = user.username
        
        return jsonify({
            "message": "Login successful",
            "user": {
                "id": user.id,
                "username": user.username,
                "email": user.email,
                "full_name": user.full_name
            }
        })
        
    except Exception as e:
        print(f"Login error: {str(e)}")
        return jsonify({"error": "Login failed"}), 500

@app.route("/api/logout", methods=["POST"])
def logout():
    """Logout user"""
    session.clear()
    return jsonify({"message": "Logout successful"})

@app.route("/api/tickets/<ticket_id>/export-sheet", methods=["POST"])
@login_required
def export_ticket_to_sheet(ticket_id):
    """Export ticket to Google Sheet using logic from test.py"""
    try:
        data = request.get_json()
        booking_by = data.get('booking_by', 'AB')
        ticket_type = data.get('type', 'New')

        ticket = Ticket.query.get(ticket_id)
        if not ticket:
            return jsonify({"error": "Ticket not found"}), 404

        # Parse data
        passengers = json.loads(ticket.passengers_data or '[]')
        journey = json.loads(ticket.journey_data or '{}')
        
        n_pax = len(passengers) if passengers else 1
        global_mu_single = float(journey.get('global_markup', 0))
        markup_total = global_mu_single * n_pax
        
        base_fare = 0.0
        k3_gst = 0.0
        other_taxes = 0.0 # Pure Other Taxes
        
        c_fare = journey.get('consolidated_fare')
        if c_fare:
            base_fare = float(c_fare.get('base_fare', 0))
            k3_gst = float(c_fare.get('k3_gst', 0))
            other_taxes = float(c_fare.get('other_taxes', 0))
        else:
            # Fallback to sum of individual passenger fares
            for p in passengers:
                f = p.get('fare', {})
                base_fare += float(f.get('base_fare', 0))
                k3_gst += float(f.get('k3_gst', 0))
                other_taxes += float(f.get('other_taxes', 0))

        # ---------- GOOGLE SHEETS LOGIC ----------
        scope = ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive"]
        if not os.path.exists("credentials.json"):
            return jsonify({"error": "credentials.json not found"}), 500
            
        creds = Credentials.from_service_account_file("credentials.json", scopes=scope)
        gc = gspread.authorize(creds)
        
        sheet_id = "1jfm16HEq0G2XeXiyqK2Q3xyNbcSkt1DPtsEV6_256sk"
        sheet = gc.open_by_key(sheet_id).sheet1
        
        all_values = sheet.get_all_values()
        month_label = datetime.now().strftime("%b %Y")
        month_row = None
        
        # 1. Find the current month section
        for i, row in enumerate(all_values):
            if month_label in row:
                month_row = i
                break
        
        if month_row is None:
            return jsonify({"error": f"Section for {month_label} not found"}), 400
            
        # 2. Find where the NEXT month starts (insertion point)
        month_pattern = re.compile(r"(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s\d{4}")
        insert_row_idx = None
        for i in range(month_row + 1, len(all_values)):
            row_text = " ".join(all_values[i])
            if month_pattern.search(row_text) and month_label not in row_text:
                insert_row_idx = i
                break
        
        if insert_row_idx is None:
            insert_row_idx = len(all_values)
            
        # 3. Get previous balance from Col K (Index 10) of the row just before insertion
        try:
            prev_row = all_values[insert_row_idx - 1]
            prev_balance_str = prev_row[10].replace(',', '').strip() if len(prev_row) > 10 else "0"
            prev_balance = float(prev_balance_str) if prev_balance_str else 0.0
        except (ValueError, IndexError):
            prev_balance = 0.0
            
        # Calculations (Same as test.py)
        ticket_total = base_fare + k3_gst + other_taxes + markup_total
        indigo_total = ticket_total - markup_total
        running_balance = prev_balance - indigo_total
        
        # Build row
        # A:Invoice, B:Date, C:PNR, D:Basic, E:K3, F:Other, G:MU, H:Xxd, I:Total, J:Indigo, K:Balance, L:By, M:Type
        new_row = [
            "", # A: Invoice (empty as requested)
            datetime.now().strftime("%d-%b-%Y"), # B
            ticket.pnr or "—", # C
            base_fare, # D
            k3_gst, # E
            other_taxes, # F
            markup_total, # G
            "", # H: Xxd
            ticket_total, # I
            indigo_total, # J
            running_balance, # K
            booking_by, # L
            ticket_type, # M
            "", # N (blank as requested)
            "", "", "", "" # Padding
        ]
        
        # Insert row at the correct position (1-indexed for gspread)
        # Use USER_ENTERED to ensure numbers are treated as numbers, not dates
        sheet.insert_row(new_row, insert_row_idx + 1, value_input_option='USER_ENTERED')
        
        # Force Normal Weight (Not Bold) and Number Format for price columns (D to K)
        # Row index in gspread format is 1-indexed, matching insert_row_idx + 1
        r_idx = insert_row_idx + 1
        sheet.format(f"A{r_idx}:R{r_idx}", {
            "textFormat": {"bold": False},
            "horizontalAlignment": "CENTER"
        })
        # Format the numeric columns specifically to prevent "Date" misinterpretation
        # B: Date, D-G: Moneys, I-K: Moneys
        sheet.format(f"B{r_idx}", {"numberFormat": {"type": "DATE", "pattern": "dd-MMM-yyyy"}})
        sheet.format(f"D{r_idx}:G{r_idx}", {"numberFormat": {"type": "NUMBER", "pattern": "0"}})
        sheet.format(f"I{r_idx}:K{r_idx}", {"numberFormat": {"type": "NUMBER", "pattern": "0"}})
        
        # Mark as added to ledger
        fare_hash_data = f"{ticket.pnr}:{base_fare}:{k3_gst}:{other_taxes}:{markup_total}:{ticket_total}"
        ticket.ledger_hash = hashlib.sha256(fare_hash_data.encode()).hexdigest()
        db.session.commit()
        
        return jsonify({"message": f"Exported to {month_label} section", "pnr": ticket.pnr})
        
    except Exception as e:
        print(f"Export error: {str(e)}")
        return jsonify({"error": str(e)}), 500

def parseFloat(val):
    try:
        return float(val)
    except:
        return 0.0


def _round_money(value):
    return round(parseFloat(value), 2)


def _clone_json(value):
    return json.loads(json.dumps(value))


_MISSING = object()


def _merge_concurrent_value(current, base, incoming):
    if current is _MISSING and base is _MISSING and incoming is _MISSING:
        return _MISSING
    if incoming is _MISSING:
        if current is not _MISSING:
            return _clone_json(current)
        if base is not _MISSING:
            return _clone_json(base)
        return _MISSING
    if base is _MISSING:
        if incoming is _MISSING:
            return _clone_json(current) if current is not _MISSING else _MISSING
        return _clone_json(incoming)
    if current is _MISSING:
        if incoming == base:
            return _MISSING
        return _clone_json(incoming)

    if isinstance(current, dict) and isinstance(base, dict) and isinstance(incoming, dict):
        merged = {}
        for key in set(current.keys()) | set(base.keys()) | set(incoming.keys()):
            merged_value = _merge_concurrent_value(
                current.get(key, _MISSING),
                base.get(key, _MISSING),
                incoming.get(key, _MISSING),
            )
            if merged_value is not _MISSING:
                merged[key] = merged_value
        return merged

    if isinstance(current, list) and isinstance(base, list) and isinstance(incoming, list):
        if len(current) == len(base) == len(incoming):
            merged_items = []
            for idx in range(len(incoming)):
                merged_value = _merge_concurrent_value(
                    current[idx] if idx < len(current) else _MISSING,
                    base[idx] if idx < len(base) else _MISSING,
                    incoming[idx] if idx < len(incoming) else _MISSING,
                )
                merged_items.append(_clone_json(incoming[idx]) if merged_value is _MISSING else merged_value)
            return merged_items
        if incoming == base:
            return _clone_json(current)
        if current == base:
            return _clone_json(incoming)
        return _clone_json(incoming)

    if incoming == base:
        return _clone_json(current)
    if current == base:
        return _clone_json(incoming)
    return _clone_json(incoming)


def _generate_internal_ticket_number():
    return f"SYS-{datetime.utcnow().strftime('%Y%m%d')}-{uuid.uuid4().hex[:8].upper()}"


def _ensure_passenger_internal_ids(passengers):
    changed = False
    for passenger in passengers:
        if not passenger.get("system_ticket_number"):
            passenger["system_ticket_number"] = _generate_internal_ticket_number()
            changed = True
    return changed


def _build_legs_from_data(segments, journey=None):
    journey = journey or {}
    if journey.get("legs"):
        legs = []
        for leg in journey.get("legs", []):
            indices = leg.get("segments", [])
            if indices:
                legs.append(indices)
        if legs:
            return legs

    if not segments:
        return []

    max_connection_layover_minutes = 24 * 60

    def _should_share_leg(prev_segment, current_segment):
        prev_arr = (prev_segment.get("arrival") or {}).get("airport", "").strip().upper()
        curr_dep = (current_segment.get("departure") or {}).get("airport", "").strip().upper()
        if not prev_arr or not curr_dep or prev_arr != curr_dep:
            return False

        prev_arr_time = (prev_segment.get("arrival") or {}).get("time", "")
        curr_dep_time = (current_segment.get("departure") or {}).get("time", "")
        prev_arr_date = (prev_segment.get("arrival") or {}).get("date") or prev_segment.get("arrival_date")
        curr_dep_date = (current_segment.get("departure") or {}).get("date") or current_segment.get("departure_date")
        prev_point = {"date": prev_arr_date, "time": prev_arr_time}
        curr_point = {"date": curr_dep_date, "time": curr_dep_time}
        layover_minutes = _elapsed_minutes_between_points(prev_point, curr_point)
        if layover_minutes and layover_minutes > 0:
            return layover_minutes <= max_connection_layover_minutes

        layover_text = (current_segment.get("layover_duration") or current_segment.get("layover") or "").strip()
        if not layover_text or layover_text == "N/A":
            return True
        layover_match = re.search(r"(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?", layover_text.lower())
        if not layover_match:
            return True
        hours = int(layover_match.group(1) or 0)
        minutes = int(layover_match.group(2) or 0)
        total_minutes = hours * 60 + minutes
        return total_minutes <= max_connection_layover_minutes if total_minutes > 0 else True

    legs = []
    current_leg = [0]
    for idx in range(1, len(segments)):
        if _should_share_leg(segments[idx - 1], segments[idx]):
            current_leg.append(idx)
        else:
            legs.append(current_leg)
            current_leg = [idx]
    legs.append(current_leg)
    return legs


def _clean_bcbp_name(name):
    raw = (name or "").strip().upper()
    if not raw:
        return "UNKNOWN/PAX"
    cleaned = re.sub(r"[^A-Z0-9/ ]+", "", raw)
    parts = [part for part in cleaned.replace("/", " ").split() if part]
    if len(parts) >= 2:
        last_name = parts[-1]
        first_names = "".join(parts[:-1])
        return f"{last_name}/{first_names}"[:20]
    return cleaned.replace(" ", "")[:20] or "UNKNOWN/PAX"


def _pad_bcbp_text(value, length, default="", align="left", fill=" "):
    text = str(value if value not in (None, "") else default)
    if align == "right":
        return text[:length].rjust(length, fill)
    return text[:length].ljust(length, fill)


def _pad_bcbp_digits(value, length, default=""):
    digits = re.sub(r"\D", "", str(value if value not in (None, "") else default))
    return digits[-length:].zfill(length) if digits else str(default).zfill(length)


def _segment_date_value(segment):
    departure = segment.get("departure") or {}
    return (
        departure.get("date")
        or segment.get("departure_date")
        or segment.get("date")
        or ""
    ).strip()


def _segment_departure_airport(segment):
    departure = segment.get("departure") or {}
    return (departure.get("airport") or segment.get("departure_airport") or "").strip().upper()


def _segment_arrival_airport(segment):
    arrival = segment.get("arrival") or {}
    return (arrival.get("airport") or segment.get("arrival_airport") or "").strip().upper()


def _segment_flight_number(segment):
    return (segment.get("flight_number") or "").strip().upper()


def _segment_booking_class_letter(segment):
    booking_class = segment.get("booking_class")
    if isinstance(booking_class, dict):
        value = (
            booking_class.get("letter")
            or booking_class.get("code")
            or booking_class.get("cabin")
            or ""
        )
    else:
        value = booking_class or ""
    value = str(value).strip().upper()
    return value[:1] if value else "Y"


def _segment_airline_code(segment):
    airline_code = (segment.get("airline_code") or "").strip().upper()
    if airline_code:
        return airline_code[:3]
    flight_number = _segment_flight_number(segment)
    match = re.match(r"([A-Z0-9]{2,3})\s*\d+", flight_number)
    if match:
        return match.group(1)
    return ""


def _segment_flight_numeric(segment):
    return _pad_bcbp_digits(_segment_flight_number(segment), 5, default="00000")


def _segment_julian_day(segment):
    raw_date = _segment_date_value(segment)
    if not raw_date or raw_date.upper() == "N/A":
        return None
    for fmt in ("%d %b %Y", "%d %b %y", "%d %B %Y", "%d %B %y", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw_date, fmt).strftime("%j")
        except ValueError:
            continue
    return None


def _passenger_seat_for_segment(passenger, segment_index):
    seats = passenger.get("seats") or []
    for seat in seats:
        if isinstance(seat, dict) and seat.get("segment_index") == segment_index:
            seat_value = (seat.get("seat_number") or "").strip().upper()
            if seat_value and seat_value != "N/A":
                return _pad_bcbp_text(seat_value, 4, default="0000")
    seat_value = (passenger.get("seat") or "").strip().upper()
    if seat_value and seat_value != "N/A":
        return _pad_bcbp_text(seat_value, 4, default="0000")
    return "0000"


def _passenger_sequence_number(passenger, segment):
    candidate = (
        passenger.get("sequence_number")
        or segment.get("sequence_number")
        or segment.get("sequence")
        or ""
    )
    return _pad_bcbp_digits(candidate, 5, default="00001")


def _build_segment_bcbp_data(ticket, passengers, raw, segment, segment_index):
    dep_airport = _segment_departure_airport(segment)
    arr_airport = _segment_arrival_airport(segment)
    flight_number = _segment_flight_number(segment)
    julian_day = _segment_julian_day(segment)
    if not dep_airport or not arr_airport or not flight_number or not julian_day:
        return None

    primary_passenger = passengers[0] if passengers else {}
    passenger_name = _pad_bcbp_text(
        _clean_bcbp_name(primary_passenger.get("name") or primary_passenger.get("first_name") or ""),
        20,
        default="UNKNOWN/PAX",
    )
    ticket_indicator = "E"
    pnr_value = (
        ticket.pnr
        or ((raw.get("booking") or {}).get("pnr") if isinstance(raw, dict) else "")
        or segment.get("pnr")
        or "XXXXXX"
    )
    pnr_value = _pad_bcbp_text(str(pnr_value).strip().upper(), 7, default="XXXXXX")
    from_airport = _pad_bcbp_text(dep_airport, 3)
    to_airport = _pad_bcbp_text(arr_airport, 3)
    seat_value = _passenger_seat_for_segment(primary_passenger, segment_index)
    sequence_value = _passenger_sequence_number(primary_passenger, segment)
    booking_class = _pad_bcbp_text(_segment_booking_class_letter(segment), 1, default="Y")
    airline_code = _pad_bcbp_text(_segment_airline_code(segment), 3)
    flight_numeric = _segment_flight_numeric(segment)
    status = _pad_bcbp_text(segment.get("status_code") or segment.get("status") or "0", 1, default="0")

    bcbp_string = (
        f"M1"
        f"{passenger_name}"
        f"{ticket_indicator}"
        f"{pnr_value}"
        f"{from_airport}"
        f"{to_airport}"
        f"{airline_code}"
        f"{flight_numeric}"
        f"{_pad_bcbp_digits(julian_day, 3, default='000')}"
        f"{booking_class}"
        f"{seat_value}"
        f"{sequence_value}"
        f"{status}"
    )
    return bcbp_string


def _generate_pdf417_base64(data_string):
    if not data_string or pdf417gen is None:
        return None
    try:
        codes = pdf417gen.encode(data_string, columns=6, security_level=2)
        image = pdf417gen.render_image(codes, scale=2, ratio=3, padding=8)
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
        return f"data:image/png;base64,{encoded}"
    except Exception:
        return None


def _segments_with_barcodes(ticket, passengers, segments, raw):
    enriched_segments = []
    for segment_index, segment in enumerate(segments or []):
        segment_copy = _clone_json(segment)
        preferred_duration = (
            segment_copy.get("duration_calculated")
            or segment_copy.get("duration_extracted")
            or segment_copy.get("duration")
        )
        if preferred_duration:
            segment_copy["duration_calculated"] = preferred_duration
            segment_copy["duration"] = preferred_duration
        barcode_data = _build_segment_bcbp_data(ticket, passengers or [], raw or {}, segment_copy, segment_index)
        if barcode_data:
            segment_copy["barcode_data"] = barcode_data
            segment_copy["barcode_image"] = _generate_pdf417_base64(barcode_data)
        else:
            segment_copy["barcode_data"] = None
            segment_copy["barcode_image"] = None
        enriched_segments.append(segment_copy)
    return enriched_segments


def _sanitize_segments_for_storage(segments):
    cleaned_segments = []
    for segment in segments or []:
        segment_copy = _clone_json(segment)
        if isinstance(segment_copy, dict):
            segment_copy.pop("barcode_data", None)
            segment_copy.pop("barcode_image", None)
        cleaned_segments.append(segment_copy)
    return cleaned_segments


def _ticket_financials(passengers, journey):
    n_pax = len(passengers)
    mu_per_pax = parseFloat((journey or {}).get("global_markup", 0))
    consolidated = (journey or {}).get("consolidated_fare") or {}
    if consolidated:
        base = parseFloat(consolidated.get("base_fare", 0))
        k3 = parseFloat(consolidated.get("k3_gst", 0))
        other = parseFloat(consolidated.get("other_taxes", 0))
    else:
        base = k3 = other = 0.0
        for passenger in passengers:
            fare = passenger.get("fare") or {}
            base += parseFloat(fare.get("base_fare", 0))
            k3 += parseFloat(fare.get("k3_gst", 0))
            other += parseFloat(fare.get("other_taxes", 0))
    mu = mu_per_pax * n_pax
    total = base + k3 + other + mu
    return {
        "base": _round_money(base),
        "k3": _round_money(k3),
        "other": _round_money(other),
        "mu": _round_money(mu),
        "total": _round_money(total),
        "non_markup_total": _round_money(base + k3 + other),
        "mu_per_pax": _round_money(mu_per_pax),
    }


def _passenger_share_map(passengers, journey, per_person_fares=None):
    n_pax = len(passengers)
    mu_per_pax = parseFloat((journey or {}).get("global_markup", 0))
    shares = []
    if per_person_fares and len(per_person_fares) >= n_pax:
        for idx in range(n_pax):
            item = per_person_fares[idx] or {}
            shares.append({
                "base": _round_money(item.get("base_fare", 0)),
                "k3": _round_money(item.get("k3_gst", 0)),
                "other": _round_money(item.get("other_taxes", 0)),
                "mu": _round_money(mu_per_pax),
            })
    else:
        explicit = []
        has_explicit = False
        for passenger in passengers:
            fare = passenger.get("fare") or {}
            base = parseFloat(fare.get("base_fare", 0))
            k3 = parseFloat(fare.get("k3_gst", 0))
            other = parseFloat(fare.get("other_taxes", 0))
            if base or k3 or other:
                has_explicit = True
            explicit.append({
                "base": _round_money(base),
                "k3": _round_money(k3),
                "other": _round_money(other),
                "mu": _round_money(mu_per_pax),
            })
        if has_explicit:
            shares = explicit
        else:
            totals = _ticket_financials(passengers, journey)
            divisor = n_pax or 1
            for _ in passengers:
                shares.append({
                    "base": _round_money(totals["base"] / divisor),
                    "k3": _round_money(totals["k3"] / divisor),
                    "other": _round_money(totals["other"] / divisor),
                    "mu": _round_money(mu_per_pax),
                })

    for share in shares:
        share["total"] = _round_money(share["base"] + share["k3"] + share["other"] + share["mu"])
        share["non_markup_total"] = _round_money(share["base"] + share["k3"] + share["other"])
    return shares


def _sum_components(component_list):
    base = sum(parseFloat(item.get("base", 0)) for item in component_list)
    k3 = sum(parseFloat(item.get("k3", 0)) for item in component_list)
    other = sum(parseFloat(item.get("other", 0)) for item in component_list)
    mu = sum(parseFloat(item.get("mu", 0)) for item in component_list)
    return {
        "base": _round_money(base),
        "k3": _round_money(k3),
        "other": _round_money(other),
        "mu": _round_money(mu),
        "total": _round_money(base + k3 + other + mu),
        "non_markup_total": _round_money(base + k3 + other),
    }


def _normalize_selection(indices, max_len):
    if max_len <= 0:
        return []
    if not indices:
        return list(range(max_len))
    normalized = sorted({int(idx) for idx in indices if 0 <= int(idx) < max_len})
    return normalized


def _normalize_compare_string(value):
    return " ".join((value or "").strip().lower().split())


def _normalize_passenger_name(name):
    normalized = _normalize_compare_string(name)
    normalized = re.sub(r"^(mr|mrs|ms|miss|mstr|master|dr)\.?\s+", "", normalized)
    return normalized


def _find_duplicate_normalized_passenger_names(signatures):
    seen = {}
    duplicates = set()
    for sig in signatures:
        for passenger_name in sig.get("normalized_passenger_names", []):
            if not passenger_name:
                continue
            seen[passenger_name] = seen.get(passenger_name, 0) + 1
            if seen[passenger_name] > 1:
                duplicates.add(passenger_name)
    return sorted(duplicates)


def _sector_fare_map(sector_indices, sector_fares):
    result = {}
    for item in sector_fares or []:
        leg_idx = int(item.get("leg_idx"))
        if leg_idx in sector_indices:
            result[leg_idx] = {
                "base": _round_money(item.get("base_fare", 0)),
                "k3": _round_money(item.get("k3_gst", 0)),
                "other": _round_money(item.get("other_taxes", 0)),
            }
    return result


def _component_ratio(numerator, denominator):
    denominator = parseFloat(denominator)
    if denominator <= 0:
        return 0.0
    return max(0.0, min(1.0, parseFloat(numerator) / denominator))


def _allocate_components(total_components, weights):
    if not weights:
        return []
    total_weight = sum(parseFloat(w) for w in weights)
    if total_weight <= 0:
        total_weight = len(weights)
        weights = [1 for _ in weights]
    allocated = []
    for idx, weight in enumerate(weights):
        ratio = parseFloat(weight) / total_weight
        allocated.append({
            "base": _round_money(total_components["base"] * ratio),
            "k3": _round_money(total_components["k3"] * ratio),
            "other": _round_money(total_components["other"] * ratio),
            "mu": _round_money(total_components["mu"] * ratio),
        })
    if allocated:
        for field in ["base", "k3", "other", "mu"]:
            diff = _round_money(total_components[field] - sum(item[field] for item in allocated))
            allocated[-1][field] = _round_money(allocated[-1][field] + diff)
        for item in allocated:
            item["total"] = _round_money(item["base"] + item["k3"] + item["other"] + item["mu"])
            item["non_markup_total"] = _round_money(item["base"] + item["k3"] + item["other"])
    return allocated


def _slice_segments(segments, leg_indices, selected_leg_indices):
    selected_segment_indices = []
    remapped_legs = []
    new_idx = 0
    for leg_idx in selected_leg_indices:
        if leg_idx >= len(leg_indices):
            continue
        source_leg = leg_indices[leg_idx]
        selected_segment_indices.extend(source_leg)
        remapped_legs.append(list(range(new_idx, new_idx + len(source_leg))))
        new_idx += len(source_leg)

    result = []
    for seg_idx in selected_segment_indices:
        segment = _clone_json(segments[seg_idx])
        result.append(segment)
    return {
        "segments": result,
        "original_segment_indices": selected_segment_indices,
        "legs": remapped_legs,
    }


def _mark_segments_status(segments, ticket_status):
    marked = _clone_json(segments)
    for segment in marked:
        if ticket_status == "cancelled":
            segment["status"] = "cancelled"
        elif ticket_status == "changed":
            segment["status"] = "changed"
        else:
            segment["status"] = "live"
    return marked


def _build_journey_for_ticket(source_journey, segments, total_components, passenger_count, leg_structure=None):
    journey = _clone_json(source_journey or {})
    journey["consolidated_fare"] = {
        "base_fare": _round_money(total_components["base"]),
        "k3_gst": _round_money(total_components["k3"]),
        "other_taxes": _round_money(total_components["other"]),
    }
    journey["global_markup"] = _round_money(total_components["mu"] / passenger_count) if passenger_count else 0.0
    grouped_legs = leg_structure if leg_structure is not None else _build_legs_from_data(segments, {})
    journey["legs"] = [{"segments": leg} for leg in grouped_legs]
    return journey


def _ticket_payload_from_parts(source_ticket, passengers, segments, total_components, ticket_status, pnr=None, parent_ticket_id=None, status_note=None, cancellation_charge=0, leg_structure=None):
    cloned_passengers = _clone_json(passengers)
    _ensure_passenger_internal_ids(cloned_passengers)
    weights = []
    for passenger in cloned_passengers:
        fare = passenger.get("fare") or {}
        weights.append(parseFloat(fare.get("base_fare", 0)) + parseFloat(fare.get("k3_gst", 0)) + parseFloat(fare.get("other_taxes", 0)))
    allocated = _allocate_components(total_components, weights)
    for idx, passenger in enumerate(cloned_passengers):
        fare = allocated[idx] if idx < len(allocated) else {"base": 0, "k3": 0, "other": 0, "mu": 0, "total": 0}
        passenger["fare"] = {
            "base_fare": fare["base"],
            "k3_gst": fare["k3"],
            "other_taxes": fare["other"],
            "total_fare": fare["total"],
        }
    marked_segments = _mark_segments_status(segments, ticket_status)
    journey = _build_journey_for_ticket(source_ticket.get("journey"), marked_segments, total_components, len(cloned_passengers), leg_structure=leg_structure)
    raw_data = _clone_json(source_ticket.get("raw_data") or {})
    if status_note:
        raw_data.setdefault("operation_notes", [])
        raw_data["operation_notes"].append(status_note)
    return {
        "pnr": pnr if pnr is not None else source_ticket.get("pnr"),
        "booking_date": source_ticket.get("booking_date"),
        "phone": source_ticket.get("phone"),
        "currency": source_ticket.get("currency", "INR"),
        "grand_total": _round_money(total_components["total"]),
        "class_of_travel": source_ticket.get("class_of_travel"),
        "trip_type": source_ticket.get("trip_type"),
        "passengers_data": json.dumps(cloned_passengers),
        "segments_data": json.dumps(marked_segments),
        "journey_data": json.dumps(journey),
        "raw_data": json.dumps(raw_data),
        "status": source_ticket.get("status", "edited"),
        "ticket_status": ticket_status,
        "matched_itinerary_id": source_ticket.get("matched_itinerary_id"),
        "parser_version": source_ticket.get("parser_version"),
        "parent_ticket_id": parent_ticket_id,
        "cancellation_charge": cancellation_charge,
        "last_aggregator": source_ticket.get("last_aggregator"),
        "last_booked_by": source_ticket.get("last_booked_by"),
    }


def _serialize_ticket_model(ticket):
    return {
        "id": ticket.id,
        "pnr": ticket.pnr,
        "booking_date": ticket.booking_date,
        "phone": ticket.phone,
        "currency": ticket.currency,
        "grand_total": ticket.grand_total,
        "class_of_travel": ticket.class_of_travel,
        "trip_type": ticket.trip_type,
        "passengers_data": ticket.passengers_data,
        "segments_data": ticket.segments_data,
        "journey_data": ticket.journey_data,
        "raw_data": ticket.raw_data,
        "status": ticket.status,
        "matched_itinerary_id": ticket.matched_itinerary_id,
        "parser_version": ticket.parser_version,
        "ticket_status": ticket.ticket_status,
        "ledger_hash": ticket.ledger_hash,
        "parent_ticket_id": ticket.parent_ticket_id,
        "booking_group_id": ticket.booking_group_id,
        "cancellation_charge": ticket.cancellation_charge,
        "last_aggregator": ticket.last_aggregator,
        "last_booked_by": ticket.last_booked_by,
    }


def _restore_ticket_snapshot(snapshot, user_id):
    ticket = Ticket.query.filter_by(id=snapshot["id"], user_id=user_id).first()
    if not ticket:
        return
    for field, value in snapshot.items():
        if field == "id":
            continue
        setattr(ticket, field, value)


def _apply_ticket_payload(ticket, payload):
    for field, value in payload.items():
        setattr(ticket, field, value)
    ticket.ledger_hash = _compute_fare_hash(
        ticket.pnr or "",
        parseFloat(json.loads(ticket.journey_data or "{}").get("consolidated_fare", {}).get("base_fare", 0)),
        parseFloat(json.loads(ticket.journey_data or "{}").get("consolidated_fare", {}).get("k3_gst", 0)),
        parseFloat(json.loads(ticket.journey_data or "{}").get("consolidated_fare", {}).get("other_taxes", 0)),
        parseFloat(json.loads(ticket.journey_data or "{}").get("global_markup", 0)) * len(json.loads(ticket.passengers_data or "[]")),
        ticket.grand_total or 0,
    )


def _ticket_dict_with_children(ticket):
    passengers = json.loads(ticket.passengers_data) if ticket.passengers_data else []
    segments = json.loads(ticket.segments_data) if ticket.segments_data else []
    journey = json.loads(ticket.journey_data) if ticket.journey_data else {}
    raw = json.loads(ticket.raw_data) if ticket.raw_data else {}
    _ensure_passenger_internal_ids(passengers)
    segments = _segments_with_barcodes(ticket, passengers, segments, raw)
    return {
        "id": ticket.id,
        "created_at": ticket.created_at.isoformat(),
        "updated_at": ticket.updated_at.isoformat() if ticket.updated_at else None,
        "pnr": ticket.pnr,
        "booking_date": ticket.booking_date,
        "phone": ticket.phone,
        "currency": ticket.currency,
        "grand_total": ticket.grand_total,
        "class_of_travel": ticket.class_of_travel,
        "trip_type": ticket.trip_type,
        "status": ticket.status,
        "ticket_status": ticket.ticket_status or "live",
        "matched_itinerary_id": ticket.matched_itinerary_id,
        "parser_version": ticket.parser_version,
        "passengers": passengers,
        "segments": segments,
        "journey": journey,
        "raw_data": raw,
        "ledger_hash": ticket.ledger_hash,
        "parent_ticket_id": ticket.parent_ticket_id,
        "booking_group_id": ticket.booking_group_id,
        "duplicate_status": ticket.duplicate_status,
        "duplicate_of_id": ticket.duplicate_of_id,
        "cancellation_charge": ticket.cancellation_charge or 0,
        "last_aggregator": ticket.last_aggregator,
        "last_booked_by": ticket.last_booked_by,
        "booking_group": {
            "id": ticket.booking_group.id,
            "pnr": ticket.booking_group.pnr,
            "status": ticket.booking_group.status,
        } if ticket.booking_group else None,
        "children": [{"id": child.id, "pnr": child.pnr, "ticket_status": child.ticket_status, "grand_total": child.grand_total} for child in ticket.children],
    }


def _booking_group_sorted_tickets(booking_group):
    return sorted(list(booking_group.tickets), key=lambda item: (item.created_at, item.id))


def _is_booking_group_lead(ticket):
    if not ticket.booking_group:
        return False
    ordered = _booking_group_sorted_tickets(ticket.booking_group)
    return bool(ordered and ordered[0].id == ticket.id)


def _merged_ticket_dict(booking_group, lead_ticket):
    lead_payload = _ticket_dict_with_children(lead_ticket)
    merged_passengers = []
    merged_total = 0.0
    merged_ticket_ids = []
    merged_base = 0.0
    merged_k3 = 0.0
    merged_other = 0.0
    merged_markup_total = 0.0
    for grouped_ticket in _booking_group_sorted_tickets(booking_group):
        merged_ticket_ids.append(grouped_ticket.id)
        merged_total += parseFloat(grouped_ticket.grand_total or 0)
        ticket_passengers = json.loads(grouped_ticket.passengers_data or "[]")
        _ensure_passenger_internal_ids(ticket_passengers)
        grouped_journey = json.loads(grouped_ticket.journey_data or "{}")
        grouped_financials = _ticket_financials(ticket_passengers, grouped_journey)
        merged_base += parseFloat(grouped_financials.get("base", 0))
        merged_k3 += parseFloat(grouped_financials.get("k3", 0))
        merged_other += parseFloat(grouped_financials.get("other", 0))
        merged_markup_total += parseFloat(grouped_financials.get("mu", 0))
        for passenger in ticket_passengers:
            passenger_copy = _clone_json(passenger)
            passenger_copy["source_ticket_id"] = grouped_ticket.id
            merged_passengers.append(passenger_copy)

    lead_payload["passengers"] = merged_passengers
    lead_payload["passenger_names"] = [p.get("name", "") for p in merged_passengers]
    lead_payload["grand_total"] = _round_money(merged_total)
    lead_payload.setdefault("journey", {})
    lead_payload["journey"]["consolidated_fare"] = {
        "base_fare": _round_money(merged_base),
        "k3_gst": _round_money(merged_k3),
        "other_taxes": _round_money(merged_other),
    }
    merged_passenger_count = len(merged_passengers)
    lead_payload["journey"]["global_markup"] = (
        _round_money(merged_markup_total / merged_passenger_count)
        if merged_passenger_count else 0.0
    )
    lead_payload["is_merged_view"] = True
    lead_payload["merged_ticket_ids"] = merged_ticket_ids
    lead_payload["merged_ticket_count"] = len(merged_ticket_ids)
    lead_payload["booking_group"] = {
        "id": booking_group.id,
        "pnr": booking_group.pnr,
        "status": booking_group.status,
    }
    return lead_payload


def _collect_ticket_delete_side_effects(ticket, user_id):
    ledger_entries = LedgerEntry.query.filter_by(ticket_id=ticket.id, user_id=user_id).all()
    mapped_entry = None
    if ticket.ledger_hash and ticket.ledger_hash.startswith("MAPPED_"):
        mapped_id = ticket.ledger_hash.replace("MAPPED_", "").strip()
        if mapped_id:
            mapped_entry = LedgerEntry.query.filter_by(id=mapped_id, user_id=user_id).first()

    agg_ids = set()
    for entry in ledger_entries:
        agg_id = _delete_ledger_entry_with_reverse(entry, user_id)
        if agg_id:
            agg_ids.add(agg_id)
    if mapped_entry and mapped_entry not in ledger_entries:
        agg_id = _delete_ledger_entry_with_reverse(mapped_entry, user_id)
        if agg_id:
            agg_ids.add(agg_id)
    return agg_ids


def _delete_ticket_record(ticket, user_id):
    agg_ids = _collect_ticket_delete_side_effects(ticket, user_id)
    db.session.delete(ticket)
    return agg_ids


def _delete_booking_group_records(booking_group, user_id, ticket_ids=None):
    selected_ids = set(ticket_ids or [])
    grouped_tickets = _booking_group_sorted_tickets(booking_group)
    if selected_ids:
        grouped_tickets = [ticket for ticket in grouped_tickets if ticket.id in selected_ids]
    agg_ids = set()
    for grouped_ticket in grouped_tickets:
        agg_ids.update(_delete_ticket_record(grouped_ticket, user_id))
    deleted_ids = {t.id for t in grouped_tickets}
    remaining = [ticket for ticket in _booking_group_sorted_tickets(booking_group) if ticket.id not in deleted_ids]
    if len(remaining) == 1:
        remaining[0].booking_group_id = None
        db.session.delete(booking_group)
    elif not remaining:
        db.session.delete(booking_group)
    return agg_ids, len(grouped_tickets)


def _create_ledger_entry_from_plan(agg_id, user_id, row_order, pnr, booking_by, entry_type, components, fee, remarks, ticket_id):
    entry = LedgerEntry(
        aggregator_id=agg_id,
        user_id=user_id,
        row_order=row_order,
        date=datetime.now().strftime("%d-%b-%Y"),
        pnr=pnr or "",
        basic=components["base"],
        k3=components["k3"],
        other_taxes=components["other"],
        mu=components["mu"],
        xxd=str(_round_money(fee)) if fee else "",
        ticket_total=_round_money(components["base"] + components["k3"] + components["other"] + components["mu"]),
        aggregator_total=_round_money(components["base"] + components["k3"] + components["other"]),
        booking_by=booking_by or "",
        entry_type=entry_type,
        remarks=remarks or "",
        ticket_id=ticket_id,
    )
    db.session.add(entry)
    db.session.flush()
    return entry


def _reverse_ticket_operation(operation):
    if not operation or operation.status == "reversed":
        return

    metadata = json.loads(operation.metadata_json or "{}")
    created_ticket_ids = metadata.get("created_ticket_ids", [])
    links = OperationLedgerLink.query.filter_by(operation_id=operation.id, user_id=operation.user_id).all()
    for link in links:
        entry = LedgerEntry.query.filter_by(id=link.ledger_entry_id, user_id=operation.user_id).first()
        if entry:
            db.session.delete(entry)
        db.session.delete(link)

    for ticket_id in created_ticket_ids:
        ticket = Ticket.query.filter_by(id=ticket_id, user_id=operation.user_id).first()
        if ticket:
            db.session.delete(ticket)

    for snapshot in json.loads(operation.before_state or "[]"):
        _restore_ticket_snapshot(snapshot, operation.user_id)

    operation.status = "reversed"
    db.session.flush()
    if operation.aggregator_id:
        _recalc_running_balance(operation.aggregator_id, operation.user_id)


def _delete_ledger_entry_with_reverse(entry, user_id):
    if not entry:
        return None
    agg_id = entry.aggregator_id
    link = OperationLedgerLink.query.filter_by(ledger_entry_id=entry.id, user_id=user_id).first()
    if link:
        operation = TicketOperation.query.filter_by(id=link.operation_id, user_id=user_id).first()
        _reverse_ticket_operation(operation)
        # Clear ledger flags on tickets involved in this operation
        if operation:
            metadata = json.loads(operation.metadata_json or "{}")
            affected_ids = set()
            if operation.root_ticket_id:
                affected_ids.add(operation.root_ticket_id)
            affected_ids.update(metadata.get("updated_ticket_ids", []) or [])
            for snapshot in json.loads(operation.before_state or "[]"):
                if isinstance(snapshot, dict) and snapshot.get("id"):
                    affected_ids.add(snapshot["id"])
            for tid in affected_ids:
                t = Ticket.query.filter_by(id=tid, user_id=user_id).first()
                if t and t.ledger_hash:
                    t.ledger_hash = None
                    t.last_aggregator = None
                    t.last_booked_by = None
    else:
        db.session.delete(entry)
        # If this ledger entry was directly tied to a ticket, clear ledger_hash
        if entry.ticket_id:
            ticket = Ticket.query.filter_by(id=entry.ticket_id, user_id=user_id).first()
            if ticket and ticket.ledger_hash:
                ticket.ledger_hash = None
                ticket.last_aggregator = None
                ticket.last_booked_by = None
        # Also clear any tickets that were marked in-ledger for the same PNR/aggregator
        # If any ticket was mapped to this ledger entry, clear that mapping
        mapped = Ticket.query.filter(
            Ticket.user_id == user_id,
            Ticket.ledger_hash == f"MAPPED_{entry.id}"
        ).all()
        for t in mapped:
            t.ledger_hash = None
            t.last_aggregator = None
            t.last_booked_by = None
    # Clear any tickets that were marked in-ledger for the same PNR/aggregator
    if entry.pnr:
        linked_tickets = Ticket.query.filter_by(
            user_id=user_id,
            pnr=entry.pnr,
            last_aggregator=entry.aggregator_id
        ).all()
        for t in linked_tickets:
            if t.ledger_hash:
                t.ledger_hash = None
                t.last_aggregator = None
                t.last_booked_by = None
    return agg_id


def _add_column_if_missing(table_name, column_name, column_sql):
    """Add a column if it doesn't exist. Works on both SQLite and PostgreSQL."""
    inspector = inspect(db.engine)
    if table_name not in inspector.get_table_names():
        return
    existing_columns = {column["name"] for column in inspector.get_columns(table_name)}
    if column_name in existing_columns:
        return
    db.session.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_sql}"))
    db.session.commit()


def _create_indexes_if_missing():
    """Create indexes if they don't exist. Works on both SQLite and PostgreSQL."""
    statements = [
        "CREATE INDEX IF NOT EXISTS ix_ticket_operation_user_id ON ticket_operation (user_id)",
        "CREATE INDEX IF NOT EXISTS ix_ticket_operation_root_ticket_id ON ticket_operation (root_ticket_id)",
        "CREATE INDEX IF NOT EXISTS ix_operation_ledger_link_operation_id ON operation_ledger_link (operation_id)",
        "CREATE INDEX IF NOT EXISTS ix_operation_ledger_link_ledger_entry_id ON operation_ledger_link (ledger_entry_id)",
        "CREATE INDEX IF NOT EXISTS ix_booking_group_user_id ON booking_group (user_id)",
        "CREATE INDEX IF NOT EXISTS ix_booking_group_pnr ON booking_group (pnr)",
        "CREATE INDEX IF NOT EXISTS ix_ticket_booking_group_id ON ticket (booking_group_id)",
    ]
    for statement in statements:
        db.session.execute(text(statement))
    db.session.commit()


def ensure_schema_compatibility():
    db.create_all()

    _add_column_if_missing("ticket_operation", "updated_at", "TIMESTAMP")
    _add_column_if_missing("ticket_operation", "user_id", "VARCHAR")
    _add_column_if_missing("ticket_operation", "ticket_id", "VARCHAR")
    _add_column_if_missing("ticket_operation", "root_ticket_id", "VARCHAR")
    _add_column_if_missing("ticket_operation", "action_type", "VARCHAR(20)")
    _add_column_if_missing("ticket_operation", "scenario", "VARCHAR(40)")
    _add_column_if_missing("ticket_operation", "status", "VARCHAR(20) DEFAULT 'active'")
    _add_column_if_missing("ticket_operation", "aggregator_id", "VARCHAR")
    _add_column_if_missing("ticket_operation", "preview_data", "TEXT")
    _add_column_if_missing("ticket_operation", "before_state", "TEXT")
    _add_column_if_missing("ticket_operation", "after_state", "TEXT")
    _add_column_if_missing("ticket_operation", "metadata_json", "TEXT")
    _add_column_if_missing("ticket", "booking_group_id", "VARCHAR")
    _add_column_if_missing("ticket", "duplicate_status", "VARCHAR(20)")
    _add_column_if_missing("ticket", "duplicate_of_id", "VARCHAR")

    _add_column_if_missing("operation_ledger_link", "created_at", "TIMESTAMP")
    _add_column_if_missing("operation_ledger_link", "user_id", "VARCHAR")
    _add_column_if_missing("operation_ledger_link", "operation_id", "VARCHAR")
    _add_column_if_missing("operation_ledger_link", "ledger_entry_id", "VARCHAR")

    _create_indexes_if_missing()

# ==================== LEDGER ROUTES ====================

def _recalc_running_balance(aggregator_id, user_id):
    """Recalculate running balance for ALL entries in an aggregator from top to bottom."""
    entries = LedgerEntry.query.filter_by(
        aggregator_id=aggregator_id, user_id=user_id
    ).order_by(LedgerEntry.row_order).all()
    balance = 0.0
    for e in entries:
        # Same formula as test.py:  running_balance = prev_balance - aggregator_total
        balance = balance - (e.aggregator_total or 0)
        e.running_balance = balance
    db.session.commit()

def _entry_dict(e):
    return {
        "id": e.id, "aggregator_id": e.aggregator_id,
        "row_order": e.row_order,
        "invoice_no": e.invoice_no or "", "date": e.date or "",
        "pnr": e.pnr or "",
        "basic": e.basic or 0, "k3": e.k3 or 0,
        "other_taxes": e.other_taxes or 0, "mu": e.mu or 0,
        "xxd": e.xxd or "",
        "ticket_total": e.ticket_total or 0,
        "aggregator_total": e.aggregator_total or 0,
        "running_balance": e.running_balance or 0,
        "booking_by": e.booking_by or "",
        "entry_type": e.entry_type or "New",
        "billing": e.billing or "",
        "remarks": e.remarks or "",
        "seat_status": e.seat_status or "",
        "seat_remarks": e.seat_remarks or "",
        "meal_status": e.meal_status or "",
        "ticket_id": e.ticket_id or "",
    }

@app.route("/api/aggregators", methods=["GET"])
@login_required
def list_aggregators():
    aggs = Aggregator.query.filter_by(user_id=session['user_id']).order_by(Aggregator.created_at).all()
    return jsonify({"aggregators": [{"id": a.id, "name": a.name} for a in aggs]})

@app.route("/api/aggregators", methods=["POST"])
@login_required
def create_aggregator():
    data = request.get_json()
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Name is required"}), 400
    agg = Aggregator(name=name, user_id=session['user_id'])
    db.session.add(agg)
    db.session.commit()
    return jsonify({"id": agg.id, "name": agg.name}), 201

@app.route("/api/aggregators/<agg_id>", methods=["DELETE"])
@login_required
def delete_aggregator(agg_id):
    agg = Aggregator.query.filter_by(id=agg_id, user_id=session['user_id']).first()
    if not agg:
        return jsonify({"error": "Not found"}), 404
    db.session.delete(agg)
    db.session.commit()
    return jsonify({"message": "Deleted"})

@app.route("/api/aggregators/<agg_id>/entries", methods=["GET"])
@login_required
def list_entries(agg_id):
    entries = LedgerEntry.query.filter_by(
        aggregator_id=agg_id, user_id=session['user_id']
    ).order_by(LedgerEntry.row_order).all()
    return jsonify({"entries": [_entry_dict(e) for e in entries]})

@app.route("/api/aggregators/<agg_id>/entries", methods=["POST"])
@login_required
def create_entry(agg_id):
    data = request.get_json() or {}
    # Determine next row_order
    last = LedgerEntry.query.filter_by(
        aggregator_id=agg_id, user_id=session['user_id']
    ).order_by(LedgerEntry.row_order.desc()).first()
    next_order = (last.row_order + 1) if last else 0

    basic = parseFloat(data.get("basic", 0))
    k3 = parseFloat(data.get("k3", 0))
    other_taxes = parseFloat(data.get("other_taxes", 0))
    mu = parseFloat(data.get("mu", 0))
    ticket_total = basic + k3 + other_taxes + mu
    aggregator_total = ticket_total - mu

    entry = LedgerEntry(
        aggregator_id=agg_id,
        user_id=session['user_id'],
        row_order=next_order,
        invoice_no=data.get("invoice_no", ""),
        date=data.get("date", datetime.now().strftime("%d-%b-%Y")),
        pnr=data.get("pnr", ""),
        basic=basic, k3=k3, other_taxes=other_taxes, mu=mu,
        xxd=data.get("xxd", ""),
        ticket_total=ticket_total,
        aggregator_total=aggregator_total,
        booking_by=data.get("booking_by", ""),
        entry_type=data.get("entry_type", "New"),
        billing=data.get("billing", ""),
        remarks=data.get("remarks", ""),
        seat_status=data.get("seat_status", ""),
        seat_remarks=data.get("seat_remarks", ""),
        meal_status=data.get("meal_status", ""),
        ticket_id=data.get("ticket_id", None),
    )
    db.session.add(entry)
    db.session.commit()
    _recalc_running_balance(agg_id, session['user_id'])
    return jsonify(_entry_dict(LedgerEntry.query.get(entry.id))), 201

@app.route("/api/ledger-entries/<entry_id>", methods=["PUT"])
@login_required
def update_entry(entry_id):
    entry = LedgerEntry.query.filter_by(id=entry_id, user_id=session['user_id']).first()
    if not entry:
        return jsonify({"error": "Not found"}), 404
    data = request.get_json() or {}
    for field in ["invoice_no", "date", "pnr", "xxd", "booking_by",
                   "entry_type", "billing", "remarks", "seat_status", "seat_remarks", "meal_status"]:
        if field in data:
            setattr(entry, field, data[field])
    for field in ["basic", "k3", "other_taxes", "mu"]:
        if field in data:
            setattr(entry, field, parseFloat(data[field]))
    # Recalc totals
    entry.ticket_total = entry.basic + entry.k3 + entry.other_taxes + entry.mu
    entry.aggregator_total = entry.ticket_total - entry.mu
    db.session.commit()
    _recalc_running_balance(entry.aggregator_id, session['user_id'])
    return jsonify(_entry_dict(LedgerEntry.query.get(entry.id)))

@app.route("/api/ledger-entries/<entry_id>", methods=["DELETE"])
@login_required
def delete_entry(entry_id):
    entry = LedgerEntry.query.filter_by(id=entry_id, user_id=session['user_id']).first()
    if not entry:
        return jsonify({"error": "Not found"}), 404
    agg_id = _delete_ledger_entry_with_reverse(entry, session['user_id'])

    db.session.commit()
    if agg_id:
        _recalc_running_balance(agg_id, session['user_id'])
    return jsonify({"message": "Deleted"})

@app.route("/api/tickets/<ticket_id>/add-to-ledger", methods=["POST"])
@login_required
def add_ticket_to_ledger(ticket_id):
    """Auto-populate a ledger entry from a ticket's fare data."""
    data = request.get_json() or {}
    agg_id = data.get("aggregator_id")
    booking_by = data.get("booking_by", "AB")
    if not agg_id:
        return jsonify({"error": "aggregator_id required"}), 400

    ticket = Ticket.query.get(ticket_id)
    if not ticket:
        return jsonify({"error": "Ticket not found"}), 404

    passengers = json.loads(ticket.passengers_data or '[]')
    journey = json.loads(ticket.journey_data or '{}')
    n_pax = len(passengers) if passengers else 1
    mu_per_pax = parseFloat(journey.get('global_markup', 0))
    mu_total = mu_per_pax * n_pax

    basic = 0.0; k3 = 0.0; other_taxes = 0.0
    c_fare = journey.get('consolidated_fare')
    if c_fare:
        basic = parseFloat(c_fare.get('base_fare', 0))
        k3 = parseFloat(c_fare.get('k3_gst', 0))
        other_taxes = parseFloat(c_fare.get('other_taxes', 0))
    else:
        for p in passengers:
            f = p.get('fare', {})
            basic += parseFloat(f.get('base_fare', 0))
            k3 += parseFloat(f.get('k3_gst', 0))
            other_taxes += parseFloat(f.get('other_taxes', 0))

    ticket_total = basic + k3 + other_taxes + mu_total
    aggregator_total = ticket_total - mu_total

    # Get current balance and next row order
    last = LedgerEntry.query.filter_by(
        aggregator_id=agg_id, user_id=session['user_id']
    ).order_by(LedgerEntry.row_order.desc()).first()
    
    curr_bal = last.running_balance if last else 0.0
    if curr_bal < aggregator_total:
        return jsonify({
            "error": "insufficient_balance",
            "message": f"Insufficient balance in ledger. Current: ₹{curr_bal}, Required: ₹{aggregator_total}",
            "current_balance": curr_bal,
            "required_amount": aggregator_total,
            "aggregator_id": agg_id
        }), 402

    next_order = (last.row_order + 1) if last else 0

    # Compute ledger hash to prevent duplicates
    fare_hash_data = f"{ticket.pnr}:{basic}:{k3}:{other_taxes}:{mu_total}:{ticket_total}"
    new_hash = hashlib.sha256(fare_hash_data.encode()).hexdigest()

    # Check for duplicate by hash
    if ticket.ledger_hash == new_hash:
        return jsonify({"error": "This ticket has already been added to a ledger with this exact fare data."}), 409
        
    # Check for duplicate by PNR (fallback)
    existing = LedgerEntry.query.filter_by(pnr=ticket.pnr, user_id=session['user_id']).first()
    if existing:
        # If it already exists in the ledger with this PNR, we mark the ticket as hashed and stop
        ticket.ledger_hash = new_hash
        db.session.commit()
        return jsonify({"error": f"PNR {ticket.pnr} already exists in the ledger. Mapping ticket record now."}), 409

    entry = LedgerEntry(
        aggregator_id=agg_id,
        user_id=session['user_id'],
        row_order=next_order,
        date=datetime.now().strftime("%d-%b-%Y"),
        pnr=ticket.pnr or "",
        basic=basic, k3=k3, other_taxes=other_taxes, mu=mu_total,
        ticket_total=ticket_total,
        aggregator_total=aggregator_total,
        booking_by=booking_by,
        entry_type="New",
        ticket_id=ticket_id,
    )
    db.session.add(entry)
    ticket.ledger_hash = new_hash
    ticket.last_aggregator = agg_id
    ticket.last_booked_by = booking_by
    db.session.commit()
    _recalc_running_balance(agg_id, session['user_id'])
    return jsonify({"message": "Added to ledger", "entry": _entry_dict(LedgerEntry.query.get(entry.id))}), 201


@app.route("/api/user", methods=["GET"])
@login_required
def get_user():
    """Get current user info"""
    user = User.query.get(session['user_id'])
    if not user:
        return jsonify({"error": "User not found"}), 404
    
    return jsonify({
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "full_name": user.full_name
    })

# ==================== CUSTOMER ROUTES ====================

@app.route("/api/customers", methods=["GET"])
@login_required
def get_customers():
    """Get all customers for the logged-in user"""
    customers = Customer.query.filter_by(user_id=session['user_id']).all()
    
    return jsonify({
        "customers": [{
            "id": c.id,
            "name": c.name,
            "email": c.email,
            "phone": c.phone,
            "address": c.address,
            "customer_type": c.customer_type,
            "company_name": c.company_name,
            "gst_number": c.gst_number
        } for c in customers]
    })

@app.route("/api/customers", methods=["POST"])
@login_required
def create_customer():
    """Create a new customer"""
    try:
        data = request.get_json()
        
        if not data or not data.get('name'):
            return jsonify({"error": "Customer name is required"}), 400
        
        customer = Customer(
            name=data['name'],
            email=data.get('email'),
            phone=data.get('phone'),
            address=data.get('address'),
            customer_type=data.get('customer_type', 'passenger'),
            company_name=data.get('company_name'),
            gst_number=data.get('gst_number'),
            user_id=session['user_id']
        )
        
        db.session.add(customer)
        db.session.commit()
        
        return jsonify({
            "message": "Customer created successfully",
            "customer": {
                "id": customer.id,
                "name": customer.name,
                "email": customer.email,
                "phone": customer.phone,
                "customer_type": customer.customer_type
            }
        }), 201
        
    except Exception as e:
        db.session.rollback()
        print(f"Customer creation error: {str(e)}")
        return jsonify({"error": "Failed to create customer"}), 500

@app.route("/api/customers/<customer_id>", methods=["GET"])
@login_required
def get_customer(customer_id):
    """Get a specific customer"""
    customer = Customer.query.filter_by(id=customer_id, user_id=session['user_id']).first()
    
    if not customer:
        return jsonify({"error": "Customer not found"}), 404
    
    return jsonify({
        "id": customer.id,
        "name": customer.name,
        "email": customer.email,
        "phone": customer.phone,
        "address": customer.address,
        "customer_type": customer.customer_type,
        "company_name": customer.company_name,
        "gst_number": customer.gst_number
    })

# ==================== ITINERARY ROUTES ====================

@app.route("/parse", methods=["POST"])
def parse():
    """Parse flight information (public endpoint for initial parsing)"""
    try:
        payload = request.get_json()
        
        if not payload:
            print("[ERROR] No payload received")
            return jsonify({"error": "No data provided"}), 400

        raw_flights = payload.get("flights", [])
        fares_list = payload.get("fares", [])
        fare_mu_list = payload.get("fare_mu", [])   # Per-fare markups
        fare_svc_list = payload.get("fare_svc", []) # Per-fare service charges
        layover_flags = payload.get("layover_flags", [])
        multiple_flight_flags = payload.get("multiple_flight_flags", [])
        markup = payload.get("markup", 0)
        global_svc = payload.get("global_svc", 0)

        fare_extra_details_list = payload.get("fare_extra_details", [])
        
        if not raw_flights:
            print("[ERROR] No flights provided")
            return jsonify({"error": "No flights provided"}), 400

        # fares_list can be empty or have empty objects - that's OK, parser will extract
        if not isinstance(fares_list, list):
            print("[ERROR] fares_list is not a list")
            return jsonify({"error": "Invalid fares format"}), 400

        # Parse each flight
        parsed_flights = []
        
        for i, raw_text in enumerate(raw_flights):
            has_layover = layover_flags[i] if i < len(layover_flags) else False
            is_multiple = multiple_flight_flags[i] if i < len(multiple_flight_flags) else False
            
            # Get user-provided fares for this flight block
            user_fares = fares_list[i] if i < len(fares_list) else {}
            user_fare_mu = fare_mu_list[i] if i < len(fare_mu_list) else {}  # Per-fare MU
            user_fare_svc = fare_svc_list[i] if i < len(fare_svc_list) else {}  # Per-fare SVC
            user_fare_extras = fare_extra_details_list[i] if i < len(fare_extra_details_list) else {} # Per-fare extras
            
            if is_multiple:
                # Parse as multiple flights
                print(f"[DEBUG] Parsing multiple flights from block {i+1}")
                flights_parsed = extract_multiple_flights(raw_text, has_layover=has_layover)
                
                if not flights_parsed:
                    return jsonify({
                        "error": f"Block #{i+1}: Could not parse any flights. Check text format."
                    }), 400
                
                print(f"[DEBUG] Found {len(flights_parsed)} flights in block {i+1}")
                
                for j, flight_data in enumerate(flights_parsed):
                    # Only include fares that were checked by the user
                    flight_fares = {}
                    
                    for key, val in user_fares.items():
                        if key == "saver":
                            # If saver is checked, use manual value or extracted value
                            if val is not None:
                                flight_fares[key] = val
                            elif flight_data.get("saver_fare") is not None:
                                flight_fares[key] = flight_data["saver_fare"]
                            else:
                                flight_fares[key] = 0
                        else:
                            # Other fare types use manual values
                            flight_fares[key] = val
                    
                    flight_data["fares"] = flight_fares
                    flight_data["markup"] = markup
                    flight_data["fare_mu"] = user_fare_mu      # Per-fare markups
                    flight_data["fare_svc"] = user_fare_svc    # Per-fare service charges
                    flight_data["fare_extra_details"] = user_fare_extras # Per-fare extras
                    flight_data["service_charge"] = global_svc
                    flight_data["gst"] = int(global_svc * 0.18) if global_svc > 0 else 0
                    flight_data["is_editable"] = True  # Flag for cards from Multiple Flights mode
                    
                    # Remove the saver_fare field as it's now in fares
                    if "saver_fare" in flight_data:
                        del flight_data["saver_fare"]
                    
                    parsed_flights.append(flight_data)
            else:
                # Normal single flight parsing
                flight_data = extract_flight(raw_text, has_layover=has_layover)
                
                # Only include fares that were checked by the user
                flight_fares = {}
                for key, val in user_fares.items():
                    if key == "saver":
                        if val is not None:
                            flight_fares[key] = val
                        elif flight_data.get("saver_fare") is not None:
                            flight_fares[key] = flight_data["saver_fare"]
                        else:
                            flight_fares[key] = 0
                    else:
                        flight_fares[key] = val
                
                flight_data["fares"] = flight_fares
                flight_data["markup"] = markup
                flight_data["fare_mu"] = user_fare_mu      # Per-fare markups
                flight_data["fare_svc"] = user_fare_svc    # Per-fare service charges
                flight_data["fare_extra_details"] = user_fare_extras # Per-fare extras
                flight_data["service_charge"] = global_svc
                flight_data["gst"] = int(global_svc * 0.18) if global_svc > 0 else 0
                flight_data["is_editable"] = True
                
                # Remove the saver_fare field as it's now in fares
                if "saver_fare" in flight_data:
                    del flight_data["saver_fare"]
                
                parsed_flights.append(flight_data)

        return jsonify({"flights": parsed_flights})
        
    except Exception as e:
        print(f"[ERROR] Error in parse endpoint: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": "Failed to parse flights: " + str(e)}), 500

@app.route("/api/recalculate", methods=["POST"])
def recalculate():
    """Recalculate flight duration and offsets based on a new date"""
    try:
        data = request.get_json()
        if not data or 'flight' not in data or 'new_date' not in data:
            return jsonify({"error": "Missing flight data or new date"}), 400
        
        flight = data['flight']
        new_date = data['new_date']
        
        from query_parser import recalculate_with_date
        updated_flight = recalculate_with_date(flight, new_date)
        
        return jsonify({"flight": updated_flight})
    except Exception as e:
        print(f"Recalculate error: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


def _parse_flexible_flight_date(raw_value):
    text_value = (raw_value or "").strip() if isinstance(raw_value, str) else raw_value
    if not text_value or text_value in {"N/A", "Not Specified"}:
        return None
    if isinstance(text_value, datetime):
        return text_value

    for fmt in (
        "%Y-%m-%d",
        "%d-%m-%Y",
        "%d/%m/%Y",
        "%d/%m/%y",
        "%d %b %Y",
        "%d %B %Y",
        "%d %b %y",
        "%d %B %y",
        "%b %d %Y",
        "%B %d %Y",
    ):
        try:
            return datetime.strptime(str(text_value), fmt)
        except Exception:
            pass

    try:
        import dateutil.parser
        return dateutil.parser.parse(str(text_value), dayfirst=True, fuzzy=True)
    except Exception:
        return None


def _parse_flexible_flight_time(raw_value):
    text_value = (raw_value or "").strip() if isinstance(raw_value, str) else str(raw_value or "").strip()
    if not text_value or text_value in {"N/A", "Not Specified"}:
        return None
    match = re.match(r"^(\d{1,2}):(\d{2})(?:\s*([AaPp][Mm]))?$", text_value)
    if not match:
        return None
    hours = int(match.group(1))
    minutes = int(match.group(2))
    meridiem = (match.group(3) or "").lower()
    if meridiem:
        if hours < 1 or hours > 12:
            return None
        if meridiem == "pm" and hours < 12:
            hours += 12
        if meridiem == "am" and hours == 12:
            hours = 0
    if hours < 0 or hours > 23 or minutes < 0 or minutes > 59:
        return None
    return hours, minutes


def _format_duration_minutes(total_minutes):
    if not total_minutes or total_minutes <= 0:
        return "N/A"
    hours = total_minutes // 60
    minutes = total_minutes % 60
    return f"{hours}h {minutes}m"


def _localize_airport_datetime(local_dt, airport_code):
    timezone_name = AIRPORT_TZ_MAP.get((airport_code or "").strip().upper())
    if not timezone_name:
        return None
    try:
        timezone = pytz.timezone(timezone_name)
        try:
            return timezone.localize(local_dt, is_dst=None)
        except pytz.AmbiguousTimeError:
            return timezone.localize(local_dt, is_dst=False)
        except pytz.NonExistentTimeError:
            return timezone.localize(local_dt + timedelta(hours=1), is_dst=True)
    except Exception:
        return None


def _elapsed_minutes_between_points(start_point, end_point, start_airport=None, end_airport=None):
    start_date = _parse_flexible_flight_date((start_point or {}).get("date"))
    end_date = _parse_flexible_flight_date((end_point or {}).get("date"))
    start_time = _parse_flexible_flight_time((start_point or {}).get("time"))
    end_time = _parse_flexible_flight_time((end_point or {}).get("time"))
    if not start_date or not end_date or not start_time or not end_time:
        return 0
    start_dt = datetime(
        start_date.year, start_date.month, start_date.day, start_time[0], start_time[1]
    )
    end_dt = datetime(
        end_date.year, end_date.month, end_date.day, end_time[0], end_time[1]
    )
    start_code = start_airport or (start_point or {}).get("airport")
    end_code = end_airport or (end_point or {}).get("airport")
    start_zoned = _localize_airport_datetime(start_dt, start_code)
    end_zoned = _localize_airport_datetime(end_dt, end_code)
    if start_zoned and end_zoned:
        diff_minutes = int(round((end_zoned.astimezone(pytz.utc) - start_zoned.astimezone(pytz.utc)).total_seconds() / 60.0))
    else:
        diff_minutes = int(round((end_dt - start_dt).total_seconds() / 60.0))
    if diff_minutes <= 0:
        diff_minutes += 1440
    return diff_minutes if diff_minutes > 0 else 0


def _recalculate_segment_timing_data(segments):
    from query_parser import DurationCalculator, DayOffsetCalculator

    recalculated_segments = _clone_json(segments or [])
    layovers = []
    adjustments = []
    current_cumulative_days = 0

    for seg_idx, seg in enumerate(recalculated_segments):
        departure = seg.setdefault("departure", {})
        arrival = seg.setdefault("arrival", {})

        dep_airport = (departure.get("airport") or seg.get("departure_airport") or "").strip().upper()
        arr_airport = (arrival.get("airport") or seg.get("arrival_airport") or "").strip().upper()
        dep_time = departure.get("time") or seg.get("departure_time") or ""
        arr_time = arrival.get("time") or seg.get("arrival_time") or ""
        dep_date_obj = _parse_flexible_flight_date(departure.get("date") or seg.get("departure_date"))
        arr_date_obj = _parse_flexible_flight_date(arrival.get("date") or seg.get("arrival_date"))

        explicit_days_offset = None
        if dep_date_obj and arr_date_obj:
            explicit_days_offset = max((arr_date_obj.date() - dep_date_obj.date()).days, 0)

        duration_minutes = _elapsed_minutes_between_points(departure, arrival, dep_airport, arr_airport)
        duration_text = _format_duration_minutes(duration_minutes)
        days_offset = explicit_days_offset if explicit_days_offset is not None else DayOffsetCalculator.calculate(
            dep_time,
            arr_time,
            duration_text,
            dep_airport,
            arr_airport,
            dep_date_obj,
        )

        if seg_idx == 0:
            seg["layover_duration"] = "N/A"
            seg["layover"] = "N/A"
        else:
            prev_seg = recalculated_segments[seg_idx - 1]
            prev_arrival = prev_seg.get("arrival") or {}
            prev_arr_time = prev_arrival.get("time") or prev_seg.get("arrival_time") or ""
            prev_arr_date_obj = _parse_flexible_flight_date(prev_arrival.get("date") or prev_seg.get("arrival_date"))

            if prev_arr_date_obj and dep_date_obj:
                days_between = max((dep_date_obj.date() - prev_arr_date_obj.date()).days, 0)
            else:
                days_between = 0
                try:
                    prev_arr_dt = DurationCalculator.parse_time(prev_arr_time)
                    curr_dep_dt = DurationCalculator.parse_time(dep_time)
                    if prev_arr_dt and curr_dep_dt and curr_dep_dt < prev_arr_dt:
                        days_between = 1
                except Exception:
                    days_between = 0

            layover_minutes = _elapsed_minutes_between_points(prev_arrival, departure, prev_arrival.get("airport") or prev_seg.get("arrival_airport"), dep_airport)
            layover_text = _format_duration_minutes(layover_minutes)
            seg["layover_duration"] = layover_text
            seg["layover"] = layover_text
            layovers.append({
                "after_segment": seg_idx - 1,
                "duration": layover_text,
                "at_airport": dep_airport,
            })
            if days_between > 0:
                current_cumulative_days += days_between

        seg["days_offset"] = days_offset
        seg["duration_calculated"] = duration_text
        seg["duration_extracted"] = duration_text
        seg["duration"] = duration_text
        seg["accumulated_dep_days"] = current_cumulative_days
        current_cumulative_days += days_offset
        seg["accumulated_arr_days"] = current_cumulative_days

    return {
        "segments": recalculated_segments,
        "layovers": layovers,
        "adjustments": adjustments,
    }


@app.route("/api/tickets/recalculate-segments", methods=["POST"])
@login_required
def recalculate_ticket_segments():
    try:
        payload = request.get_json(silent=True) or {}
        segments = payload.get("segments")
        if not isinstance(segments, list):
            return jsonify({"error": "Segments payload is required"}), 400
        return jsonify(_recalculate_segment_timing_data(segments))
    except Exception as e:
        print(f"Ticket segment recalculation error: {str(e)}")
        return jsonify({"error": f"Failed to recalculate segment timings: {str(e)}"}), 500


@app.route("/api/render/cards-image", methods=["POST"])
def render_cards_image():
    try:
        payload = request.get_json() or {}
        last_error = None
        image_bytes = None
        cache_key = None
        for attempt in range(3):
            render_request = _build_render_request(payload)
            cache_key = render_request["cache_key"]
            try:
                image_bytes = _render_request_bytes(render_request, timeout=_PLAYWRIGHT_QUEUE_WAIT_SECONDS if attempt == 0 else (_PLAYWRIGHT_QUEUE_WAIT_SECONDS + 2))
                break
            except Exception as exc:
                last_error = exc
                _render_log("WARN", "Card render attempt failed", attempt=attempt + 1, cache_key=(cache_key or "")[:8], error=exc)
                with _render_jobs_lock:
                    _render_jobs.pop(cache_key, None)
                if attempt < 2:
                    try:
                        asyncio.run(_reset_playwright_browser())
                    except Exception:
                        pass
                    threading.Event().wait(0.2 * (attempt + 1))
                    continue
        if image_bytes is None:
            raise last_error or RuntimeError("Failed to render cards image")

        _store_render_cache(cache_key, image_bytes)
        _render_log("INFO", "Server-side card render succeeded", cache_key=(cache_key or "")[:8], bytes=len(image_bytes))

        return send_file(
            io.BytesIO(image_bytes),
            mimetype="image/png",
            as_attachment=False,
            download_name="flight-cards.png",
        )
    except Exception as e:
        app.logger.exception("Server-side card render failed")
        _render_log("ERROR", "Server-side card render failed", error=e)
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"Failed to render cards image: {str(e)}"}), 500


@app.route("/api/render/cards-image/preload", methods=["POST"])
def preload_cards_image():
    try:
        payload = request.get_json() or {}
        render_request = _build_render_request(payload)
        cache_key = render_request["cache_key"]
        cached = _get_cached_render_bytes(cache_key)
        if cached is not None:
            return jsonify({"status": "cached", "cache_key": cache_key, "ready": True})
        _render_request_bytes(render_request, timeout=_PLAYWRIGHT_QUEUE_WAIT_SECONDS + 2)
        return jsonify({"status": "ready", "cache_key": cache_key, "ready": True})
    except Exception as e:
        app.logger.exception("Card image preload failed")
        return jsonify({"error": f"Failed to preload cards image: {str(e)}"}), 500


@app.route("/api/render/cards-preview/<token>", methods=["GET"])
def get_cards_preview_payload(token):
    preview_payload = _get_render_preview(token)
    if not preview_payload:
        return jsonify({"error": "Preview session expired"}), 404
    return jsonify(preview_payload)

@app.route("/api/itineraries", methods=["POST"])
@login_required
def save_itinerary():
    """Save a new itinerary"""
    try:
        data = request.get_json()
        
        if not data or not data.get('flights') or not data.get('final_text'):
            return jsonify({"error": "Missing required itinerary data"}), 400
        
        # Calculate total amount
        total_amount = 0
        markup = data.get('markup', 0)
        for flight in data['flights']:
            if 'fares' in flight:
                for fare_value in flight['fares'].values():
                    total_amount += fare_value + markup
        
        # Create itinerary
        itinerary = Itinerary(
            total_amount=total_amount,
            markup=data.get('markup', 0),
            status='draft',
            final_text=data['final_text'],
            flights_data=json.dumps(data['flights']),
            user_id=session['user_id'],
            billing_type=data.get('billing_type') or 'passenger',
            bill_to_name=data.get('bill_to_name'),
            bill_to_email=data.get('bill_to_email'),
            bill_to_phone=data.get('bill_to_phone'),
            bill_to_address=data.get('bill_to_address'),
            bill_to_company=data.get('bill_to_company'),
            bill_to_gst=data.get('bill_to_gst'),
            customer_id=data.get('customer_id')
        )
        
        db.session.add(itinerary)
        db.session.commit()
        
        return jsonify({
            "message": "Itinerary saved successfully",
            "itinerary_id": itinerary.id
        }), 201
        
    except Exception as e:
        db.session.rollback()
        print(f"Itinerary save error: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"Failed to save itinerary: {str(e)}"}), 500

@app.route("/api/itineraries", methods=["GET"])
@login_required
def get_itineraries():
    """Get all itineraries for the logged-in user"""
    itineraries = Itinerary.query.filter_by(user_id=session['user_id']).order_by(Itinerary.created_at.desc()).all()
    
    return jsonify({
        "itineraries": [{
            "id": i.id,
            "created_at": i.created_at.isoformat(),
            "updated_at": i.updated_at.isoformat(),
            "total_amount": i.total_amount,
            "markup": i.markup,
            "status": i.status,
            "billing_type": i.billing_type,
            "bill_to_name": i.bill_to_name,
            "flights_count": len(json.loads(i.flights_data)) if i.flights_data else 0,
            "hold_deadline": i.hold_deadline.isoformat() if i.hold_deadline else None,
            "customer": {
                "name": i.customer.name if i.customer else None
            } if i.customer else None
        } for i in itineraries]
    })

@app.route("/api/itineraries/<itinerary_id>", methods=["GET"])
@login_required
def get_itinerary(itinerary_id):
    """Get a specific itinerary"""
    itinerary = Itinerary.query.filter_by(id=itinerary_id, user_id=session['user_id']).first()
    
    if not itinerary:
        return jsonify({"error": "Itinerary not found"}), 404
    
    return jsonify({
        "id": itinerary.id,
        "created_at": itinerary.created_at.isoformat(),
        "updated_at": itinerary.updated_at.isoformat(),
        "total_amount": itinerary.total_amount,
        "markup": itinerary.markup,
        "status": itinerary.status,
        "final_text": itinerary.final_text,
        "flights": json.loads(itinerary.flights_data) if itinerary.flights_data else [],
        "billing_type": itinerary.billing_type,
        "bill_to_name": itinerary.bill_to_name,
        "bill_to_email": itinerary.bill_to_email,
        "bill_to_phone": itinerary.bill_to_phone,
        "bill_to_address": itinerary.bill_to_address,
        "bill_to_company": itinerary.bill_to_company,
        "bill_to_gst": itinerary.bill_to_gst,
        "customer": {
            "id": itinerary.customer.id,
            "name": itinerary.customer.name,
            "email": itinerary.customer.email
        } if itinerary.customer else None
    })

@app.route("/api/itineraries/<itinerary_id>", methods=["PUT"])
@login_required
def update_itinerary(itinerary_id):
    """Update an existing itinerary"""
    try:
        itinerary = Itinerary.query.filter_by(id=itinerary_id, user_id=session['user_id']).first()
        
        if not itinerary:
            return jsonify({"error": "Itinerary not found"}), 404
        
        data = request.get_json()
        
        if 'status' in data:
            itinerary.status = data['status']
        
        if 'flights' in data:
            itinerary.flights_data = json.dumps(data['flights'])
            
            # Recalculate total amount
            total_amount = 0
            for flight in data['flights']:
                if 'fares' in flight:
                    for fare_value in flight['fares'].values():
                        total_amount += fare_value + flight.get('markup', 0)
            itinerary.total_amount = total_amount
        
        if 'final_text' in data:
            itinerary.final_text = data['final_text']
        
        if 'billing_type' in data:
            itinerary.billing_type = data['billing_type']
        
        if 'bill_to_name' in data:
            itinerary.bill_to_name = data['bill_to_name']
        
        if 'bill_to_email' in data:
            itinerary.bill_to_email = data['bill_to_email']
        
        if 'bill_to_phone' in data:
            itinerary.bill_to_phone = data['bill_to_phone']
        
        if 'bill_to_address' in data:
            itinerary.bill_to_address = data['bill_to_address']
        
        if 'bill_to_company' in data:
            itinerary.bill_to_company = data['bill_to_company']
        
        if 'bill_to_gst' in data:
            itinerary.bill_to_gst = data['bill_to_gst']
        
        if 'customer_id' in data:
            itinerary.customer_id = data['customer_id']
        
        itinerary.updated_at = datetime.utcnow()
        
        db.session.commit()
        
        return jsonify({"message": "Itinerary updated successfully"})
        
    except Exception as e:
        db.session.rollback()
        print(f"Itinerary update error: {str(e)}")
        return jsonify({"error": "Failed to update itinerary"}), 500

@app.route("/api/itineraries/<itinerary_id>", methods=["DELETE"])
@login_required
def delete_itinerary(itinerary_id):
    """Delete an itinerary"""
    try:
        itinerary = Itinerary.query.filter_by(id=itinerary_id, user_id=session['user_id']).first()
        
        if not itinerary:
            return jsonify({"error": "Itinerary not found"}), 404
        
        db.session.delete(itinerary)
        db.session.commit()
        
        return jsonify({"message": "Itinerary deleted successfully"})
        
    except Exception as e:
        db.session.rollback()
        print(f"Itinerary deletion error: {str(e)}")
        return jsonify({"error": "Failed to delete itinerary"}), 500


# ==================== TICKET RECEIVE ENDPOINT ====================

@app.route("/api/tickets", methods=["POST"])
def receive_ticket():
    """Receive a ticket from the ticket parser and save to database"""
    # 1. Check API Key
    auth_header = request.headers.get("Authorization")
    if auth_header != f"Bearer {API_KEY}":
        print("Unauthorized request")
        return jsonify({"error": "Unauthorized"}), 401

    # 2. Get JSON data
    data = request.get_json()
    if not data:
        print("No JSON received")
        return jsonify({"error": "Invalid JSON"}), 400

    print("\n===== NEW TICKET RECEIVED =====")
    print(json.dumps(data, indent=2, default=str))
    print("=================================\n")

    try:
        booking = data.get("booking") or {}
        passengers = data.get("passengers") or []
        segments = data.get("segments") or []
        journey = data.get("journey") or {}
        metadata = data.get("metadata") or {}
        processing_batch_id = (
            (metadata.get("processing_batch_id") or metadata.get("batch_id") or data.get("processing_batch_id") or data.get("batch_id") or "").strip()
            if isinstance(metadata, dict) else str(data.get("processing_batch_id") or data.get("batch_id") or "").strip()
        )

        # Determine trip type - properly handle layovers
        # A layover exists when consecutive segments share airports
        # (arrival airport of seg N == departure airport of seg N+1)
        seg_count = len(segments)
        
        # First, group segments into logical legs (a leg = direct or layover flight)
        leg_indices = _build_legs_from_data(segments, journey)
        legs = [[segments[idx] for idx in indices] for indices in leg_indices if indices]
        
        # Also check journey data from parser for trip_type hint
        journey_trip_type = journey.get("trip_type", "").lower() if journey else ""
        
        num_legs = len(legs)
        if journey_trip_type in ["round_trip", "return"]:
            trip_type = "round_trip"
        elif journey_trip_type == "multi_city":
            trip_type = "multi_city"
        elif num_legs >= 3:
            trip_type = "multi_city"
        elif num_legs == 2:
            # Check if it's a round trip (second leg returns to origin of first leg)
            first_leg_origin = legs[0][0].get("departure", {}).get("airport", "").strip().upper()
            second_leg_dest = legs[1][-1].get("arrival", {}).get("airport", "").strip().upper()
            if first_leg_origin and second_leg_dest and first_leg_origin == second_leg_dest:
                trip_type = "round_trip"
            else:
                trip_type = "multi_city"
        else:
            trip_type = "one_way"

        # Find a user to associate with (use first available user for API tickets)
        user = User.query.first()
        if not user:
            return jsonify({"error": "No users found in system"}), 400

        passenger_count = len(passengers) or 1
        consolidated_fare = journey.get("consolidated_fare") if isinstance(journey, dict) else None
        if not isinstance(consolidated_fare, dict):
            duplicated_consolidated_candidate = None
            duplicated_rows = []
            for passenger in passengers:
                fare = passenger.get("fare") or {}
                duplicated_rows.append({
                    "base_fare": _round_money(parseFloat(fare.get("base_fare", 0))),
                    "k3_gst": _round_money(parseFloat(fare.get("k3_gst", 0))),
                    "other_taxes": _round_money(parseFloat(fare.get("other_taxes", 0))),
                    "total_fare": _round_money(parseFloat(fare.get("total_fare", 0))),
                })
            non_zero_rows = [
                row for row in duplicated_rows
                if row["base_fare"] or row["k3_gst"] or row["other_taxes"] or row["total_fare"]
            ]
            if len(non_zero_rows) > 1:
                first_row = non_zero_rows[0]
                all_identical = all(row == first_row for row in non_zero_rows[1:])
                if all_identical:
                    duplicated_consolidated_candidate = {
                        "base_fare": first_row["base_fare"],
                        "k3_gst": first_row["k3_gst"],
                        "other_taxes": first_row["other_taxes"],
                    }
            if duplicated_consolidated_candidate:
                journey["consolidated_fare"] = duplicated_consolidated_candidate
                consolidated_fare = duplicated_consolidated_candidate

        consolidated_components_total = 0.0
        if isinstance(consolidated_fare, dict):
            consolidated_components_total = (
                parseFloat(consolidated_fare.get("base_fare", 0)) +
                parseFloat(consolidated_fare.get("k3_gst", 0)) +
                parseFloat(consolidated_fare.get("other_taxes", 0))
            )

        received_grand_total = parseFloat(booking.get("grand_total", 0))
        if received_grand_total <= 0 and consolidated_components_total > 0:
            received_grand_total = consolidated_components_total + (
                parseFloat(journey.get("global_markup", 0)) * passenger_count
            )

        if received_grand_total > 0:
            final_grand_total = received_grand_total
        else:
            calculated_grand_total = 0
            pax_fares_found = False
            for p in passengers:
                f = p.get("fare") or {}
                total = f.get("total_fare")
                if total:
                    try:
                        calculated_grand_total += float(str(total).replace(',', ''))
                        pax_fares_found = True
                    except ValueError:
                        pass
            final_grand_total = calculated_grand_total if pax_fares_found else 0

        if consolidated_components_total > 0 and final_grand_total > 0:
            inferred_markup_total = max(final_grand_total - consolidated_components_total, 0.0)
            journey["global_markup"] = _round_money(inferred_markup_total / passenger_count) if passenger_count else 0.0

        # Compute uniform class
        uni_c = set()
        for seg in segments:
            bc = seg.get("booking_class")
            v = ""
            if isinstance(bc, dict):
                v = (bc.get("cabin") or bc.get("full_form") or "").strip().lower()
            elif isinstance(bc, str) and bc.strip():
                v = bc.strip().lower()
            if v and v != "n/a":
                uni_c.add(v)
        
        if len(uni_c) > 0:
            # If at least ONE valid inline class is present, we hide universal class
            final_class = "None"
        else:
            # If nothing was found inline (all N/A or empty), default to generic Economy
            final_class = booking.get("class_of_travel", "Economy").title()

        _ensure_passenger_internal_ids(passengers)
        
        # Normalize terminals (strip 'T' or 'Terminal' if it's like T1, Terminal 2) and Airport Codes
        for seg in segments:
            for point_key in ["departure", "arrival"]:
                point = seg.get(point_key)
                if isinstance(point, dict):
                    # Normalize Airport Code to Uppercase
                    if point.get("airport"):
                        point["airport"] = str(point["airport"]).strip().upper()
                        
                    # Normalize Terminal
                    if point.get("terminal"):
                        t_val = str(point["terminal"]).strip()
                        # case-insensitive check for 'Terminal ' or 'T' prefixes followed by digits
                        cleaned_t = t_val
                        if t_val.lower().startswith("terminal "):
                            cleaned_t = t_val[9:].strip()
                        elif t_val.upper().startswith("T") and len(t_val) > 1 and t_val[1:].isdigit():
                            cleaned_t = t_val[1:]
                        
                        if cleaned_t.isdigit():
                            point["terminal"] = cleaned_t

        # Create ticket
        ticket = Ticket(
            pnr=booking.get("pnr"),
            booking_date=booking.get("booking_date"),
            phone=booking.get("phone"),
            currency=booking.get("currency", "INR"),
            grand_total=final_grand_total,
            class_of_travel=final_class,
            trip_type=trip_type,
            passengers_data=json.dumps(passengers),
            segments_data=json.dumps(segments),
            journey_data=json.dumps(journey),
            raw_data=json.dumps(data),
            status="unmatched",
            user_id=user.id,
            parser_version=metadata.get("parser_version")
        )

        # ── Duplicate Detection ────────────────────────────────────────────
        is_duplicate = False
        duplicate_of = None
        new_pnr = (booking.get("pnr") or "").strip().upper()

        if new_pnr:
            new_sectors = []
            for seg in segments:
                dep_ap = (seg.get("departure") or {}).get("airport", "").strip().upper()
                arr_ap = (seg.get("arrival") or {}).get("airport", "").strip().upper()
                if dep_ap and arr_ap:
                    new_sectors.append(f"{dep_ap}-{arr_ap}")
            new_sectors_key = "|".join(new_sectors)

            new_pax_names = sorted([
                _normalize_passenger_name(p.get("name", ""))
                for p in passengers if p.get("name")
            ])
            new_pax_key = "|".join(new_pax_names)

            from sqlalchemy import or_
            existing_tickets = Ticket.query.filter(
                Ticket.pnr == new_pnr,
                Ticket.user_id == user.id,
                or_(Ticket.duplicate_status.is_(None), Ticket.duplicate_status.in_(["approved"])),
            ).order_by(Ticket.created_at.asc()).all()

            for existing in existing_tickets:
                ex_segments = json.loads(existing.segments_data or "[]")
                ex_passengers = json.loads(existing.passengers_data or "[]")

                ex_sectors = []
                for s in ex_segments:
                    dep_ap = (s.get("departure") or {}).get("airport", "").strip().upper()
                    arr_ap = (s.get("arrival") or {}).get("airport", "").strip().upper()
                    if dep_ap and arr_ap:
                        ex_sectors.append(f"{dep_ap}-{arr_ap}")
                ex_sectors_key = "|".join(ex_sectors)

                ex_pax_names = sorted([
                    _normalize_passenger_name(p.get("name", ""))
                    for p in ex_passengers if p.get("name")
                ])
                ex_pax_key = "|".join(ex_pax_names)

                if new_sectors_key and new_sectors_key == ex_sectors_key and new_pax_key == ex_pax_key:
                    is_duplicate = True
                    duplicate_of = existing.id
                    break

        if is_duplicate:
            ticket.duplicate_status = "pending"
            ticket.duplicate_of_id = duplicate_of
            print(f"[DUPLICATE] Ticket quarantined - PNR {new_pnr} is a suspected duplicate of {duplicate_of}")

        # Try to match against issued itineraries
        matched = False
        pnr = booking.get("pnr", "").strip().upper()
        if pnr:
            # Match by PNR in itinerary flights_data
            issued_itineraries = Itinerary.query.filter(
                Itinerary.status.in_(['confirmed', 'issued'])
            ).all()
            for itin in issued_itineraries:
                if itin.flights_data and pnr.lower() in itin.flights_data.lower():
                    ticket.matched_itinerary_id = itin.id
                    ticket.status = "matched"
                    matched = True
                    break

        db.session.add(ticket)
        db.session.commit()
        if processing_batch_id:
            _mark_ticket_processing_received(user.id, processing_batch_id)
        _publish_ticket_dashboard_event(
            user.id,
            event_type="ticket_created",
            ticket_id=ticket.id,
            batch_id=processing_batch_id or None,
        )

        return jsonify({
            "status": "accepted",
            "ticket_id": ticket.id,
            "matched": matched,
            "matched_itinerary_id": ticket.matched_itinerary_id,
            "is_duplicate": is_duplicate,
            "duplicate_of_id": duplicate_of,
            "processing_batch_id": processing_batch_id or None,
        }), 201

    except Exception as e:
        db.session.rollback()
        print(f"Ticket receive error: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"Failed to process ticket: {str(e)}"}), 500


# ==================== TICKETS PAGE ====================


@app.route("/tickets")
@login_required
def tickets_page():
    """Serve the tickets dashboard page"""
    return render_template(
        'tickets.html',
        airline_codes=AIRLINE_CODES,
        airport_codes=AIRPORT_CODES,
        airport_tz_map=AIRPORT_TZ_MAP,
    )


@app.route("/settings")
@login_required
def settings_page():
    """Serve the settings page"""
    user = User.query.get(session['user_id'])
    return render_template('settings.html', user=user)




# ==================== NOTIFICATION PANEL APIs ====================

@app.route("/api/tickets/processing", methods=["POST"])
def notify_ticket_processing():
    """Register a parser-side processing batch before parsed ticket JSONs arrive."""
    auth_header = request.headers.get("Authorization")
    if auth_header != f"Bearer {API_KEY}":
        return jsonify({"error": "Unauthorized"}), 401

    payload = request.get_json() or {}
    try:
        user_id, batch_id = _register_ticket_processing_batch(payload)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    batches = _get_user_ticket_processing_batches(user_id)
    processing_count = sum(int(batch.get("display_count", batch.get("pending_count", 0))) for batch in batches)
    _publish_ticket_dashboard_event(
        user_id,
        event_type="processing_batch_started",
        batch_id=batch_id,
    )
    return jsonify({
        "status": "accepted",
        "user_id": user_id,
        "batch_id": batch_id,
        "processing_count": processing_count,
        "processing_batches": batches,
    }), 202

@app.route("/api/tickets/notifications", methods=["GET"])
@login_required
def get_ticket_notifications():
    """Return notification counts for PNR merge groups and pending duplicates."""
    user_id = session["user_id"]
    return jsonify(_ticket_notifications_payload(user_id))


@app.route("/api/tickets/stream", methods=["GET"])
def tickets_stream():
    """Stream dashboard updates to the browser. Returns 204 if unauthorized to stop SSE retry loops."""
    if "user_id" not in session:
        return "", 204

    user_id = session["user_id"]
    listener = queue.Queue(maxsize=32)
    with _ticket_dashboard_streams_lock:
        _ticket_dashboard_streams.setdefault(user_id, []).append(listener)

    def event_generator():
        initial_payload = {
            "event": "connected",
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "notifications": _ticket_notifications_payload(user_id),
        }
        yield f"data: {json.dumps(initial_payload)}\n\n"
        try:
            while True:
                try:
                    payload = listener.get(timeout=20)
                    yield f"data: {json.dumps(payload)}\n\n"
                except queue.Empty:
                    yield "event: ping\ndata: {}\n\n"
        finally:
            with _ticket_dashboard_streams_lock:
                listeners = _ticket_dashboard_streams.get(user_id) or []
                if listener in listeners:
                    listeners.remove(listener)
                if not listeners and user_id in _ticket_dashboard_streams:
                    _ticket_dashboard_streams.pop(user_id, None)

    response = Response(stream_with_context(event_generator()), mimetype="text/event-stream")
    response.headers["Cache-Control"] = "no-cache"
    response.headers["X-Accel-Buffering"] = "no"
    response.headers["Connection"] = "keep-alive"
    return response


@app.route("/api/tickets/duplicates", methods=["GET"])
@login_required
def get_pending_duplicates():
    """List all pending duplicate tickets with their original ticket info."""
    user_id = session["user_id"]
    query = Ticket.query.filter_by(
        user_id=user_id,
        duplicate_status="pending"
    ).order_by(Ticket.created_at.desc())

    try:
        limit = max(int(request.args.get("limit", 0) or 0), 0)
    except (TypeError, ValueError):
        limit = 0
    try:
        offset = max(int(request.args.get("offset", 0) or 0), 0)
    except (TypeError, ValueError):
        offset = 0

    total_count = query.count()
    pending_query = query.offset(offset)
    if limit:
        pending_query = pending_query.limit(limit)
    pending = pending_query.all()

    result = []
    for dup_ticket in pending:
        dup_data = _ticket_dict_with_children(dup_ticket)
        dup_data["duplicate_status"] = dup_ticket.duplicate_status
        dup_data["duplicate_of_id"] = dup_ticket.duplicate_of_id

        # Include info about the original ticket
        original_summary = None
        if dup_ticket.duplicate_of_id:
            original = Ticket.query.filter_by(id=dup_ticket.duplicate_of_id).first()
            if original:
                orig_passengers = json.loads(original.passengers_data or "[]")
                orig_segments = json.loads(original.segments_data or "[]")
                route_parts = []
                for seg in orig_segments:
                    dep = (seg.get("departure") or {}).get("airport", "")
                    arr = (seg.get("arrival") or {}).get("airport", "")
                    if dep and not route_parts:
                        route_parts.append(dep)
                    if arr:
                        route_parts.append(arr)
                original_summary = {
                    "id": original.id,
                    "pnr": original.pnr,
                    "passenger_names": [p.get("name", "") for p in orig_passengers],
                    "route": " \u2192 ".join(route_parts),
                    "created_at": original.created_at.isoformat(),
                    "grand_total": original.grand_total,
                    "ticket_status": original.ticket_status or "live",
                }

        dup_data["original_ticket"] = original_summary

        # Add route info for the duplicate
        segments = dup_data["segments"]
        route_parts = []
        for seg in segments:
            dep = (seg.get("departure") or {}).get("airport", "")
            arr = (seg.get("arrival") or {}).get("airport", "")
            if dep and not route_parts:
                route_parts.append(dep)
            if arr:
                route_parts.append(arr)
        dup_data["route"] = " \u2192 ".join(route_parts)
        dup_data["passenger_names"] = [p.get("name", "") for p in dup_data["passengers"]]

        result.append(dup_data)

    returned_count = len(result)
    return jsonify({
        "duplicates": result,
        "total_count": total_count,
        "offset": offset,
        "returned_count": returned_count,
        "has_more": (offset + returned_count) < total_count,
    })


@app.route("/api/tickets/<ticket_id>/approve-duplicate", methods=["POST"])
@login_required
def approve_duplicate(ticket_id):
    """Approve a pending duplicate - it will appear on the main dashboard."""
    ticket = Ticket.query.filter_by(id=ticket_id, user_id=session["user_id"]).first()
    if not ticket:
        return jsonify({"error": "Ticket not found"}), 404
    if ticket.duplicate_status != "pending":
        return jsonify({"error": "Ticket is not a pending duplicate"}), 400

    ticket.duplicate_status = "approved"
    db.session.commit()
    _publish_ticket_dashboard_event(
        session["user_id"],
        event_type="duplicate_approved",
        ticket_id=ticket.id,
    )
    return jsonify({"message": "Duplicate approved. Ticket is now on the dashboard.", "ticket_id": ticket.id})


@app.route("/api/tickets/<ticket_id>/reject-duplicate", methods=["POST"])
@login_required
def reject_duplicate(ticket_id):
    """Reject a pending duplicate - it will be hidden permanently."""
    ticket = Ticket.query.filter_by(id=ticket_id, user_id=session["user_id"]).first()
    if not ticket:
        return jsonify({"error": "Ticket not found"}), 404
    if ticket.duplicate_status != "pending":
        return jsonify({"error": "Ticket is not a pending duplicate"}), 400

    ticket.duplicate_status = "rejected"
    db.session.commit()
    _publish_ticket_dashboard_event(
        session["user_id"],
        event_type="duplicate_rejected",
        ticket_id=ticket.id,
    )
    return jsonify({"message": "Duplicate rejected and hidden.", "ticket_id": ticket.id})


@app.route("/api/tickets/merged-history", methods=["GET"])
@login_required
def get_merged_history():
    """Return completed booking groups (merged tickets history)."""
    user_id = session["user_id"]
    groups = BookingGroup.query.filter_by(user_id=user_id, status="merged").order_by(BookingGroup.updated_at.desc()).all()

    result = []
    for bg in groups:
        sorted_tickets = _booking_group_sorted_tickets(bg)
        if not sorted_tickets:
            continue
        lead = sorted_tickets[0]
        merged = _merged_ticket_dict(bg, lead)
        result.append({
            "group_id": bg.id,
            "pnr": bg.pnr,
            "merged_at": bg.updated_at.isoformat() if bg.updated_at else bg.created_at.isoformat(),
            "ticket_count": len(sorted_tickets),
            "passenger_names": merged.get("passenger_names", []),
            "route": merged.get("route", ""),
            "grand_total": merged.get("grand_total", 0),
            "lead_ticket_id": lead.id,
        })

    return jsonify({"merged_groups": result})


# ==================== TICKET CRUD ROUTES ====================

def _ticket_signature(ticket):
    passengers = json.loads(ticket.passengers_data or "[]")
    segments = json.loads(ticket.segments_data or "[]")
    journey = json.loads(ticket.journey_data or "{}")
    legs = _build_legs_from_data(segments, journey)

    route_parts = []
    for leg in legs:
        if not leg:
            continue
        first_seg = segments[leg[0]]
        last_seg = segments[leg[-1]]
        dep_code = (first_seg.get("departure") or {}).get("airport", "")
        arr_code = (last_seg.get("arrival") or {}).get("airport", "")
        if dep_code:
            route_parts.append(dep_code)
        if arr_code:
            route_parts.append(arr_code)

    first_segment = segments[0] if segments else {}
    last_segment = segments[-1] if segments else {}
    signature = {
        "ticket_id": ticket.id,
        "booking_group_id": ticket.booking_group_id,
        "passenger_names": [p.get("name", "") for p in passengers],
        "normalized_passenger_names": [_normalize_passenger_name(p.get("name", "")) for p in passengers],
        "system_ticket_numbers": [p.get("system_ticket_number", "") for p in passengers],
        "airline": " | ".join((seg.get("airline") or "").strip() for seg in segments),
        "route": " -> ".join(route_parts),
        "flight_numbers": " | ".join((seg.get("flight_number") or "").strip() for seg in segments),
        "departure_airport": (first_segment.get("departure") or {}).get("airport", ""),
        "arrival_airport": (last_segment.get("arrival") or {}).get("airport", ""),
        "departure_datetime": f"{(first_segment.get('departure') or {}).get('date', '')} {(first_segment.get('departure') or {}).get('time', '')}".strip(),
        "arrival_datetime": f"{(last_segment.get('arrival') or {}).get('date', '')} {(last_segment.get('arrival') or {}).get('time', '')}".strip(),
        "segments": segments,
        "pnr": ticket.pnr or "",
        "trip_type": ticket.trip_type,
    }
    return signature


def _build_pnr_merge_groups(user_id):
    from sqlalchemy import or_
    tickets = Ticket.query.filter(
        Ticket.user_id == user_id,
        Ticket.pnr.isnot(None),
        Ticket.pnr != "",
        Ticket.booking_group_id.is_(None),
        or_(Ticket.duplicate_status.is_(None), Ticket.duplicate_status == "approved"),
    ).order_by(Ticket.created_at.desc()).all()

    groups = {}
    for ticket in tickets:
        pnr = (ticket.pnr or "").strip().upper()
        if not pnr:
            continue
        groups.setdefault(pnr, []).append(ticket)

    result = []
    compare_fields = [
        "airline", "route", "flight_numbers", "departure_airport",
        "arrival_airport", "departure_datetime", "arrival_datetime"
    ]

    for pnr, pnr_tickets in groups.items():
        if len(pnr_tickets) < 2:
            continue
        merged_ticket_count = 0
        signatures = [_ticket_signature(ticket) for ticket in pnr_tickets]
        latest_activity_dt = max(
            ((ticket.updated_at or ticket.created_at) for ticket in pnr_tickets),
            default=None,
        )
        unique_passengers = sorted({
            passenger_name
            for sig in signatures
            for passenger_name in sig.get("normalized_passenger_names", [])
            if passenger_name
        })
        has_different_passengers = len(unique_passengers) > 1
        duplicate_passenger_names = _find_duplicate_normalized_passenger_names(signatures)
        field_values = {}
        discrepancies = {}
        for field in compare_fields:
            values = sorted({
                _normalize_compare_string(sig.get(field) or "")
                for sig in signatures
            })
            field_values[field] = values
            if len([value for value in values if value]) > 1:
                discrepancies[field] = values
        if duplicate_passenger_names:
            discrepancies["passenger_names"] = duplicate_passenger_names

        result.append({
            "pnr": pnr,
            "ticket_count": len(pnr_tickets),
            "merged_ticket_count": merged_ticket_count,
            "can_auto_merge": has_different_passengers and not discrepancies,
            "has_different_passengers": has_different_passengers,
            "passenger_conflict": (not has_different_passengers) or bool(duplicate_passenger_names),
            "normalized_passengers": unique_passengers,
            "discrepancies": discrepancies,
            "tickets": signatures,
            "latest_activity_at": latest_activity_dt.isoformat() if latest_activity_dt else None,
            "latest_activity_ts": latest_activity_dt.timestamp() if latest_activity_dt else 0,
        })

    return sorted(
        result,
        key=lambda item: (
            -(item.get("latest_activity_ts") or 0),
            item["pnr"],
        ),
    )


@app.route("/api/tickets/pnr-groups", methods=["GET"])
@login_required
def get_pnr_groups():
    return jsonify({"groups": _build_pnr_merge_groups(session["user_id"])})


@app.route("/api/tickets/pnr-groups/<pnr>/merge", methods=["POST"])
@login_required
def merge_pnr_group(pnr):
    data = request.get_json() or {}
    force_merge = bool(data.get("force_merge"))
    requested_ticket_ids = set(data.get("ticket_ids") or [])
    normalized_pnr = (pnr or "").strip().upper()
    groups = _build_pnr_merge_groups(session["user_id"])
    group = next((item for item in groups if item["pnr"] == normalized_pnr), None)
    if not group:
        return jsonify({"error": "PNR group not found"}), 404
    if not group.get("has_different_passengers"):
        return jsonify({"error": "Merge is allowed only when the PNR group contains different passengers."}), 400
    if group["discrepancies"] and not force_merge:
        return jsonify({"error": "Discrepancies detected. Use force merge to continue.", "discrepancies": group["discrepancies"]}), 400

    selected_tickets = Ticket.query.filter_by(user_id=session["user_id"], pnr=normalized_pnr).all()
    if requested_ticket_ids:
        selected_tickets = [ticket for ticket in selected_tickets if ticket.id in requested_ticket_ids]
    if len(selected_tickets) < 2:
        return jsonify({"error": "At least two tickets are required to merge a booking."}), 400

    lead_ticket = selected_tickets[0]
    existing_group = None
    for ticket in selected_tickets:
        if ticket.booking_group_id:
            existing_group = BookingGroup.query.filter_by(id=ticket.booking_group_id, user_id=session["user_id"]).first()
            if existing_group:
                break

    booking_group = existing_group or BookingGroup(
        user_id=session["user_id"],
        pnr=normalized_pnr,
        status="merged",
    )
    booking_group.itinerary_data = json.dumps(_ticket_signature(lead_ticket))
    booking_group.discrepancy_data = json.dumps(group["discrepancies"])
    db.session.add(booking_group)
    db.session.flush()

    for ticket in selected_tickets:
        ticket.booking_group_id = booking_group.id

    db.session.commit()
    _publish_ticket_dashboard_event(
        session["user_id"],
        event_type="booking_group_merged",
        pnr=normalized_pnr,
        booking_group_id=booking_group.id,
    )
    return jsonify({
        "message": f"Merged {len(selected_tickets)} tickets under PNR {normalized_pnr}.",
        "booking_group_id": booking_group.id,
    })


@app.route("/api/tickets/pnr-groups/<pnr>/delete", methods=["POST"])
@login_required
def delete_pnr_group_tickets(pnr):
    data = request.get_json() or {}
    requested_ticket_ids = set(data.get("ticket_ids") or [])
    normalized_pnr = (pnr or "").strip().upper()
    selected_tickets = Ticket.query.filter_by(user_id=session["user_id"], pnr=normalized_pnr).all()
    if requested_ticket_ids:
        selected_tickets = [ticket for ticket in selected_tickets if ticket.id in requested_ticket_ids]
    if not selected_tickets:
        return jsonify({"error": "No tickets selected for deletion."}), 400

    try:
        agg_ids = set()
        deleted_count = 0
        processed_groups = set()
        for ticket in selected_tickets:
            if ticket.booking_group_id and ticket.booking_group_id not in processed_groups:
                processed_groups.add(ticket.booking_group_id)
                group_ids = requested_ticket_ids or {t.id for t in selected_tickets if t.booking_group_id == ticket.booking_group_id}
                group_agg_ids, group_deleted = _delete_booking_group_records(ticket.booking_group, session["user_id"], ticket_ids=group_ids)
                agg_ids.update(group_agg_ids)
                deleted_count += group_deleted
            elif not ticket.booking_group_id:
                agg_ids.update(_delete_ticket_record(ticket, session["user_id"]))
                deleted_count += 1

        db.session.commit()
        for agg_id in agg_ids:
            _recalc_running_balance(agg_id, session["user_id"])
        _publish_ticket_dashboard_event(
            session["user_id"],
            event_type="booking_group_deleted",
            pnr=normalized_pnr,
        )
        return jsonify({"message": f"Deleted {deleted_count} ticket{'' if deleted_count == 1 else 's'} from PNR {normalized_pnr}."})
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": f"Failed to delete selected tickets: {str(e)}"}), 500

@app.route("/api/tickets/list", methods=["GET"])
@login_required
def get_tickets():
    """Get all tickets for the logged-in user"""
    from sqlalchemy import or_
    query = Ticket.query.filter(
        Ticket.user_id == session['user_id'],
        or_(Ticket.duplicate_status.is_(None), Ticket.duplicate_status == 'approved'),
    ).order_by(Ticket.created_at.desc())

    try:
        limit = max(int(request.args.get("limit", 0) or 0), 0)
    except (TypeError, ValueError):
        limit = 0
    try:
        offset = max(int(request.args.get("offset", 0) or 0), 0)
    except (TypeError, ValueError):
        offset = 0

    total_count = query.count()
    tickets_query = query.offset(offset)
    if limit:
        tickets_query = tickets_query.limit(limit)
    tickets = tickets_query.all()
    
    result = []
    seen_booking_groups = set()
    for t in tickets:
        if t.booking_group_id:
            if t.booking_group_id in seen_booking_groups:
                continue
            seen_booking_groups.add(t.booking_group_id)
            grouped_tickets = _booking_group_sorted_tickets(t.booking_group)
            lead_ticket = grouped_tickets[0] if grouped_tickets else t
            payload = _merged_ticket_dict(t.booking_group, lead_ticket)
        else:
            payload = _ticket_dict_with_children(t)
        passengers = payload["passengers"]
        segments = payload["segments"]
        journey = payload["journey"]
        
        # Group segments into logical legs (handling layovers)
        legs = _build_legs_from_data(segments, journey)
        
        # Build route info from legs
        route_parts = []
        for leg_indices in legs:
            if not leg_indices:
                continue
            first_seg = segments[leg_indices[0]]
            last_seg = segments[leg_indices[-1]]
            dep_code = first_seg.get("departure", {}).get("airport", "")
            arr_code = last_seg.get("arrival", {}).get("airport", "")
            if dep_code and not route_parts:
                route_parts.append(dep_code)
            if arr_code:
                route_parts.append(arr_code)
        
        payload.update({
            "legs": legs,
            "route": " → ".join(route_parts) if route_parts else "",
            "passenger_names": [p.get("name", "") for p in passengers],
        })
        result.append(payload)
    
    returned_count = len(result)
    return jsonify({
        "tickets": result,
        "total_count": total_count,
        "offset": offset,
        "returned_count": returned_count,
        "has_more": (offset + returned_count) < total_count,
    })





@app.route("/api/user/profile", methods=["POST"])
@login_required
def update_profile():
    """Update user profile information"""
    user = User.query.get(session['user_id'])
    data = request.get_json()
    
    if 'full_name' in data:
        user.full_name = data['full_name']
    if 'email' in data:
        user.email = data['email']
        
    db.session.commit()
    return jsonify({"message": "Profile updated successfully"})



@app.route("/api/user/password", methods=["POST"])
@login_required
def update_password():
    """Update user password"""
    user = User.query.get(session['user_id'])
    data = request.get_json()
    
    current_pass = data.get('current_password')
    new_pass = data.get('new_password')
    
    if not current_pass or not new_pass:
        return jsonify({"error": "Missing password fields"}), 400
        
    if not user.check_password(current_pass):
        return jsonify({"error": "Incorrect current password"}), 401
        
    user.set_password(new_pass)
    db.session.commit()
    return jsonify({"message": "Password updated successfully"})


@app.route("/api/user/delete", methods=["DELETE"])
@login_required
def delete_account():
    """Permanently delete user account and all data"""
    user = User.query.get(session['user_id'])
    
    # Optional: Delete associated data if cascade isn't fully covering everything
    # But User model has cascade='all, delete-orphan' for itineraries
    # Tickets and other models should also be cleaned up
    Ticket.query.filter_by(user_id=user.id).delete()
    Aggregator.query.filter_by(user_id=user.id).delete()
    LedgerEntry.query.filter_by(user_id=user.id).delete()
    
    db.session.delete(user)
    db.session.commit()
    session.clear()
    return jsonify({"message": "Account deleted successfully"})


@app.route("/api/tickets/<ticket_id>", methods=["GET"])
@login_required
def get_ticket(ticket_id):
    """Get a specific ticket with full data"""
    ticket = Ticket.query.filter_by(id=ticket_id, user_id=session['user_id']).first()
    if not ticket:
        return jsonify({"error": "Ticket not found"}), 404
    
    passengers = json.loads(ticket.passengers_data) if ticket.passengers_data else []
    if _ensure_passenger_internal_ids(passengers):
        ticket.passengers_data = json.dumps(passengers)
        db.session.commit()

    # Auto-map to ledger if PNR exists there but hash is missing
    if not ticket.ledger_hash and ticket.pnr:
        existing = LedgerEntry.query.filter_by(pnr=ticket.pnr, user_id=session['user_id']).first()
        if existing:
            # We use a special marker to indicate it was mapped via PNR
            ticket.ledger_hash = f"MAPPED_{existing.id}"
            db.session.commit()

    if ticket.booking_group_id and ticket.booking_group:
        grouped_tickets = _booking_group_sorted_tickets(ticket.booking_group)
        lead_ticket = grouped_tickets[0] if grouped_tickets else ticket
        return jsonify(_merged_ticket_dict(ticket.booking_group, lead_ticket))

    return jsonify(_ticket_dict_with_children(ticket))


@app.route("/api/tickets/<ticket_id>", methods=["PUT"])
@login_required
def update_ticket(ticket_id):
    """Update a ticket (edit passengers, segments, fares, etc.)"""
    try:
        ticket = Ticket.query.filter_by(id=ticket_id, user_id=session['user_id']).first()
        if not ticket:
            return jsonify({"error": "Ticket not found"}), 404
        
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return jsonify({"error": "Invalid ticket update payload"}), 400
        base_snapshot = data.get("_edit_base_snapshot") or {}
        if isinstance(base_snapshot.get("segments"), list):
            base_snapshot["segments"] = _sanitize_segments_for_storage(base_snapshot.get("segments"))
        if data.get("is_merged_view") and ticket.booking_group_id and ticket.booking_group:
            grouped_tickets = _booking_group_sorted_tickets(ticket.booking_group)
            passengers_by_ticket = {}
            if 'passengers' in data:
                for passenger in data.get('passengers') or []:
                    source_ticket_id = passenger.get("source_ticket_id") or ticket.id
                    passenger_copy = _clone_json(passenger)
                    passenger_copy.pop("source_ticket_id", None)
                    passengers_by_ticket.setdefault(source_ticket_id, []).append(passenger_copy)

            for grouped_ticket in grouped_tickets:
                if 'pnr' in data:
                    grouped_ticket.pnr = data['pnr']
                if 'booking_date' in data:
                    grouped_ticket.booking_date = data['booking_date']
                if 'phone' in data:
                    grouped_ticket.phone = data['phone']
                if 'currency' in data:
                    grouped_ticket.currency = data['currency']
                if 'class_of_travel' in data:
                    grouped_ticket.class_of_travel = data['class_of_travel']
                if 'trip_type' in data:
                    grouped_ticket.trip_type = data['trip_type']
                if 'segments' in data:
                    grouped_ticket.segments_data = json.dumps(_sanitize_segments_for_storage(data['segments']))
                if 'raw_data' in data:
                    grouped_ticket.raw_data = json.dumps(data['raw_data'])
                if 'status' in data:
                    grouped_ticket.status = data['status']

                grouped_passengers = passengers_by_ticket.get(grouped_ticket.id)
                if grouped_passengers is not None:
                    _ensure_passenger_internal_ids(grouped_passengers)
                    grouped_ticket.passengers_data = json.dumps(grouped_passengers)
                else:
                    grouped_passengers = json.loads(grouped_ticket.passengers_data or "[]")
                    _ensure_passenger_internal_ids(grouped_passengers)
                    grouped_ticket.passengers_data = json.dumps(grouped_passengers)

                if 'journey' in data:
                    grouped_journey = _clone_json(data['journey'] or {})
                    base_total = 0.0
                    k3_total = 0.0
                    other_total = 0.0
                    for passenger in grouped_passengers:
                        fare = passenger.get("fare") or {}
                        base_total += parseFloat(fare.get("base_fare", 0))
                        k3_total += parseFloat(fare.get("k3_gst", 0))
                        other_total += parseFloat(fare.get("other_taxes", 0))
                    grouped_journey["consolidated_fare"] = {
                        "base_fare": _round_money(base_total),
                        "k3_gst": _round_money(k3_total),
                        "other_taxes": _round_money(other_total),
                    }
                    grouped_ticket.journey_data = json.dumps(grouped_journey)
                else:
                    grouped_journey = json.loads(grouped_ticket.journey_data or "{}")

                grouped_ticket.grand_total = _ticket_financials(grouped_passengers, grouped_journey)["total"]
                grouped_ticket.updated_at = datetime.utcnow()

            db.session.commit()
            _publish_ticket_dashboard_event(
                session["user_id"],
                event_type="ticket_updated",
                ticket_id=ticket.id,
                booking_group_id=ticket.booking_group_id,
            )
            return jsonify({"message": "Merged booking updated successfully"})

        current_snapshot = _ticket_dict_with_children(ticket)
        current_snapshot["segments"] = _sanitize_segments_for_storage(current_snapshot.get("segments", []))

        if 'pnr' in data:
            ticket.pnr = _merge_concurrent_value(current_snapshot.get('pnr'), base_snapshot.get('pnr', _MISSING), data['pnr'])
        if 'booking_date' in data:
            ticket.booking_date = _merge_concurrent_value(current_snapshot.get('booking_date'), base_snapshot.get('booking_date', _MISSING), data['booking_date'])
        if 'phone' in data:
            ticket.phone = _merge_concurrent_value(current_snapshot.get('phone'), base_snapshot.get('phone', _MISSING), data['phone'])
        if 'currency' in data:
            ticket.currency = _merge_concurrent_value(current_snapshot.get('currency'), base_snapshot.get('currency', _MISSING), data['currency'])
        if 'grand_total' in data:
            ticket.grand_total = _merge_concurrent_value(current_snapshot.get('grand_total'), base_snapshot.get('grand_total', _MISSING), data['grand_total'])
        if 'class_of_travel' in data:
            ticket.class_of_travel = _merge_concurrent_value(current_snapshot.get('class_of_travel'), base_snapshot.get('class_of_travel', _MISSING), data['class_of_travel'])
        if 'trip_type' in data:
            ticket.trip_type = _merge_concurrent_value(current_snapshot.get('trip_type'), base_snapshot.get('trip_type', _MISSING), data['trip_type'])
        if 'passengers' in data:
            passengers = _merge_concurrent_value(current_snapshot.get('passengers', []), base_snapshot.get('passengers', _MISSING), data['passengers'])
            _ensure_passenger_internal_ids(passengers)
            ticket.passengers_data = json.dumps(passengers)
        if 'segments' in data:
            # Segment edits come from a full in-place editor payload, so store the
            # submitted segment list exactly instead of recursively merging stale keys.
            ticket.segments_data = json.dumps(_sanitize_segments_for_storage(data['segments']))
        if 'journey' in data:
            # Journey totals/legs are recalculated client-side from the edited segments
            # and should stay aligned with the submitted segment payload.
            ticket.journey_data = json.dumps(_clone_json(data['journey'] or {}))
        if 'raw_data' in data:
            raw_data = _merge_concurrent_value(current_snapshot.get('raw_data', {}), base_snapshot.get('raw_data', _MISSING), data['raw_data'])
            ticket.raw_data = json.dumps(raw_data)
        if 'status' in data:
            ticket.status = _merge_concurrent_value(current_snapshot.get('status'), base_snapshot.get('status', _MISSING), data['status'])
        
        ticket.updated_at = datetime.utcnow()
        db.session.commit()
        _publish_ticket_dashboard_event(
            session["user_id"],
            event_type="ticket_updated",
            ticket_id=ticket.id,
        )
        
        return jsonify({
            "message": "Ticket updated successfully",
            "ticket": _ticket_dict_with_children(ticket),
        })
    
    except Exception as e:
        db.session.rollback()
        print(f"Ticket update error: {str(e)}")
        return jsonify({"error": f"Failed to update ticket: {str(e)}"}), 500


@app.route("/api/tickets/<ticket_id>", methods=["DELETE"])
@login_required
def delete_ticket(ticket_id):
    """Delete a ticket"""
    try:
        ticket = Ticket.query.filter_by(id=ticket_id, user_id=session['user_id']).first()
        if not ticket:
            return jsonify({"error": "Ticket not found"}), 404

        if ticket.booking_group_id and ticket.booking_group:
            agg_ids, deleted_count = _delete_booking_group_records(ticket.booking_group, session['user_id'])
            message = f"Merged booking deleted successfully ({deleted_count} tickets removed)"
        else:
            agg_ids = _delete_ticket_record(ticket, session['user_id'])
            message = "Ticket deleted successfully"
        db.session.commit()
        for agg_id in agg_ids:
            _recalc_running_balance(agg_id, session['user_id'])
        _publish_ticket_dashboard_event(
            session["user_id"],
            event_type="ticket_deleted",
            ticket_id=ticket_id,
        )
        return jsonify({"message": message})
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": f"Failed to delete ticket: {str(e)}"}), 500


@app.route("/api/tickets/<ticket_id>/pdf", methods=["GET", "POST"])
@login_required
def generate_ticket_pdf(ticket_id):
    """Generate PDF for a ticket (with or without fare)"""
    ticket = Ticket.query.filter_by(id=ticket_id, user_id=session['user_id']).first()
    if not ticket:
        return jsonify({"error": "Ticket not found"}), 404
    
    snapshot = _ticket_pdf_snapshot_from_request(ticket)
    include_fare = (
        str(snapshot["include_fare"]).lower() == "true"
        if snapshot["include_fare"] is not None
        else request.args.get('include_fare', 'true').lower() == 'true'
    )
    passenger_sort = snapshot["passenger_sort"] or request.args.get('passenger_sort', '')

    passengers = snapshot["passengers"] if snapshot["passengers"] is not None else (json.loads(ticket.passengers_data) if ticket.passengers_data else [])
    segments = snapshot["segments"] if snapshot["segments"] is not None else (json.loads(ticket.segments_data) if ticket.segments_data else [])
    journey = snapshot["journey"] if snapshot["journey"] is not None else (json.loads(ticket.journey_data) if ticket.journey_data else {})
    raw = snapshot["raw_data"] if snapshot["raw_data"] is not None else (json.loads(ticket.raw_data) if ticket.raw_data else {})
    grand_total = snapshot["grand_total"]

    # If this is a merged booking and no editor snapshot was posted, combine passengers from all tickets in the group
    if ticket.booking_group_id and ticket.booking_group and snapshot["passengers"] is None:
        merged_passengers = []
        merged_total = 0.0
        for grouped_ticket in _booking_group_sorted_tickets(ticket.booking_group):
            merged_total += parseFloat(grouped_ticket.grand_total or 0)
            ticket_passengers = json.loads(grouped_ticket.passengers_data or "[]")
            _ensure_passenger_internal_ids(ticket_passengers)
            for p in ticket_passengers:
                p_copy = _clone_json(p)
                p_copy["source_ticket_id"] = grouped_ticket.id
                merged_passengers.append(p_copy)
        passengers = merged_passengers
        grand_total = _round_money(merged_total)

    segments = _segments_with_barcodes(ticket, passengers, segments, raw)
    gst_details = raw.get("gst_details") or {}
    passengers = _sort_passengers_for_pdf(passengers, passenger_sort)

    # Build data dict for PDF generator
    pdf_data = {
        "booking_date": snapshot["booking_date"],
        "phone": snapshot["phone"],
        "pnr": snapshot["pnr"],
        "currency": snapshot["currency"],
        "grand_total": grand_total,
        "class_of_travel": snapshot["class_of_travel"],
        "passengers": passengers,
        "segments": segments,
        "journey": journey,
        "reference_number": raw.get("booking", {}).get("reference_number"),
        "gst_company_name": gst_details.get("company_name"),
        "gst_number": gst_details.get("gst_number"),
        "trip_type": snapshot["trip_type"],
    }
    
    import io
    from reportlab.pdfgen import canvas as pdf_canvas
    from reportlab.lib.pagesizes import A4
    from ticket_pdf import draw_ticket
    
    buffer = io.BytesIO()
    c = pdf_canvas.Canvas(buffer, pagesize=A4)
    draw_ticket(c, pdf_data, include_fare=include_fare)
    c.save()
    buffer.seek(0)
    
    # ── GENERATE DOWNLOAD FILENAME ──
    pax_name = ""
    if passengers and len(passengers) > 0:
        pax_name = passengers[0].get("name", "").strip()
        if len(passengers) > 1:
            pax_name += f" x{len(passengers)}"
    if not pax_name:
        pax_name = "Passenger"
        
    date_str = ""
    if segments and len(segments) > 0:
        dep = segments[0].get("departure", {})
        o_date = dep.get("date", "")
        try:
            import dateutil.parser
            d_obj = dateutil.parser.parse(o_date)
            d_short = d_obj.strftime("%d %b %y")
            if d_short.startswith("0"): 
                d_short = d_short[1:]
            date_str = d_short
        except Exception:
            date_str = o_date.replace("/", "-").replace("\\", "-")
        
    route_str = ""
    trip = (ticket.trip_type or "one_way").lower()
    trip_txt = "ONE WAY"
    if trip == "round_trip": trip_txt = "ROUND TRIP"
    elif trip == "multi_city": trip_txt = "MULTI CITY"
    
    if segments and len(segments) > 0:
        if trip == "one_way":
            dap = segments[0].get("departure", {}).get("airport", "DEP")
            aap = segments[-1].get("arrival", {}).get("airport", "ARR")
            route_str = f"{dap} → {aap}"
        elif trip == "round_trip":
            # For round trip, take the departure and the midpoint destination 
            dap = segments[0].get("departure", {}).get("airport", "DEP")
            mid_idx = max(0, len(segments) // 2 - 1) if len(segments) % 2 == 0 else len(segments) // 2
            aap = segments[mid_idx].get("arrival", {}).get("airport", "ARR")
            route_str = f"{dap} ↔ {aap}"
        else:
            # Multi city
            dests = [segments[0].get("departure", {}).get("airport", "DEP")]
            for seg in segments:
                arr = seg.get("arrival", {}).get("airport", "ARR")
                if arr and arr != dests[-1]:
                    dests.append(arr)
            route_str = " → ".join(dests)
            
    import re
    # Combine filename
    if trip == "one_way":
        raw_fname = f"{pax_name} {route_str} {date_str}.pdf"
    else:
        raw_fname = f"{pax_name} {route_str} ({trip_txt}) {date_str}.pdf"
        
    # Remove windows invalid path chars, though arrows → ↔ are valid unicode
    filename = re.sub(r'[\\/*?:"<>|]', "", raw_fname).strip()
    filename = re.sub(r'\s+', " ", filename)  # remove double spaces just in case
    if not filename.endswith(".pdf"): 
        filename += ".pdf"
    
    return send_file(
        buffer,
        mimetype='application/pdf',
        as_attachment=True,
        download_name=filename
    )



@app.route("/api/tickets/<ticket_id>/pdf/selected", methods=["GET", "POST"])
@login_required
def generate_selected_passenger_pdf(ticket_id):
    """Generate PDF for selected passengers - individual or combined."""
    ticket = Ticket.query.filter_by(id=ticket_id, user_id=session['user_id']).first()
    if not ticket:
        return jsonify({"error": "Ticket not found"}), 404

    snapshot = _ticket_pdf_snapshot_from_request(ticket)
    include_fare = (
        str(snapshot["include_fare"]).lower() == "true"
        if snapshot["include_fare"] is not None
        else request.args.get('include_fare', 'true').lower() == 'true'
    )
    mode = snapshot["mode"] or request.args.get('mode', 'together')  # 'individual' or 'together'
    passenger_sort = snapshot["passenger_sort"] or request.args.get('passenger_sort', '')
    if isinstance(snapshot["passenger_indices"], list):
        pax_indices = [int(i) for i in snapshot["passenger_indices"] if str(i).lstrip('-').isdigit()]
    else:
        pax_indices = request.args.getlist('passenger_indices', type=int)

    if not pax_indices:
        return jsonify({"error": "No passenger indices provided"}), 400

    passengers = snapshot["passengers"] if snapshot["passengers"] is not None else (json.loads(ticket.passengers_data) if ticket.passengers_data else [])
    segments = snapshot["segments"] if snapshot["segments"] is not None else (json.loads(ticket.segments_data) if ticket.segments_data else [])
    journey = snapshot["journey"] if snapshot["journey"] is not None else (json.loads(ticket.journey_data) if ticket.journey_data else {})
    raw = snapshot["raw_data"] if snapshot["raw_data"] is not None else (json.loads(ticket.raw_data) if ticket.raw_data else {})

    # If this is a merged booking and no editor snapshot was posted, combine passengers from all tickets in the group
    if ticket.booking_group_id and ticket.booking_group and snapshot["passengers"] is None:
        merged_passengers = []
        for grouped_ticket in _booking_group_sorted_tickets(ticket.booking_group):
            ticket_passengers = json.loads(grouped_ticket.passengers_data or "[]")
            _ensure_passenger_internal_ids(ticket_passengers)
            for p in ticket_passengers:
                p_copy = _clone_json(p)
                p_copy["source_ticket_id"] = grouped_ticket.id
                merged_passengers.append(p_copy)
        passengers = merged_passengers

    segments = _segments_with_barcodes(ticket, passengers, segments, raw)
    gst_details = raw.get("gst_details") or {}

    # Validate indices
    valid_indices = [i for i in pax_indices if 0 <= i < len(passengers)]
    if not valid_indices:
        return jsonify({"error": "No valid passenger indices"}), 400

    selected_passengers = [passengers[i] for i in valid_indices]
    selected_passengers = _sort_passengers_for_pdf(selected_passengers, passenger_sort)

    # Recalculate fare for selected passengers if consolidated
    selected_journey = json.loads(json.dumps(journey))  # deep copy
    fare_display = selected_journey.get("fare_display")
    if not fare_display:
        fare_display = "per_passenger" if len(passengers) <= 1 else "consolidated"

    if fare_display == "consolidated" and len(valid_indices) < len(passengers):
        # Switch to per_passenger view for partial selection
        selected_journey["fare_display"] = "per_passenger"

    # Compute grand total for selected passengers
    global_markup = 0
    try:
        global_markup = float(selected_journey.get("global_markup") or 0)
    except (ValueError, TypeError):
        pass

    grand_total = 0
    for p in selected_passengers:
        f = p.get("fare") or {}
        grand_total += (float(f.get("base_fare") or 0) +
                        float(f.get("k3_gst") or 0) +
                        float(f.get("other_taxes") or 0) +
                        global_markup)

    import io as _io
    from reportlab.pdfgen import canvas as pdf_canvas
    from reportlab.lib.pagesizes import A4
    from ticket_pdf import draw_ticket

    if mode == 'individual':
        # Generate single PDF for one passenger
        pax = selected_passengers[0]
        pdf_data = {
            "booking_date": snapshot["booking_date"],
            "phone": snapshot["phone"],
            "pnr": snapshot["pnr"],
            "currency": snapshot["currency"],
            "grand_total": grand_total,
            "class_of_travel": snapshot["class_of_travel"],
            "passengers": [pax],
            "segments": segments,
            "journey": selected_journey,
            "reference_number": raw.get("booking", {}).get("reference_number"),
            "gst_company_name": gst_details.get("company_name"),
            "gst_number": gst_details.get("gst_number"),
            "trip_type": snapshot["trip_type"],
        }

        buffer = _io.BytesIO()
        c = pdf_canvas.Canvas(buffer, pagesize=A4)
        draw_ticket(c, pdf_data, include_fare=include_fare)
        c.save()
        buffer.seek(0)

        pax_name = (pax.get("name") or "Passenger").strip()
        filename = _build_pdf_filename(pax_name, ticket, segments)

        return send_file(
            buffer,
            mimetype='application/pdf',
            as_attachment=True,
            download_name=filename
        )
    else:
        # 'together' mode – single PDF with all selected passengers
        pdf_data = {
            "booking_date": snapshot["booking_date"],
            "phone": snapshot["phone"],
            "pnr": snapshot["pnr"],
            "currency": snapshot["currency"],
            "grand_total": grand_total,
            "class_of_travel": snapshot["class_of_travel"],
            "passengers": selected_passengers,
            "segments": segments,
            "journey": selected_journey,
            "reference_number": raw.get("booking", {}).get("reference_number"),
            "gst_company_name": gst_details.get("company_name"),
            "gst_number": gst_details.get("gst_number"),
            "trip_type": snapshot["trip_type"],
        }

        buffer = _io.BytesIO()
        c = pdf_canvas.Canvas(buffer, pagesize=A4)
        draw_ticket(c, pdf_data, include_fare=include_fare)
        c.save()
        buffer.seek(0)

        if len(selected_passengers) == 1:
            pax_name = (selected_passengers[0].get("name") or "Passenger").strip()
        else:
            pax_name = (selected_passengers[0].get("name") or "Passenger").strip()
            pax_name += f" x{len(selected_passengers)}"
        filename = _build_pdf_filename(pax_name, ticket, segments)

        return send_file(
            buffer,
            mimetype='application/pdf',
            as_attachment=True,
            download_name=filename
        )


def _build_pdf_filename(pax_name, ticket, segments):
    """Build a descriptive PDF download filename."""
    import re as _re

    date_str = ""
    if segments and len(segments) > 0:
        dep = segments[0].get("departure", {})
        o_date = dep.get("date", "")
        try:
            import dateutil.parser
            d_obj = dateutil.parser.parse(o_date)
            d_short = d_obj.strftime("%d %b %y")
            if d_short.startswith("0"):
                d_short = d_short[1:]
            date_str = d_short
        except Exception:
            date_str = o_date.replace("/", "-").replace("\\", "-")

    route_str = ""
    trip = (ticket.trip_type or "one_way").lower()
    trip_txt = "ONE WAY"
    if trip == "round_trip": trip_txt = "ROUND TRIP"
    elif trip == "multi_city": trip_txt = "MULTI CITY"

    if segments and len(segments) > 0:
        if trip == "one_way":
            dap = segments[0].get("departure", {}).get("airport", "DEP")
            aap = segments[-1].get("arrival", {}).get("airport", "ARR")
            route_str = f"{dap} → {aap}"
        elif trip == "round_trip":
            dap = segments[0].get("departure", {}).get("airport", "DEP")
            mid_idx = max(0, len(segments) // 2 - 1) if len(segments) % 2 == 0 else len(segments) // 2
            aap = segments[mid_idx].get("arrival", {}).get("airport", "ARR")
            route_str = f"{dap} ↔ {aap}"
        else:
            dests = [segments[0].get("departure", {}).get("airport", "DEP")]
            for seg in segments:
                arr = seg.get("arrival", {}).get("airport", "ARR")
                if arr and arr != dests[-1]:
                    dests.append(arr)
            route_str = " → ".join(dests)

    if trip == "one_way":
        raw_fname = f"{pax_name} {route_str} {date_str}.pdf"
    else:
        raw_fname = f"{pax_name} {route_str} ({trip_txt}) {date_str}.pdf"

    filename = _re.sub(r'[\\/*?:"<>|]', "", raw_fname).strip()
    filename = _re.sub(r'\s+', " ", filename)
    if not filename.endswith(".pdf"):
        filename += ".pdf"
    return filename


def _ticket_pdf_snapshot_from_request(ticket):
    payload = request.get_json(silent=True) if request.method != "GET" else None
    if not isinstance(payload, dict):
        payload = {}
    return {
        "booking_date": payload.get("booking_date", ticket.booking_date),
        "phone": payload.get("phone", ticket.phone),
        "pnr": payload.get("pnr", ticket.pnr),
        "currency": payload.get("currency", ticket.currency),
        "grand_total": payload.get("grand_total", ticket.grand_total),
        "class_of_travel": payload.get("class_of_travel", ticket.class_of_travel),
        "trip_type": payload.get("trip_type", ticket.trip_type),
        "passengers": _clone_json(payload.get("passengers")) if isinstance(payload.get("passengers"), list) else None,
        "segments": _sanitize_segments_for_storage(payload.get("segments")) if isinstance(payload.get("segments"), list) else None,
        "journey": _clone_json(payload.get("journey")) if isinstance(payload.get("journey"), dict) else None,
        "raw_data": _clone_json(payload.get("raw_data")) if isinstance(payload.get("raw_data"), dict) else None,
        "is_merged_view": bool(payload.get("is_merged_view")),
        "mode": payload.get("mode"),
        "passenger_indices": payload.get("passenger_indices"),
        "include_fare": payload.get("include_fare"),
        "passenger_sort": payload.get("passenger_sort"),
    }


def _normalize_passenger_sort_value(value):
    return (str(value or "").strip()).lower()


def _sort_passengers_for_pdf(passengers, sort_mode):
    mode = (sort_mode or "").strip().lower()
    if mode not in {"name", "ticket_number"}:
        return list(passengers or [])
    key_name = "ticket_number" if mode == "ticket_number" else "name"
    return sorted(
        list(passengers or []),
        key=lambda passenger: _normalize_passenger_sort_value(passenger.get(key_name))
    )


# ==================== TICKET CANCEL / SPLIT / CHANGE ROUTES ====================

def _compute_fare_hash(pnr, basic, k3, other_taxes, mu, ticket_total):
    """Compute a deterministic hash from fare data to detect duplicates."""
    fare_hash_data = f"{pnr}:{basic}:{k3}:{other_taxes}:{mu}:{ticket_total}"
    return hashlib.sha256(fare_hash_data.encode()).hexdigest()

def _next_ledger_order(agg_id, user_id):
    last = LedgerEntry.query.filter_by(
        aggregator_id=agg_id, user_id=user_id
    ).order_by(LedgerEntry.row_order.desc()).first()
    return (last.row_order + 1) if last else 0


@app.route("/api/tickets/<ticket_id>/cancel", methods=["POST"])
@login_required
def cancel_ticket(ticket_id):
    try:
        data = request.get_json() or {}
        ticket = Ticket.query.filter_by(id=ticket_id, user_id=session['user_id']).first()
        if not ticket:
            return jsonify({"error": "Ticket not found"}), 404
        if not ticket.ledger_hash:
            return jsonify({"error": "This booking has not been added to the ledger yet. Please add it to the ledger first before cancelling."}), 400

        plan = _build_operation_plan(ticket, data, "cancel")
        operation, created_tickets = _execute_operation(ticket, plan, "cancel")
        return jsonify({
            "message": "Cancellation completed successfully.",
            "operation_id": operation.id,
            "ticket_status": "cancelled" if plan["scenario"] == "full" else "live",
            "created_ticket_ids": [item.id for item in created_tickets],
        }), 200
    except ValueError as exc:
        db.session.rollback()
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        db.session.rollback()
        return jsonify({"error": f"Cancellation failed: {str(exc)}"}), 500


@app.route("/api/tickets/<ticket_id>/change", methods=["POST"])
@login_required
def change_ticket(ticket_id):
    try:
        data = request.get_json() or {}
        ticket = Ticket.query.filter_by(id=ticket_id, user_id=session['user_id']).first()
        if not ticket:
            return jsonify({"error": "Ticket not found"}), 404
        if not ticket.ledger_hash:
            return jsonify({"error": "This booking has not been added to the ledger yet. Please add it to the ledger first before changing."}), 400

        plan = _build_operation_plan(ticket, data, "change")
        operation, created_tickets = _execute_operation(ticket, plan, "change")
        return jsonify({
            "message": "Change completed successfully.",
            "operation_id": operation.id,
            "ticket_status": "changed",
            "created_ticket_ids": [item.id for item in created_tickets],
        }), 200
    except ValueError as exc:
        db.session.rollback()
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        db.session.rollback()
        return jsonify({"error": f"Change failed: {str(exc)}"}), 500


def _scale_components(components, ratio):
    return {
        "base": _round_money(parseFloat(components["base"]) * ratio),
        "k3": _round_money(parseFloat(components["k3"]) * ratio),
        "other": _round_money(parseFloat(components["other"]) * ratio),
        "mu": _round_money(parseFloat(components["mu"]) * ratio),
        "total": _round_money(parseFloat(components["total"]) * ratio),
        "non_markup_total": _round_money(parseFloat(components["non_markup_total"]) * ratio),
    }


def _subtract_components(left, right):
    base = _round_money(parseFloat(left["base"]) - parseFloat(right["base"]))
    k3 = _round_money(parseFloat(left["k3"]) - parseFloat(right["k3"]))
    other = _round_money(parseFloat(left["other"]) - parseFloat(right["other"]))
    mu = _round_money(parseFloat(left["mu"]) - parseFloat(right["mu"]))
    return {
        "base": base,
        "k3": k3,
        "other": other,
        "mu": mu,
        "total": _round_money(base + k3 + other + mu),
        "non_markup_total": _round_money(base + k3 + other),
    }


def _operation_entry_type(action_type, scenario):
    mapping = {
        ("cancel", "full"): "Full Cancel",
        ("cancel", "passenger"): "Passenger Cancel",
        ("cancel", "sector"): "Sector Cancel",
        ("cancel", "passenger_sector"): "Passenger + Sector Cancel",
        ("change", "full"): "Full Change",
        ("change", "passenger"): "Passenger Change",
        ("change", "sector"): "Sector Change",
        ("change", "passenger_sector"): "Passenger + Sector Change",
    }
    return mapping[(action_type, scenario)]


def _default_child_pnr(base_pnr, suffix):
    base = (base_pnr or "NO-PNR").strip().upper() or "NO-PNR"
    return f"{base}-{suffix}"


def _build_operation_plan(ticket, data, action_type):
    passengers = json.loads(ticket.passengers_data or "[]")
    segments = json.loads(ticket.segments_data or "[]")
    journey = json.loads(ticket.journey_data or "{}")
    raw_data = json.loads(ticket.raw_data or "{}")
    _ensure_passenger_internal_ids(passengers)

    source_ticket = {
        "id": ticket.id,
        "pnr": ticket.pnr,
        "booking_date": ticket.booking_date,
        "phone": ticket.phone,
        "currency": ticket.currency,
        "grand_total": ticket.grand_total,
        "class_of_travel": ticket.class_of_travel,
        "trip_type": ticket.trip_type,
        "status": ticket.status,
        "matched_itinerary_id": ticket.matched_itinerary_id,
        "parser_version": ticket.parser_version,
        "last_aggregator": ticket.last_aggregator or data.get("aggregator_id"),
        "last_booked_by": ticket.last_booked_by or data.get("booking_by") or "AB",
        "journey": journey,
        "raw_data": raw_data,
    }

    legs = _build_legs_from_data(segments, journey)
    passenger_indices = _normalize_selection(data.get("passenger_indices"), len(passengers))
    sector_indices = _normalize_selection(data.get("sector_indices"), len(legs))
    if not sector_indices:
        sector_indices = list(range(len(legs)))

    all_passengers = len(passenger_indices) == len(passengers)
    all_sectors = len(sector_indices) == len(legs)
    if all_passengers and all_sectors:
        scenario = "full"
    elif not all_passengers and all_sectors:
        scenario = "passenger"
    elif all_passengers and not all_sectors:
        scenario = "sector"
    else:
        scenario = "passenger_sector"

    if scenario in ("sector", "passenger_sector") and not data.get("sector_fares"):
        raise ValueError("Sector-wise fare breakup is required for sector-based cancel/change operations.")

    attachment_token = (data.get("attachment_token") or "").strip()
    if action_type == "change" and not attachment_token:
        raise ValueError("Upload the new ticket before confirming the change.")

    financials = _ticket_financials(passengers, journey)
    passenger_shares = _passenger_share_map(passengers, journey, data.get("per_person_fares"))
    selected_passenger_components = _sum_components([passenger_shares[idx] for idx in passenger_indices])
    sector_map = _sector_fare_map(sector_indices, data.get("sector_fares"))
    sector_components = {
        "base": _round_money(sum(item["base"] for item in sector_map.values())),
        "k3": _round_money(sum(item["k3"] for item in sector_map.values())),
        "other": _round_money(sum(item["other"] for item in sector_map.values())),
    }
    sector_components["non_markup_total"] = _round_money(sector_components["base"] + sector_components["k3"] + sector_components["other"])
    sector_ratio = _component_ratio(sector_components["non_markup_total"], financials["non_markup_total"]) if scenario in ("sector", "passenger_sector") else 1.0

    if scenario == "full":
        affected_components = financials
    elif scenario == "passenger":
        affected_components = selected_passenger_components
    elif scenario == "sector":
        affected_components = {
            "base": sector_components["base"],
            "k3": sector_components["k3"],
            "other": sector_components["other"],
            "mu": _round_money(financials["mu"] * sector_ratio),
            "total": 0.0,
            "non_markup_total": sector_components["non_markup_total"],
        }
        affected_components["total"] = _round_money(affected_components["base"] + affected_components["k3"] + affected_components["other"] + affected_components["mu"])
    else:
        affected_components = {
            "base": _round_money(selected_passenger_components["base"] * sector_ratio),
            "k3": _round_money(selected_passenger_components["k3"] * sector_ratio),
            "other": _round_money(selected_passenger_components["other"] * sector_ratio),
            "mu": _round_money(selected_passenger_components["mu"] * sector_ratio),
            "total": 0.0,
            "non_markup_total": 0.0,
        }
        affected_components["non_markup_total"] = _round_money(affected_components["base"] + affected_components["k3"] + affected_components["other"])
        affected_components["total"] = _round_money(affected_components["non_markup_total"] + affected_components["mu"])

    fee = _round_money(data.get("cancellation_charge", 0) if action_type == "cancel" else data.get("xxd_charge", 0))
    extra_fare = data.get("extra_fare") or {}
    extra_components = {
        "base": _round_money(extra_fare.get("base_fare", 0)),
        "k3": _round_money(extra_fare.get("k3_gst", 0)),
        "other": _round_money(extra_fare.get("other_taxes", 0)),
        "mu": 0.0,
        "total": 0.0,
        "non_markup_total": 0.0,
    }
    extra_components["non_markup_total"] = _round_money(extra_components["base"] + extra_components["k3"] + extra_components["other"])
    extra_components["total"] = extra_components["non_markup_total"]

    selected_passengers = [_clone_json(passengers[idx]) for idx in passenger_indices]
    remaining_passengers = [_clone_json(passengers[idx]) for idx in range(len(passengers)) if idx not in passenger_indices]
    full_leg_structure = [list(leg) for leg in legs]
    selected_segments = _slice_segments(segments, legs, sector_indices)
    remaining_sector_indices = [idx for idx in range(len(legs)) if idx not in sector_indices]
    remaining_segments = _slice_segments(segments, legs, remaining_sector_indices)
    full_segments_bundle = {"segments": segments, "legs": full_leg_structure}

    new_pnr = (data.get("new_pnr") or "").strip().upper()
    ticket_updates = []
    ticket_creates = []

    if action_type == "cancel":
        if scenario == "full":
            payload = _ticket_payload_from_parts(source_ticket, passengers, full_segments_bundle["segments"], financials, "cancelled", pnr=ticket.pnr, parent_ticket_id=ticket.parent_ticket_id, status_note="Full cancellation processed", cancellation_charge=fee, leg_structure=full_segments_bundle["legs"])
            ticket_updates.append({"ticket_id": ticket.id, "label": "Original booking", "payload": payload})
        elif scenario == "passenger":
            remaining_components = _subtract_components(financials, selected_passenger_components)
            root_payload = _ticket_payload_from_parts(source_ticket, remaining_passengers, full_segments_bundle["segments"], remaining_components, "live", pnr=ticket.pnr, parent_ticket_id=ticket.parent_ticket_id, status_note="Remaining passengers after passenger cancellation", leg_structure=full_segments_bundle["legs"])
            cancel_payload = _ticket_payload_from_parts(source_ticket, selected_passengers, full_segments_bundle["segments"], selected_passenger_components, "cancelled", pnr=new_pnr or _default_child_pnr(ticket.pnr, "CXL"), parent_ticket_id=ticket.id, status_note="Cancelled passenger split", cancellation_charge=fee, leg_structure=full_segments_bundle["legs"])
            ticket_updates.append({"ticket_id": ticket.id, "label": "Live booking", "payload": root_payload})
            ticket_creates.append({"label": "Cancelled booking", "payload": cancel_payload})
        elif scenario == "sector":
            remaining_components = _subtract_components(financials, affected_components)
            root_payload = _ticket_payload_from_parts(source_ticket, passengers, remaining_segments["segments"], remaining_components, "live", pnr=ticket.pnr, parent_ticket_id=ticket.parent_ticket_id, status_note="Live booking after sector cancellation", leg_structure=remaining_segments["legs"])
            cancel_payload = _ticket_payload_from_parts(source_ticket, passengers, selected_segments["segments"], affected_components, "cancelled", pnr=new_pnr or _default_child_pnr(ticket.pnr, "SCXL"), parent_ticket_id=ticket.id, status_note="Cancelled sector split", cancellation_charge=fee, leg_structure=selected_segments["legs"])
            ticket_updates.append({"ticket_id": ticket.id, "label": "Live booking", "payload": root_payload})
            ticket_creates.append({"label": "Cancelled sector booking", "payload": cancel_payload})
        else:
            unaffected_components = _subtract_components(financials, selected_passenger_components)
            live_selected_components = _subtract_components(selected_passenger_components, affected_components)
            root_payload = _ticket_payload_from_parts(source_ticket, remaining_passengers, full_segments_bundle["segments"], unaffected_components, "live", pnr=ticket.pnr, parent_ticket_id=ticket.parent_ticket_id, status_note="Remaining passengers after passenger + sector cancellation", leg_structure=full_segments_bundle["legs"])
            live_split_payload = _ticket_payload_from_parts(source_ticket, selected_passengers, remaining_segments["segments"], live_selected_components, "live", pnr=_default_child_pnr(ticket.pnr, "LIVE"), parent_ticket_id=ticket.id, status_note="Live split for remaining sectors", leg_structure=remaining_segments["legs"])
            cancel_payload = _ticket_payload_from_parts(source_ticket, selected_passengers, selected_segments["segments"], affected_components, "cancelled", pnr=new_pnr or _default_child_pnr(ticket.pnr, "PSCXL"), parent_ticket_id=ticket.id, status_note="Cancelled passenger + sector split", cancellation_charge=fee, leg_structure=selected_segments["legs"])
            ticket_updates.append({"ticket_id": ticket.id, "label": "Remaining passengers booking", "payload": root_payload})
            ticket_creates.append({"label": "Live split booking", "payload": live_split_payload})
            ticket_creates.append({"label": "Cancelled split booking", "payload": cancel_payload})
    else:
        if scenario == "full":
            changed_total = {
                "base": _round_money(financials["base"] + extra_components["base"]),
                "k3": _round_money(financials["k3"] + extra_components["k3"]),
                "other": _round_money(financials["other"] + extra_components["other"]),
                "mu": financials["mu"],
                "total": 0.0,
                "non_markup_total": 0.0,
            }
            changed_total["non_markup_total"] = _round_money(changed_total["base"] + changed_total["k3"] + changed_total["other"])
            changed_total["total"] = _round_money(changed_total["non_markup_total"] + changed_total["mu"])
            payload = _ticket_payload_from_parts(source_ticket, passengers, full_segments_bundle["segments"], changed_total, "changed", pnr=new_pnr or ticket.pnr, parent_ticket_id=ticket.parent_ticket_id, status_note="Full ticket change confirmed", leg_structure=full_segments_bundle["legs"])
            ticket_updates.append({"ticket_id": ticket.id, "label": "Changed booking", "payload": payload})
        elif scenario == "passenger":
            remaining_components = _subtract_components(financials, selected_passenger_components)
            changed_components = {
                "base": _round_money(selected_passenger_components["base"] + extra_components["base"]),
                "k3": _round_money(selected_passenger_components["k3"] + extra_components["k3"]),
                "other": _round_money(selected_passenger_components["other"] + extra_components["other"]),
                "mu": selected_passenger_components["mu"],
                "total": 0.0,
                "non_markup_total": 0.0,
            }
            changed_components["non_markup_total"] = _round_money(changed_components["base"] + changed_components["k3"] + changed_components["other"])
            changed_components["total"] = _round_money(changed_components["non_markup_total"] + changed_components["mu"])
            root_payload = _ticket_payload_from_parts(source_ticket, remaining_passengers, full_segments_bundle["segments"], remaining_components, "live", pnr=ticket.pnr, parent_ticket_id=ticket.parent_ticket_id, status_note="Remaining passengers after passenger change", leg_structure=full_segments_bundle["legs"])
            changed_payload = _ticket_payload_from_parts(source_ticket, selected_passengers, full_segments_bundle["segments"], changed_components, "changed", pnr=new_pnr or _default_child_pnr(ticket.pnr, "PCHG"), parent_ticket_id=ticket.id, status_note="Changed passenger split", leg_structure=full_segments_bundle["legs"])
            ticket_updates.append({"ticket_id": ticket.id, "label": "Live booking", "payload": root_payload})
            ticket_creates.append({"label": "Changed booking", "payload": changed_payload})
        elif scenario == "sector":
            remaining_components = _subtract_components(financials, affected_components)
            changed_components = {
                "base": _round_money(affected_components["base"] + extra_components["base"]),
                "k3": _round_money(affected_components["k3"] + extra_components["k3"]),
                "other": _round_money(affected_components["other"] + extra_components["other"]),
                "mu": affected_components["mu"],
                "total": 0.0,
                "non_markup_total": 0.0,
            }
            changed_components["non_markup_total"] = _round_money(changed_components["base"] + changed_components["k3"] + changed_components["other"])
            changed_components["total"] = _round_money(changed_components["non_markup_total"] + changed_components["mu"])
            root_payload = _ticket_payload_from_parts(source_ticket, passengers, remaining_segments["segments"], remaining_components, "live", pnr=ticket.pnr, parent_ticket_id=ticket.parent_ticket_id, status_note="Remaining sectors after sector change", leg_structure=remaining_segments["legs"])
            changed_payload = _ticket_payload_from_parts(source_ticket, passengers, selected_segments["segments"], changed_components, "changed", pnr=new_pnr or _default_child_pnr(ticket.pnr, "SCHG"), parent_ticket_id=ticket.id, status_note="Changed sector split", leg_structure=selected_segments["legs"])
            ticket_updates.append({"ticket_id": ticket.id, "label": "Live booking", "payload": root_payload})
            ticket_creates.append({"label": "Changed sector booking", "payload": changed_payload})
        else:
            unaffected_components = _subtract_components(financials, selected_passenger_components)
            live_selected_components = _subtract_components(selected_passenger_components, affected_components)
            changed_components = {
                "base": _round_money(affected_components["base"] + extra_components["base"]),
                "k3": _round_money(affected_components["k3"] + extra_components["k3"]),
                "other": _round_money(affected_components["other"] + extra_components["other"]),
                "mu": affected_components["mu"],
                "total": 0.0,
                "non_markup_total": 0.0,
            }
            changed_components["non_markup_total"] = _round_money(changed_components["base"] + changed_components["k3"] + changed_components["other"])
            changed_components["total"] = _round_money(changed_components["non_markup_total"] + changed_components["mu"])
            root_payload = _ticket_payload_from_parts(source_ticket, remaining_passengers, full_segments_bundle["segments"], unaffected_components, "live", pnr=ticket.pnr, parent_ticket_id=ticket.parent_ticket_id, status_note="Remaining passengers after passenger + sector change", leg_structure=full_segments_bundle["legs"])
            live_split_payload = _ticket_payload_from_parts(source_ticket, selected_passengers, remaining_segments["segments"], live_selected_components, "live", pnr=_default_child_pnr(ticket.pnr, "LIVE"), parent_ticket_id=ticket.id, status_note="Live split for remaining sectors", leg_structure=remaining_segments["legs"])
            changed_payload = _ticket_payload_from_parts(source_ticket, selected_passengers, selected_segments["segments"], changed_components, "changed", pnr=new_pnr or _default_child_pnr(ticket.pnr, "PSCHG"), parent_ticket_id=ticket.id, status_note="Changed passenger + sector split", leg_structure=selected_segments["legs"])
            ticket_updates.append({"ticket_id": ticket.id, "label": "Remaining passengers booking", "payload": root_payload})
            ticket_creates.append({"label": "Live split booking", "payload": live_split_payload})
            ticket_creates.append({"label": "Changed split booking", "payload": changed_payload})

    selected_routes = []
    for leg_idx in sector_indices:
        segment_group = legs[leg_idx]
        first_seg = segments[segment_group[0]]
        last_seg = segments[segment_group[-1]]
        selected_routes.append(f"{(first_seg.get('departure') or {}).get('airport', '---')} → {(last_seg.get('arrival') or {}).get('airport', '---')}")

    summary = {
        "action_type": action_type,
        "scenario": scenario,
        "affected_passengers": [{"name": passengers[idx].get("name", f"Passenger {idx + 1}"), "system_ticket_number": passengers[idx].get("system_ticket_number")} for idx in passenger_indices],
        "affected_sectors": selected_routes,
        "affected_fare": affected_components,
        "fees": {"operation_fee": fee, "extra_fare": extra_components},
        "financial_impact": {
            "refund_amount": _round_money(affected_components["total"] - fee) if action_type == "cancel" else 0,
            "additional_collection": _round_money(extra_components["total"] + fee) if action_type == "change" else 0,
        },
        "resulting_bookings": [{
            "label": item["label"],
            "pnr": item["payload"]["pnr"],
            "ticket_status": item["payload"]["ticket_status"],
            "passenger_count": len(json.loads(item["payload"]["passengers_data"])),
            "sector_count": len(json.loads(item["payload"]["segments_data"])),
            "grand_total": item["payload"]["grand_total"],
        } for item in (ticket_updates + ticket_creates)],
        "new_ticket_required": action_type == "change",
        "attachment_token": attachment_token,
        "remarks": (data.get("remarks") or "").strip(),
    }

    return {
        "summary": summary,
        "ticket_updates": ticket_updates,
        "ticket_creates": ticket_creates,
        "scenario": scenario,
        "agg_id": source_ticket["last_aggregator"],
        "booking_by": source_ticket["last_booked_by"],
        "fee": fee,
        "affected_components": affected_components,
        "extra_components": extra_components,
        "attachment_token": attachment_token,
        "remarks": (data.get("remarks") or "").strip(),
    }


def _execute_operation(ticket, plan, action_type):
    before_state = []
    created_tickets = []
    updated_ticket_ids = []
    root_ticket_id = ticket.id

    for item in plan["ticket_updates"]:
        current = Ticket.query.filter_by(id=item["ticket_id"], user_id=session["user_id"]).first()
        before_state.append(_serialize_ticket_model(current))
        _apply_ticket_payload(current, item["payload"])
        updated_ticket_ids.append(current.id)

    for item in plan["ticket_creates"]:
        new_ticket = Ticket(user_id=session["user_id"])
        _apply_ticket_payload(new_ticket, item["payload"])
        db.session.add(new_ticket)
        db.session.flush()
        created_tickets.append(new_ticket)

    root_after = Ticket.query.filter_by(id=ticket.id, user_id=session["user_id"]).first()
    operation = TicketOperation(
        user_id=session["user_id"],
        action_type=action_type,
        scenario=plan["scenario"],
        aggregator_id=plan["agg_id"],
        preview_data=json.dumps(plan["summary"]),
        before_state=json.dumps(before_state),
        after_state=json.dumps([_serialize_ticket_model(root_after)] + [_serialize_ticket_model(item) for item in created_tickets]),
        metadata_json=json.dumps({
            "created_ticket_ids": [item.id for item in created_tickets],
            "updated_ticket_ids": updated_ticket_ids,
            "attachment_token": plan["attachment_token"],
            "remarks": plan["remarks"],
        }),
    )
    operation.ticket_id = root_ticket_id
    operation.root_ticket_id = root_ticket_id
    db.session.add(operation)
    db.session.flush()

    if plan["agg_id"]:
        order = _next_ledger_order(plan["agg_id"], session["user_id"])
        ledger_ticket_id = created_tickets[-1].id if created_tickets else ticket.id
        pnr = created_tickets[-1].pnr if created_tickets else ticket.pnr
        if action_type == "cancel":
            ledger_components = {
                "base": -plan["affected_components"]["base"],
                "k3": -plan["affected_components"]["k3"],
                "other": -plan["affected_components"]["other"],
                "mu": -plan["affected_components"]["mu"],
            }
            entry = _create_ledger_entry_from_plan(plan["agg_id"], session["user_id"], order, pnr, plan["booking_by"], _operation_entry_type(action_type, plan["scenario"]), ledger_components, plan["fee"], f"Refund processed for {plan['scenario']} cancellation", ledger_ticket_id)
        else:
            entry = _create_ledger_entry_from_plan(plan["agg_id"], session["user_id"], order, pnr, plan["booking_by"], _operation_entry_type(action_type, plan["scenario"]), plan["extra_components"], plan["fee"], f"Change confirmed for {plan['scenario']} scenario", ledger_ticket_id)
        db.session.add(OperationLedgerLink(user_id=session["user_id"], operation_id=operation.id, ledger_entry_id=entry.id))

    db.session.commit()
    if plan["agg_id"]:
        _recalc_running_balance(plan["agg_id"], session["user_id"])
    return operation, created_tickets


@app.route("/api/tickets/<ticket_id>/operations/preview", methods=["POST"])
@login_required
def preview_ticket_operation(ticket_id):
    try:
        data = request.get_json() or {}
        action_type = (data.get("action_type") or "").strip().lower()
        if action_type not in ("cancel", "change"):
            return jsonify({"error": "action_type must be cancel or change"}), 400
        ticket = Ticket.query.filter_by(id=ticket_id, user_id=session['user_id']).first()
        if not ticket:
            return jsonify({"error": "Ticket not found"}), 404
        if not ticket.ledger_hash:
            return jsonify({"error": "Add this booking to the ledger before running cancel/change operations."}), 400
        plan = _build_operation_plan(ticket, data, action_type)
        return jsonify(plan["summary"])
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        db.session.rollback()
        return jsonify({"error": f"Preview failed: {str(exc)}"}), 500


@app.route("/api/tickets/<ticket_id>/change-attachment", methods=["POST"])
@login_required
def upload_change_attachment(ticket_id):
    ticket = Ticket.query.filter_by(id=ticket_id, user_id=session['user_id']).first()
    if not ticket:
        return jsonify({"error": "Ticket not found"}), 404
    uploaded = request.files.get("file")
    if not uploaded or not uploaded.filename:
        return jsonify({"error": "Please upload the new ticket file."}), 400
    filename = secure_filename(uploaded.filename)
    token = f"{ticket_id}-{uuid.uuid4().hex[:8]}-{filename}"
    path = os.path.join(UPLOAD_FOLDER, token)
    uploaded.save(path)
    return jsonify({"attachment_token": token, "filename": filename})


# ==================== DATABASE INITIALIZATION ====================

def init_db():
    """Initialize the database"""
    with app.app_context():
        ensure_schema_compatibility()
        # Also initialize v2 tables
        from extensions_v2 import init_db as init_db_v2
        init_db_v2()
        print("Database initialized successfully!")


with app.app_context():
    ensure_schema_compatibility()

if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000, debug=True)
