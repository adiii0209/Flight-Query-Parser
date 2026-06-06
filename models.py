import json
import uuid
from datetime import datetime
from sqlalchemy import UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.types import JSON, Text, TypeDecorator
from werkzeug.security import generate_password_hash, check_password_hash
from extensions import db

# ==================== MODELS ====================


class CompatJSON(TypeDecorator):
    """Use JSONB on PostgreSQL while keeping SQLite/text compatibility."""

    impl = Text
    cache_ok = True

    def __init__(self, empty_factory=None, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.empty_factory = empty_factory

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(JSONB())
        if dialect.name == "sqlite":
            return dialect.type_descriptor(Text())
        return dialect.type_descriptor(JSON())

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if dialect.name == "postgresql":
            if isinstance(value, str):
                stripped = value.strip()
                if not stripped:
                    return self.empty_factory() if callable(self.empty_factory) else None
                return json.loads(stripped)
            return value
        if isinstance(value, str):
            return value
        return json.dumps(value)

    def process_result_value(self, value, dialect):
        if value is None:
            return self.empty_factory() if callable(self.empty_factory) else None
        if isinstance(value, str):
            stripped = value.strip()
            if not stripped:
                return self.empty_factory() if callable(self.empty_factory) else None
            return json.loads(stripped)
        return value

class User(db.Model):
    id = db.Column(db.String, primary_key=True, default=lambda: str(uuid.uuid4()))
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    full_name = db.Column(db.String(120))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_ticket_seen_at = db.Column(db.DateTime, nullable=True)
    itineraries = db.relationship('Itinerary', backref='user', lazy=True, cascade='all, delete-orphan')

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)
    
    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

class Customer(db.Model):
    id = db.Column(db.String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = db.Column(db.String(120), nullable=False)
    email = db.Column(db.String(120))
    phone = db.Column(db.String(20))
    address = db.Column(db.Text)
    customer_type = db.Column(db.String(20), default='passenger')  # 'passenger' or 'corporate'
    company_name = db.Column(db.String(120))  # For corporate customers
    gst_number = db.Column(db.String(50))  # For corporate customers
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    user_id = db.Column(db.String, db.ForeignKey('user.id'), nullable=False)
    itineraries = db.relationship('Itinerary', backref='customer', lazy=True)

class Itinerary(db.Model):
    id = db.Column(db.String, primary_key=True, default=lambda: str(uuid.uuid4()))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    total_amount = db.Column(db.Float)
    markup = db.Column(db.Integer)
    status = db.Column(db.String(20), default='draft')  # draft, approved, cancelled
    final_text = db.Column(db.Text)
    flights_data = db.Column(CompatJSON(empty_factory=list))
    user_id = db.Column(db.String, db.ForeignKey('user.id'), nullable=False)
    customer_id = db.Column(db.String, db.ForeignKey('customer.id'))
    billing_type = db.Column(db.String(20))  # 'passenger' or 'corporate'
    
    # Billing information
    bill_to_name = db.Column(db.String(120))
    bill_to_email = db.Column(db.String(120))
    bill_to_phone = db.Column(db.String(20))
    bill_to_address = db.Column(db.Text)
    bill_to_company = db.Column(db.String(120))
    bill_to_gst = db.Column(db.String(50))
    hold_deadline = db.Column(db.DateTime, nullable=True)

class Ticket(db.Model):
    id = db.Column(db.String, primary_key=True, default=lambda: str(uuid.uuid4()))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    # Booking info
    pnr = db.Column(db.String(20))
    booking_date = db.Column(db.String(50))
    phone = db.Column(db.String(100))
    currency = db.Column(db.String(10), default='INR')
    grand_total = db.Column(db.Float, default=0)
    class_of_travel = db.Column(db.String(30), default='Economy')
    # Journey info
    trip_type = db.Column(db.String(20), default='one_way')  # one_way, round_trip, multi_city
    # Full JSON data
    passengers_data = db.Column(CompatJSON(empty_factory=list))  # JSON array of passengers
    segments_data = db.Column(CompatJSON(empty_factory=list))    # JSON array of segments
    journey_data = db.Column(CompatJSON(empty_factory=dict))     # JSON journey summary
    raw_data = db.Column(CompatJSON(empty_factory=dict))         # Full raw JSON from parser
    booking_group_id = db.Column(db.String, db.ForeignKey('booking_group.id'), nullable=True)
    # Status & matching
    status = db.Column(db.String(20), default='unmatched')  # unmatched, matched, edited
    matched_itinerary_id = db.Column(db.String, db.ForeignKey('itinerary.id'), nullable=True)
    matched_itinerary = db.relationship('Itinerary', backref='tickets', lazy=True)
    # Owner
    user_id = db.Column(db.String, db.ForeignKey('user.id'), nullable=False)
    # Parser metadata
    parser_version = db.Column(db.String(30))
    # ===== Cancellation & Split Fields =====
    ticket_status = db.Column(db.String(20), default='live')  # live, cancelled, changed
    ledger_hash = db.Column(db.String(64), nullable=True)  # Hash of fare data added to ledger
    parent_ticket_id = db.Column(db.String, db.ForeignKey('ticket.id'), nullable=True) # For split tickets
    cancellation_charge = db.Column(db.Float, default=0)
    last_aggregator = db.Column(db.String(100), nullable=True)
    last_booked_by = db.Column(db.String(100), nullable=True)
    # ===== Duplicate Detection =====
    duplicate_status = db.Column(db.String(20), nullable=True)  # null=normal, 'pending', 'approved', 'rejected'
    duplicate_of_id = db.Column(db.String, nullable=True)  # ID of the original ticket this is a duplicate of

    # Relationship for split tickets
    children = db.relationship('Ticket', backref=db.backref('parent', remote_side='Ticket.id'), lazy=True)


class TicketRead(db.Model):
    __table_args__ = (
        UniqueConstraint('user_id', 'ticket_id', name='uq_ticket_read_user_ticket'),
        db.Index('ix_ticket_read_user_id', 'user_id'),
        db.Index('ix_ticket_read_ticket_id', 'ticket_id'),
    )

    id = db.Column(db.String, primary_key=True, default=lambda: str(uuid.uuid4()))
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    user_id = db.Column(db.String, db.ForeignKey('user.id'), nullable=False)
    ticket_id = db.Column(db.String, db.ForeignKey('ticket.id'), nullable=False)

class Aggregator(db.Model):
    id = db.Column(db.String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = db.Column(db.String(120), nullable=False)  # e.g. Indigo, Riya, TBO, Amadeus
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    user_id = db.Column(db.String, db.ForeignKey('user.id'), nullable=False)
    entries = db.relationship('LedgerEntry', backref='aggregator', lazy=True, cascade='all, delete-orphan',
                              order_by='LedgerEntry.row_order')


class BookingGroup(db.Model):
    id = db.Column(db.String, primary_key=True, default=lambda: str(uuid.uuid4()))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    user_id = db.Column(db.String, db.ForeignKey('user.id'), nullable=False)
    pnr = db.Column(db.String(20), nullable=False)
    status = db.Column(db.String(20), default='merged')
    itinerary_data = db.Column(db.Text)
    discrepancy_data = db.Column(db.Text)
    tickets = db.relationship('Ticket', backref='booking_group', lazy=True)

class LedgerEntry(db.Model):
    id = db.Column(db.String, primary_key=True, default=lambda: str(uuid.uuid4()))
    aggregator_id = db.Column(db.String, db.ForeignKey('aggregator.id'), nullable=False)
    user_id = db.Column(db.String, db.ForeignKey('user.id'), nullable=False)
    row_order = db.Column(db.Integer, default=0)  # for ordering
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    # Ledger columns
    invoice_no = db.Column(db.String(50), default='')
    date = db.Column(db.String(20), default='')
    pnr = db.Column(db.String(20), default='')
    basic = db.Column(db.Float, default=0)
    k3 = db.Column(db.Float, default=0)
    other_taxes = db.Column(db.Float, default=0)
    mu = db.Column(db.Float, default=0)
    xxd = db.Column(db.String(50), default='')
    ticket_total = db.Column(db.Float, default=0)
    aggregator_total = db.Column(db.Float, default=0)
    running_balance = db.Column(db.Float, default=0)
    booking_by = db.Column(db.String(10), default='')
    entry_type = db.Column(db.String(20), default='New')
    billing = db.Column(db.String(120), default='')
    remarks = db.Column(db.Text, default='')
    seat_status = db.Column(db.String(50), default='')
    seat_remarks = db.Column(db.String(200), default='')
    meal_status = db.Column(db.String(50), default='')
    # Link to ticket (optional)
    ticket_id = db.Column(db.String, db.ForeignKey('ticket.id'), nullable=True)


class TicketOperation(db.Model):
    id = db.Column(db.String, primary_key=True, default=lambda: str(uuid.uuid4()))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    user_id = db.Column(db.String, db.ForeignKey('user.id'), nullable=False)
    ticket_id = db.Column(db.String, db.ForeignKey('ticket.id'), nullable=True)
    root_ticket_id = db.Column(db.String, db.ForeignKey('ticket.id'), nullable=False)
    action_type = db.Column(db.String(20), nullable=False)  # cancel, change
    scenario = db.Column(db.String(40), nullable=False)  # full, passenger, sector, passenger_sector
    status = db.Column(db.String(20), default='active')  # active, reversed
    aggregator_id = db.Column(db.String, db.ForeignKey('aggregator.id'), nullable=True)
    preview_data = db.Column(db.Text)   # JSON summary shown to the user
    before_state = db.Column(db.Text)   # JSON snapshot of ticket records before mutation
    after_state = db.Column(db.Text)    # JSON snapshot of ticket records after mutation
    metadata_json = db.Column(db.Text)  # JSON execution metadata including attachment info


class OperationLedgerLink(db.Model):
    id = db.Column(db.String, primary_key=True, default=lambda: str(uuid.uuid4()))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    user_id = db.Column(db.String, db.ForeignKey('user.id'), nullable=False)
    operation_id = db.Column(db.String, db.ForeignKey('ticket_operation.id'), nullable=False)
    ledger_entry_id = db.Column(db.String, db.ForeignKey('ledger_entry.id'), nullable=False)


class OwnershipTrip(db.Model):
    """Production storage for the travel operations ownership dashboard."""
    __tablename__ = "ownership_trip"
    __table_args__ = (
        db.Index("ix_ownership_trip_user_start", "user_id", "start_date"),
        db.Index("ix_ownership_trip_owner", "owner"),
        db.Index("ix_ownership_trip_source_row", "source_row"),
    )
    version = db.Column(db.Integer, nullable=False, default=1)

    id = db.Column(db.String, primary_key=True, default=lambda: str(uuid.uuid4()))
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    user_id = db.Column(db.String, db.ForeignKey("user.id"), nullable=True)
    source_row = db.Column(db.Integer, nullable=True)
    source = db.Column(db.String(80), default="ownership_sheet")

    guest_name = db.Column(db.String(255), nullable=False)
    pax = db.Column(db.Integer, default=1)
    destination = db.Column(db.String(255), default="")
    start_date = db.Column(db.Date, nullable=True)
    end_date = db.Column(db.Date, nullable=True)

    proposal_status = db.Column(db.String(30), default="pending", nullable=False)
    flights_status = db.Column(db.String(30), default="pending", nullable=False)
    visa_status = db.Column(db.String(30), default="pending", nullable=False)
    hotels_status = db.Column(db.String(30), default="pending", nullable=False)
    sector_tickets_status = db.Column(db.String(30), default="pending", nullable=False)
    sightseeing_status = db.Column(db.String(30), default="pending", nullable=False)
    insurance_status = db.Column(db.String(30), default="pending", nullable=False)
    traveling_status = db.Column(db.String(30), default="pending", nullable=False)
    travefy_task_list_status = db.Column(db.String(30), default="pending", nullable=False)
    trip_feedback_form_status = db.Column(db.String(30), default="pending", nullable=False)

    owner = db.Column(db.String(120), default="")
    master_sheet_url = db.Column(db.Text, default="")
    last_status_update_date = db.Column(db.Date, nullable=True)
    latest_update = db.Column(db.Text, default="")
    present_work_assigned_to = db.Column(db.String(120), default="")
    subtasks_json = db.Column(CompatJSON(empty_factory=dict))
    reminders_json = db.Column(CompatJSON(empty_factory=list))
    raw_sheet_data = db.Column(CompatJSON(empty_factory=dict))

    subtasks = db.relationship(
        "OwnershipSubtask",
        backref="trip",
        lazy=True,
        cascade="all, delete-orphan",
        order_by="OwnershipSubtask.row_order",
    )
    reminders = db.relationship(
        "OwnershipReminder",
        backref="trip",
        lazy=True,
        cascade="all, delete-orphan",
        order_by="OwnershipReminder.days_before",
    )

    def to_dict(self, include_legacy_relationships=False, include_raw_sheet_data=False):
        subtask_groups = self.subtasks_json if isinstance(self.subtasks_json, dict) else {
            "proposal": [],
            "visa": [],
            "flights": [],
            "hotels": [],
            "sectorTickets": [],
            "sightseeing": [],
            "insurance": [],
            "travefy": [],
            "travefyTaskList": [],
            "tripFeedbackForm": [],
        }
        if include_legacy_relationships and not any(subtask_groups.values()) and self.subtasks:
            for subtask in self.subtasks or []:
                subtask_groups.setdefault(subtask.task_group, []).append(subtask.to_dict())
        reminders = self.reminders_json if isinstance(self.reminders_json, list) else []
        if include_legacy_relationships and not reminders:
            reminders = [reminder.to_dict() for reminder in self.reminders or []]
        raw_sheet_data = self.raw_sheet_data if include_raw_sheet_data and isinstance(self.raw_sheet_data, dict) else {}

        return {
            "id": self.id,
            "version": self.version or 1,
            "guestName": self.guest_name or "",
            "pax": self.pax or 1,
            "destination": self.destination or "",
            "startDate": self.start_date.isoformat() if self.start_date else "",
            "endDate": self.end_date.isoformat() if self.end_date else "",
            "proposalStatus": self.proposal_status or "pending",
            "flightsStatus": self.flights_status or "pending",
            "visaStatus": self.visa_status or "pending",
            "hotelsStatus": self.hotels_status or "pending",
            "sectorTicketsStatus": self.sector_tickets_status or "pending",
            "sightseeingStatus": self.sightseeing_status or "pending",
            "insuranceStatus": self.insurance_status or "pending",
            "travelingStatus": self.traveling_status or "pending",
            "travefyTaskListStatus": self.travefy_task_list_status or "pending",
            "tripFeedbackFormStatus": self.trip_feedback_form_status or "pending",
            "owner": self.owner or "",
            "masterSheetUrl": self.master_sheet_url or raw_sheet_data.get("masterSheetUrl") or "",
            "lastStatusUpdateDate": self.last_status_update_date.isoformat() if self.last_status_update_date else "",
            "latestUpdate": self.latest_update or "",
            "presentWorkAssignedTo": self.present_work_assigned_to or "",
            "subtasks": subtask_groups,
            "reminders": reminders,
        }


class OwnershipSubtask(db.Model):
    """Individual actionable checklist items under a trip service area."""
    __tablename__ = "ownership_subtask"
    __table_args__ = (
        db.Index("ix_ownership_subtask_trip_group", "trip_id", "task_group"),
        db.Index("ix_ownership_subtask_assignee", "assignee"),
    )

    id = db.Column(db.String, primary_key=True, default=lambda: str(uuid.uuid4()))
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    trip_id = db.Column(db.String, db.ForeignKey("ownership_trip.id"), nullable=False)
    task_group = db.Column(db.String(40), nullable=False)
    row_order = db.Column(db.Integer, default=0)
    text = db.Column(db.Text, nullable=False)
    done = db.Column(db.Boolean, default=False, nullable=False)
    assignee = db.Column(db.String(120), default="")
    due_date = db.Column(db.Date, nullable=True)
    metadata_json = db.Column(CompatJSON(empty_factory=dict))

    def to_dict(self):
        return {
            "id": self.id,
            "text": self.text or "",
            "done": bool(self.done),
            "assignee": self.assignee or "",
            "dueDate": self.due_date.isoformat() if self.due_date else "",
            "createdAt": self.created_at.isoformat() if self.created_at else "",
            "updatedAt": self.updated_at.isoformat() if self.updated_at else "",
            "metadata": self.metadata_json or {},
        }


class OwnershipReminder(db.Model):
    """Reminder offsets attached to an ownership trip."""
    __tablename__ = "ownership_reminder"
    __table_args__ = (
        UniqueConstraint("trip_id", "days_before", name="uq_ownership_reminder_trip_days"),
    )

    id = db.Column(db.String, primary_key=True, default=lambda: str(uuid.uuid4()))
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    trip_id = db.Column(db.String, db.ForeignKey("ownership_trip.id"), nullable=False)
    days_before = db.Column(db.Integer, nullable=False)
    label = db.Column(db.String(120), default="")

    def to_dict(self):
        days = self.days_before or 0
        return {
            "id": self.id,
            "days": days,
            "label": self.label or f"{days} days before",
        }


class OwnershipTaskTemplate(db.Model):
    """Reusable ownership task templates for repeatable trip workflows."""
    __tablename__ = "ownership_task_template"
    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_ownership_template_user_name"),
        db.Index("ix_ownership_template_user", "user_id"),
    )

    id = db.Column(db.String, primary_key=True, default=lambda: str(uuid.uuid4()))
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    user_id = db.Column(db.String, db.ForeignKey("user.id"), nullable=True)
    name = db.Column(db.String(160), nullable=False)
    task_group = db.Column(db.String(40), default="")
    reminder_days = db.Column(db.Integer, nullable=True)
    tasks = db.relationship(
        "OwnershipTaskTemplateItem",
        backref="template",
        lazy=True,
        cascade="all, delete-orphan",
        order_by="OwnershipTaskTemplateItem.row_order",
    )

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "taskGroup": self.task_group or "",
            "reminderDays": self.reminder_days,
            "tasks": [
                {
                    "text": task.text or "",
                    "reminderDays": task.reminder_days,
                }
                for task in self.tasks or []
            ],
        }


class OwnershipTaskTemplateItem(db.Model):
    __tablename__ = "ownership_task_template_item"

    id = db.Column(db.String, primary_key=True, default=lambda: str(uuid.uuid4()))
    template_id = db.Column(db.String, db.ForeignKey("ownership_task_template.id"), nullable=False)
    row_order = db.Column(db.Integer, default=0)
    text = db.Column(db.Text, nullable=False)
    reminder_days = db.Column(db.Integer, nullable=True)


class OwnershipEmployee(db.Model):
    """Assignable team member for ownership work and subtasks."""
    __tablename__ = "ownership_employee"
    __table_args__ = (
        UniqueConstraint("name", name="uq_ownership_employee_name"),
        db.Index("ix_ownership_employee_active", "is_active"),
    )

    id = db.Column(db.String, primary_key=True, default=lambda: str(uuid.uuid4()))
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    name = db.Column(db.String(120), nullable=False)
    color = db.Column(db.String(20), default="")
    is_active = db.Column(db.Boolean, default=True, nullable=False)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "color": self.color or "",
            "isActive": bool(self.is_active),
        }


class FareRule(db.Model):
    """Global fare rules per airline + fare type. Stores baggage, seat, meal, cancellation & change rules."""
    __tablename__ = 'fare_rule'
    __table_args__ = (
        UniqueConstraint('airline_code', 'fare_type', name='uq_fare_rule_airline_fare'),
    )

    id = db.Column(db.String, primary_key=True, default=lambda: str(uuid.uuid4()))
    airline_code = db.Column(db.String(10), nullable=False, index=True)  # e.g. 6E, AI, UK
    airline_name = db.Column(db.String(120), nullable=True)              # e.g. IndiGo, Air India
    fare_type = db.Column(db.String(50), nullable=False, index=True)     # e.g. saver, flexi, corporate
    fare_display_name = db.Column(db.String(100), nullable=True)         # e.g. "Saver Fare", "Flexi Plus"
    # Baggage
    baggage_cabin = db.Column(db.String(50), default='')       # e.g. 7kg
    baggage_checkin = db.Column(db.String(50), default='')     # e.g. 15kg
    baggage_pcs = db.Column(db.String(20), default='')         # e.g. 1pcs
    # Seat & Meal
    seat = db.Column(db.String(100), default='')               # e.g. Chargeable, Included, Free
    meal = db.Column(db.String(100), default='')               # e.g. Chargeable, Complimentary
    # Cancellation & Change
    cancellation_charges = db.Column(db.String(100), default='')  # e.g. 3500, Non-Refundable
    change_penalty = db.Column(db.String(100), default='')        # e.g. 3000, Free
    # Refundability
    refundability = db.Column(db.String(30), default='')          # Refundable / Non-Refundable
    # Notes
    notes = db.Column(db.Text, default='')
    # Timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class HotelBooking(db.Model):
    """Persisted hotel booking extracted from PDF/text."""
    __tablename__ = "hotel_booking"

    id = db.Column(db.String, primary_key=True, default=lambda: str(uuid.uuid4()))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user_id = db.Column(db.String, db.ForeignKey("user.id"), nullable=False)

    # Booking identifiers
    booking_id = db.Column(db.String(50), nullable=True)

    # Hotel details
    hotel_name    = db.Column(db.String(255), nullable=True)
    hotel_address = db.Column(db.Text,        nullable=True)
    hotel_phone   = db.Column(db.String(50),  nullable=True)

    # Guest details
    guest_name = db.Column(db.String(255), nullable=True)
    num_guests = db.Column(db.Integer,     nullable=True)

    # Stay details
    check_in_date  = db.Column(db.String(20), nullable=True)   # YYYY-MM-DD
    check_out_date = db.Column(db.String(20), nullable=True)   # YYYY-MM-DD
    check_in_time  = db.Column(db.String(50), nullable=True)
    check_out_time = db.Column(db.String(50), nullable=True)
    room_type      = db.Column(db.String(100), nullable=True)
    room_count     = db.Column(db.Integer, default=1)
    meal_plan      = db.Column(db.String(100), nullable=True)
    rooms_json     = db.Column(db.Text, default="[]")

    # Amenities stored as JSON array string
    amenities_json = db.Column(db.Text, default="[]")

    # Fare
    total_amount = db.Column(db.Float, nullable=True)
    currency     = db.Column(db.String(32), nullable=True)

    # Misc
    special_instructions = db.Column(db.Text, nullable=True)
    image_url            = db.Column(db.Text, nullable=True)
    raw_text             = db.Column(db.Text, default="")

    def to_dict(self):
        import json as _json
        try:
            amenities = _json.loads(self.amenities_json or "[]")
        except Exception:
            amenities = []
        try:
            rooms = _json.loads(self.rooms_json or "[]")
        except Exception:
            rooms = []
        return {
            "id":                   self.id,
            "created_at":           self.created_at.isoformat() if self.created_at else None,
            "updated_at":           self.updated_at.isoformat() if self.updated_at else None,
            "user_id":              self.user_id,
            "booking_id":           self.booking_id,
            "hotel_name":           self.hotel_name,
            "hotel_address":        self.hotel_address,
            "hotel_phone":          self.hotel_phone,
            "guest_name":           self.guest_name,
            "num_guests":           self.num_guests,
            "check_in_date":        self.check_in_date,
            "check_out_date":       self.check_out_date,
            "check_in_time":        self.check_in_time,
            "check_out_time":       self.check_out_time,
            "booking_confirmation": self.booking_id,
            "room_type":            self.room_type,
            "room_count":           self.room_count,
            "rooms":                rooms,
            "meal_plan":            self.meal_plan,
            "amenities":            amenities,
            "total_amount":         self.total_amount,
            "currency":             self.currency,
            "special_instructions": self.special_instructions,
            "image_url":            self.image_url,
            "raw_text":             self.raw_text,
        }
