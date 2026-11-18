"""Developer project cards (projects + checklist tasks) for employee profiles.

Access rules:
  * An AGENCY_EMPLOYEE can only touch projects on their own employee profile.
  * Admin roles (PLATFORM_SUPER_ADMIN, AGENCY_ADMIN, CLIENT_ADMIN) can view and
    edit projects of any employee in their organization.
"""
from datetime import datetime

from flask import Blueprint, jsonify, request, session

from extensions import db
from models import OwnershipEmployee, OwnershipProject, OwnershipProjectTask, User
from routes.auth import login_required

projects_bp = Blueprint("ownership_projects", __name__)

ADMIN_ROLES = {"PLATFORM_SUPER_ADMIN", "AGENCY_ADMIN", "CLIENT_ADMIN"}
PROJECT_STATUSES = {"active", "paused", "done"}


def _can_access_employee(employee):
    """True when the logged-in user may work with this employee profile."""
    if employee is None:
        return False
    role = session.get("role")
    if role == "PLATFORM_SUPER_ADMIN":
        return True
    if employee.organization_id != session.get("organization_id"):
        return False
    if role in ADMIN_ROLES:
        return True
    # Regular employees: only their own profile, matched the same way the
    # employee list endpoint does (linked user id, or matching login email).
    user = db.session.get(User, session.get("user_id"))
    if not user:
        return False
    if employee.user_id and employee.user_id == user.id:
        return True
    return bool(user.email and employee.email and employee.email.lower() == user.email.lower())


def _employee_or_error(employee_id):
    employee = db.session.get(OwnershipEmployee, employee_id)
    if not employee or not employee.is_active:
        return None, (jsonify({"error": "Employee not found"}), 404)
    if not _can_access_employee(employee):
        return None, (jsonify({"error": "Access denied"}), 403)
    return employee, None


def _project_or_error(project_id):
    project = db.session.get(OwnershipProject, project_id)
    if not project:
        return None, (jsonify({"error": "Project not found"}), 404)
    employee = db.session.get(OwnershipEmployee, project.employee_id)
    if not _can_access_employee(employee):
        return None, (jsonify({"error": "Access denied"}), 403)
    return project, None


def _task_or_error(task_id):
    task = db.session.get(OwnershipProjectTask, task_id)
    if not task:
        return None, (jsonify({"error": "Task not found"}), 404)
    _, err = _project_or_error(task.project_id)
    if err:
        return None, err
    return task, None


def _clean(value, limit):
    return str(value or "").strip()[:limit]


@projects_bp.route("/api/ownership/employees/<employee_id>/projects", methods=["GET"])
@login_required
def list_projects(employee_id):
    _, err = _employee_or_error(employee_id)
    if err:
        return err
    projects = (
        OwnershipProject.query.filter_by(employee_id=employee_id)
        .order_by(OwnershipProject.row_order.asc(), OwnershipProject.created_at.asc())
        .all()
    )
    return jsonify({"projects": [p.to_dict() for p in projects]})


@projects_bp.route("/api/ownership/employees/<employee_id>/projects", methods=["POST"])
@login_required
def create_project(employee_id):
    employee, err = _employee_or_error(employee_id)
    if err:
        return err
    payload = request.get_json(silent=True) or {}
    name = _clean(payload.get("name"), 160)
    if not name:
        return jsonify({"error": "Project name is required"}), 400
    last = (
        db.session.query(db.func.max(OwnershipProject.row_order))
        .filter(OwnershipProject.employee_id == employee_id)
        .scalar()
    )
    project = OwnershipProject(
        employee_id=employee_id,
        organization_id=employee.organization_id,
        name=name,
        description=_clean(payload.get("description"), 2000),
        color=_clean(payload.get("color"), 20),
        row_order=(last if last is not None else -1) + 1,
    )
    db.session.add(project)
    db.session.commit()
    return jsonify({"project": project.to_dict()}), 201


@projects_bp.route("/api/ownership/projects/<project_id>", methods=["PATCH"])
@login_required
def update_project(project_id):
    project, err = _project_or_error(project_id)
    if err:
        return err
    payload = request.get_json(silent=True) or {}
    if "name" in payload:
        name = _clean(payload.get("name"), 160)
        if not name:
            return jsonify({"error": "Project name is required"}), 400
        project.name = name
    if "description" in payload:
        project.description = _clean(payload.get("description"), 2000)
    if "color" in payload:
        project.color = _clean(payload.get("color"), 20)
    if "status" in payload:
        status = _clean(payload.get("status"), 20).lower()
        if status not in PROJECT_STATUSES:
            return jsonify({"error": "Invalid status"}), 400
        project.status = status
    db.session.commit()
    return jsonify({"project": project.to_dict()})


@projects_bp.route("/api/ownership/projects/<project_id>", methods=["DELETE"])
@login_required
def delete_project(project_id):
    project, err = _project_or_error(project_id)
    if err:
        return err
    db.session.delete(project)
    db.session.commit()
    return jsonify({"success": True})


@projects_bp.route("/api/ownership/projects/<project_id>/tasks", methods=["POST"])
@login_required
def create_project_task(project_id):
    project, err = _project_or_error(project_id)
    if err:
        return err
    payload = request.get_json(silent=True) or {}
    text = _clean(payload.get("text"), 1000)
    if not text:
        return jsonify({"error": "Task text is required"}), 400
    last = (
        db.session.query(db.func.max(OwnershipProjectTask.row_order))
        .filter(OwnershipProjectTask.project_id == project_id)
        .scalar()
    )
    task = OwnershipProjectTask(
        project_id=project.id,
        text=text,
        row_order=(last if last is not None else -1) + 1,
    )
    db.session.add(task)
    db.session.commit()
    return jsonify({"task": task.to_dict()}), 201


@projects_bp.route("/api/ownership/project-tasks/<task_id>", methods=["PATCH"])
@login_required
def update_project_task(task_id):
    task, err = _task_or_error(task_id)
    if err:
        return err
    payload = request.get_json(silent=True) or {}
    if "text" in payload:
        text = _clean(payload.get("text"), 1000)
        if not text:
            return jsonify({"error": "Task text is required"}), 400
        task.text = text
    if "done" in payload:
        done = bool(payload.get("done"))
        if done != bool(task.done):
            task.done = done
            task.done_at = datetime.utcnow() if done else None
    db.session.commit()
    return jsonify({"task": task.to_dict()})


@projects_bp.route("/api/ownership/project-tasks/<task_id>", methods=["DELETE"])
@login_required
def delete_project_task(task_id):
    task, err = _task_or_error(task_id)
    if err:
        return err
    db.session.delete(task)
    db.session.commit()
    return jsonify({"success": True})


@projects_bp.route("/api/ownership/projects/<project_id>/tasks/reorder", methods=["POST"])
@login_required
def reorder_project_tasks(project_id):
    project, err = _project_or_error(project_id)
    if err:
        return err
    order = (request.get_json(silent=True) or {}).get("order")
    if not isinstance(order, list):
        return jsonify({"error": "order must be a list of task ids"}), 400
    rows = {t.id: t for t in project.tasks}
    for idx, tid in enumerate(order):
        if tid in rows:
            rows[tid].row_order = idx
    db.session.commit()
    return jsonify({"success": True})
