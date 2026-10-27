"""HR and payroll API (admins of a workspace only): employees, offer letters and payslips, and the workspace's letterhead and templates."""
import copy
import json
from datetime import date, datetime

from flask import Blueprint, jsonify, request, session

from extensions import db
from routes.auth import login_required, role_required

from .defaults import DEFAULT_CONFIG
from .models import HrConfig, HrDocument, HrEmployee

hr_bp = Blueprint("hr", __name__, static_folder="static", static_url_path="/hr/static")

ADMIN = ("AGENCY_ADMIN", "CLIENT_ADMIN")
MAX_JSON = 400_000
KINDS = ("offer", "payslip")
_ready = False


@hr_bp.before_request
def _before():
    global _ready
    if not _ready:
        for model in (HrConfig, HrEmployee, HrDocument):
            model.__table__.create(db.engine, checkfirst=True)
        _ready = True


def _org():
    return str(session.get("organization_id") or "")


def _err(msg, code=400):
    return jsonify({"error": msg}), code


def _s(v, n):
    return " ".join(str(v or "").split())[:n]


def _text(v, n):
    return str(v or "").replace("\r", "")[:n]


def _d(v):
    try:
        return datetime.strptime(str(v)[:10], "%Y-%m-%d").date() if v else None
    except ValueError:
        return None


def _config(org):
    row = HrConfig.query.filter_by(organization_id=org).first()
    cfg = copy.deepcopy(DEFAULT_CONFIG)
    if row:
        saved = row.load()
        for k, v in saved.items():
            if k == "offers" and isinstance(v, dict):
                cfg["offers"].update(v)
            else:
                cfg[k] = v
    return cfg


def _check_config(c):
    """The settings arrive from the browser as one JSON object; only the known parts are kept."""
    if not isinstance(c, dict):
        return None
    out = {}
    co = c.get("company") if isinstance(c.get("company"), dict) else {}
    out["company"] = {k: _text(co.get(k), 5000 if k == "logo" else 400) for k in ("name", "short_name", "legal_name", "address", "phone", "email", "logo")}
    if out["company"]["logo"] and not (out["company"]["logo"].startswith(("data:image/", "/", "https://"))):
        out["company"]["logo"] = ""
    if isinstance(co.get("logo"), str) and co["logo"].startswith("data:image/") and len(co["logo"]) <= 400_000:
        out["company"]["logo"] = co["logo"]
    sg = c.get("signatory") if isinstance(c.get("signatory"), dict) else {}
    out["signatory"] = {"name": _s(sg.get("name"), 120), "title": _s(sg.get("title"), 160)}
    titles = []
    for t in (c.get("titles") or [])[:12]:
        if isinstance(t, dict) and _s(t.get("name"), 40):
            titles.append({"name": _s(t.get("name"), 40), "template": _s(t.get("template"), 40) or "employee"})
    out["titles"] = titles or copy.deepcopy(DEFAULT_CONFIG["titles"])
    offers = c.get("offers") if isinstance(c.get("offers"), dict) else {}
    out["offers"] = {}
    for key, tpl in list(offers.items())[:12]:
        if isinstance(tpl, dict) and _s(key, 40):
            out["offers"][_s(key, 40)] = tpl
    ps = c.get("payslip") if isinstance(c.get("payslip"), dict) else {}
    out["payslip"] = {"earnings": [_s(x, 80) for x in (ps.get("earnings") or [])[:20] if _s(x, 80)], "deductions": [_s(x, 80) for x in (ps.get("deductions") or [])[:20] if _s(x, 80)],
                      "footer": _text(ps.get("footer"), 300), "accent": _s(ps.get("accent"), 9) if str(ps.get("accent") or "").startswith("#") else "#16a34a"}
    return out


# ---------------------------------------------------------------- bootstrap + config
@hr_bp.route("/api/hr/bootstrap")
@login_required
@role_required(*ADMIN)
def bootstrap():
    org = _org()
    emps = HrEmployee.query.filter_by(organization_id=org).order_by(HrEmployee.id).all()
    docs = HrDocument.query.filter_by(organization_id=org).order_by(HrDocument.updated_at.desc()).limit(500).all()
    return jsonify({"config": _config(org), "defaults": DEFAULT_CONFIG, "employees": [e.to_dict() for e in emps], "documents": [d.to_dict() for d in docs]})


@hr_bp.route("/api/hr/config", methods=["PUT"])
@login_required
@role_required(*ADMIN)
def save_config():
    body = request.get_json(silent=True) or {}
    cfg = _check_config(body)
    if cfg is None:
        return _err("Invalid settings.")
    raw = json.dumps(cfg)
    if len(raw) > MAX_JSON:
        return _err("Settings are too large (is the logo big?).")
    row = HrConfig.query.filter_by(organization_id=_org()).first()
    if not row:
        row = HrConfig(organization_id=_org())
        db.session.add(row)
    row.data = raw
    db.session.commit()
    return jsonify({"config": _config(_org())})


# ---------------------------------------------------------------- employees
def _apply_employee(e, b):
    e.full_name = _s(b.get("full_name"), 160)
    e.emp_code = _s(b.get("emp_code"), 30)
    e.email, e.phone = _s(b.get("email"), 160), _s(b.get("phone"), 40)
    e.address, e.notes = _text(b.get("address"), 600), _text(b.get("notes"), 1000)
    e.institute, e.title = _s(b.get("institute"), 200), _s(b.get("title"), 60) or "Employee"
    e.designation, e.department = _s(b.get("designation"), 160), _s(b.get("department"), 120)
    e.join_date, e.end_date = _d(b.get("join_date")), _d(b.get("end_date"))
    try:
        e.amount = max(0.0, min(float(b.get("amount") or 0), 10 ** 9))
    except (TypeError, ValueError):
        e.amount = 0
    e.pan, e.bank_account = _s(b.get("pan"), 20).upper(), _s(b.get("bank_account"), 60)
    e.status = "exited" if b.get("status") == "exited" else "active"


def _employee(eid):
    return HrEmployee.query.filter_by(id=eid, organization_id=_org()).first()


@hr_bp.route("/api/hr/employees", methods=["POST"])
@login_required
@role_required(*ADMIN)
def add_employee():
    b = request.get_json(silent=True) or {}
    if not _s(b.get("full_name"), 160):
        return _err("Enter the person's name.")
    e = HrEmployee(organization_id=_org(), full_name="x")
    _apply_employee(e, b)
    if not e.emp_code:  # next number: the largest numeric code in use + 1
        nums = [int(x.emp_code) for x in HrEmployee.query.filter_by(organization_id=_org()).all() if x.emp_code.isdigit()]
        e.emp_code = str(max(nums or [0]) + 1)
    db.session.add(e)
    db.session.commit()
    return jsonify({"employee": e.to_dict()})


@hr_bp.route("/api/hr/employees/<int:eid>", methods=["PUT"])
@login_required
@role_required(*ADMIN)
def save_employee(eid):
    e = _employee(eid)
    if not e:
        return _err("Not found", 404)
    b = request.get_json(silent=True) or {}
    if not _s(b.get("full_name"), 160):
        return _err("Enter the person's name.")
    _apply_employee(e, b)
    db.session.commit()
    return jsonify({"employee": e.to_dict()})


@hr_bp.route("/api/hr/employees/<int:eid>", methods=["DELETE"])
@login_required
@role_required(*ADMIN)
def delete_employee(eid):
    e = _employee(eid)
    if not e:
        return _err("Not found", 404)
    HrDocument.query.filter_by(organization_id=_org(), employee_id=eid).delete()
    db.session.delete(e)
    db.session.commit()
    return jsonify({"ok": True})


# ---------------------------------------------------------------- documents
def _doc(did):
    return HrDocument.query.filter_by(id=did, organization_id=_org()).first()


def _fill_document(d, b):
    kind = b.get("kind")
    data = b.get("data")
    if not isinstance(data, dict):
        return "Missing document content."
    raw = json.dumps(data)
    if len(raw) > MAX_JSON:
        return "The document is too large."
    d.title = _s(b.get("title"), 200)
    d.data = raw
    emp = b.get("employee_id")
    if emp:
        if not _employee(int(emp)):
            return "Unknown employee."
        d.employee_id = int(emp)
    else:
        d.employee_id = None
    return None


@hr_bp.route("/api/hr/documents", methods=["POST"])
@login_required
@role_required(*ADMIN)
def add_document():
    b = request.get_json(silent=True) or {}
    if b.get("kind") not in KINDS:
        return _err("Unknown document type.")
    d = HrDocument(organization_id=_org(), kind=b["kind"])
    msg = _fill_document(d, b)
    if msg:
        return _err(msg)
    db.session.add(d)
    db.session.commit()
    return jsonify({"document": d.to_dict(full=True)})


@hr_bp.route("/api/hr/documents/<int:did>", methods=["GET"])
@login_required
@role_required(*ADMIN)
def get_document(did):
    d = _doc(did)
    return jsonify({"document": d.to_dict(full=True)}) if d else _err("Not found", 404)


@hr_bp.route("/api/hr/documents/<int:did>", methods=["PUT"])
@login_required
@role_required(*ADMIN)
def save_document(did):
    d = _doc(did)
    if not d:
        return _err("Not found", 404)
    msg = _fill_document(d, request.get_json(silent=True) or {})
    if msg:
        return _err(msg)
    db.session.commit()
    return jsonify({"document": d.to_dict(full=True)})


@hr_bp.route("/api/hr/documents/<int:did>", methods=["DELETE"])
@login_required
@role_required(*ADMIN)
def delete_document(did):
    d = _doc(did)
    if not d:
        return _err("Not found", 404)
    db.session.delete(d)
    db.session.commit()
    return jsonify({"ok": True})


@hr_bp.route("/api/hr/documents/docx", methods=["POST"])
@login_required
@role_required(*ADMIN)
def export_docx():
    """The document as it is on screen, as an editable Word file. Takes the content in the body, so unsaved edits are included."""
    import re as _re
    from flask import Response
    from . import docx_export
    data = (request.get_json(silent=True) or {}).get("data")
    if not isinstance(data, dict) or len(json.dumps(data)) > MAX_JSON:
        return _err("Missing or too large document.")
    try:
        body = docx_export.build(data)
    except Exception as exc:  # a malformed document should not crash the page
        return _err(f"Could not build the Word file: {exc}", 400)
    name = _re.sub(r"[^A-Za-z0-9 _.-]+", "", str(data.get("summary") or "document")).strip()[:80] or "document"
    return Response(body, mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    headers={"Content-Disposition": f'attachment; filename="{name}.docx"'})
