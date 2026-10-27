import json
from datetime import datetime

from extensions import db


class HrConfig(db.Model):
    """One row per workspace: company details for the letterhead, titles, and the offer letter and payslip templates (JSON)."""
    __tablename__ = "hr_config"
    id = db.Column(db.Integer, primary_key=True)
    organization_id = db.Column(db.String(36), nullable=False, unique=True, index=True)
    data = db.Column(db.Text, nullable=False, default="{}")
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def load(self):
        try:
            d = json.loads(self.data or "{}")
        except ValueError:
            return {}
        return d if isinstance(d, dict) else {}


class HrEmployee(db.Model):
    __tablename__ = "hr_employee"
    id = db.Column(db.Integer, primary_key=True)
    organization_id = db.Column(db.String(36), nullable=False, index=True)
    emp_code = db.Column(db.String(30), nullable=False, default="")
    full_name = db.Column(db.String(160), nullable=False)
    email = db.Column(db.String(160), nullable=False, default="")
    phone = db.Column(db.String(40), nullable=False, default="")
    address = db.Column(db.Text, nullable=False, default="")
    institute = db.Column(db.String(200), nullable=False, default="")  # college, for interns
    title = db.Column(db.String(60), nullable=False, default="Employee")  # Employee, Intern, ...
    designation = db.Column(db.String(160), nullable=False, default="")
    department = db.Column(db.String(120), nullable=False, default="")
    join_date = db.Column(db.Date, nullable=True)
    end_date = db.Column(db.Date, nullable=True)
    amount = db.Column(db.Float, nullable=False, default=0)  # monthly salary, or stipend for an intern
    pan = db.Column(db.String(20), nullable=False, default="")
    bank_account = db.Column(db.String(60), nullable=False, default="")
    status = db.Column(db.String(20), nullable=False, default="active")  # active, exited
    notes = db.Column(db.Text, nullable=False, default="")
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id, "emp_code": self.emp_code, "full_name": self.full_name, "email": self.email, "phone": self.phone,
            "address": self.address, "institute": self.institute, "title": self.title, "designation": self.designation,
            "department": self.department, "join_date": self.join_date.isoformat() if self.join_date else "",
            "end_date": self.end_date.isoformat() if self.end_date else "", "amount": self.amount, "pan": self.pan,
            "bank_account": self.bank_account, "status": self.status, "notes": self.notes,
        }


class HrDocument(db.Model):
    """An offer letter or a payslip: the full content is kept as it was generated, so later template changes do not rewrite it."""
    __tablename__ = "hr_document"
    id = db.Column(db.Integer, primary_key=True)
    organization_id = db.Column(db.String(36), nullable=False, index=True)
    employee_id = db.Column(db.Integer, nullable=True, index=True)
    kind = db.Column(db.String(20), nullable=False)  # offer, payslip
    title = db.Column(db.String(200), nullable=False, default="")
    data = db.Column(db.Text, nullable=False, default="{}")
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self, full=False):
        out = {"id": self.id, "employee_id": self.employee_id, "kind": self.kind, "title": self.title,
               "created_at": self.created_at.isoformat() + "Z" if self.created_at else None,
               "updated_at": self.updated_at.isoformat() + "Z" if self.updated_at else None}
        try:
            d = json.loads(self.data or "{}")
        except ValueError:
            d = {}
        out["summary"] = d.get("summary", "")
        if full:
            out["data"] = d
        return out
