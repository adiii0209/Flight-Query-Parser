"""
Travel Agent Flight Booking Platform - SQLAlchemy 2.x Models
Python 3.11+ compatible with proper typing, UUID keys, and bidirectional relationships.
"""

from __future__ import annotations  # Required for Python 3.14 compatibility

import uuid
from datetime import datetime, date
from typing import Optional, List
from werkzeug.security import generate_password_hash, check_password_hash

from sqlalchemy import String, Text, Integer, Float, Boolean, DateTime, Date, ForeignKey, Index, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship, DeclarativeBase


class Base(DeclarativeBase):
    """Base class for all models using SQLAlchemy 2.0 declarative style."""
    pass


# ==================== UTILITY FUNCTIONS ====================

def generate_uuid() -> str:
    """Generate a new UUID string."""
    return str(uuid.uuid4())


# ==================== USER MODEL ====================

class User(Base):
    """Travel agent user who manages corporates, passengers, and itineraries."""
    __tablename__ = "user"
    
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    username: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    
    # Relationships
    corporates: Mapped[List["Corporate"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    passengers: Mapped[List["Passenger"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    itineraries: Mapped[List["Itinerary"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    billing_accounts: Mapped[List["BillingAccount"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    
    def set_password(self, password: str) -> None:
        self.password_hash = generate_password_hash(password)
    
    def check_password(self, password: str) -> bool:
        return check_password_hash(self.password_hash, password)
    
    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "username": self.username,
            "email": self.email,
            "full_name": self.full_name,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "is_active": self.is_active
        }


# ==================== CORPORATE MODEL ====================

class Corporate(Base):
    """Corporate entity with billing and contact details."""
    __tablename__ = "corporates"
    
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    company_name: Mapped[str] = mapped_column(String(200), nullable=False)
    gst_number: Mapped[Optional[str]] = mapped_column(String(20), nullable=True, index=True)
    pan_number: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    
    # Billing Details
    billing_address_line1: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    billing_address_line2: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    billing_city: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    billing_state: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    billing_pincode: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    billing_country: Mapped[Optional[str]] = mapped_column(String(100), default="India")
    
    # Contact Details
    contact_person_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    contact_email: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    contact_phone: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    contact_alternate_phone: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    
    # Internal
    internal_remarks: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    credit_limit: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    payment_terms_days: Mapped[Optional[int]] = mapped_column(Integer, default=30)
    
    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    
    # Foreign Keys
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("user.id"), nullable=False)
    
    # Relationships
    user: Mapped["User"] = relationship(back_populates="corporates")
    passenger_links: Mapped[List["CorporatePassenger"]] = relationship(back_populates="corporate", cascade="all, delete-orphan")
    promo_codes: Mapped[List["CorporateAirlinePromoCode"]] = relationship(back_populates="corporate", cascade="all, delete-orphan")
    itineraries: Mapped[List["Itinerary"]] = relationship(back_populates="corporate")
    
    # Indexes
    __table_args__ = (
        Index("idx_corporate_gst", "gst_number"),
        Index("idx_corporate_user", "user_id"),
        UniqueConstraint("company_name", "user_id", name="uq_corporate_name_user")
    )
    
    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "company_name": self.company_name,
            "gst_number": self.gst_number,
            "pan_number": self.pan_number,
            "billing_address_line1": self.billing_address_line1,
            "billing_address_line2": self.billing_address_line2,
            "billing_city": self.billing_city,
            "billing_state": self.billing_state,
            "billing_pincode": self.billing_pincode,
            "billing_country": self.billing_country,
            "contact_person_name": self.contact_person_name,
            "contact_email": self.contact_email,
            "contact_phone": self.contact_phone,
            "contact_alternate_phone": self.contact_alternate_phone,
            "internal_remarks": self.internal_remarks,
            "credit_limit": self.credit_limit,
            "payment_terms_days": self.payment_terms_days,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "is_active": self.is_active,
            "passengers_count": len(self.passenger_links) if self.passenger_links else 0,
            "promo_codes_count": len(self.promo_codes) if self.promo_codes else 0
        }


# ==================== PASSENGER MODEL ====================

class Passenger(Base):
    """Individual passenger with personal identity details."""
    __tablename__ = "passengers"
    
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    
    # Personal Details
    title: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)  # Mr, Mrs, Ms, Dr
    first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    middle_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    last_name: Mapped[str] = mapped_column(String(100), nullable=False)
    date_of_birth: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    gender: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)  # Male, Female, Other
    nationality: Mapped[Optional[str]] = mapped_column(String(50), default="Indian")
    
    # Contact Details
    email: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    alternate_phone: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    
    # Address
    address_line1: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    address_line2: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    city: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    state: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    pincode: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    country: Mapped[Optional[str]] = mapped_column(String(100), default="India")
    
    # Emergency Contact
    emergency_contact_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    emergency_contact_phone: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    emergency_contact_relationship: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    
    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    
    # Foreign Keys
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("user.id"), nullable=False)
    
    # Relationships
    user: Mapped["User"] = relationship(back_populates="passengers")
    corporate_links: Mapped[List["CorporatePassenger"]] = relationship(back_populates="passenger", cascade="all, delete-orphan")
    frequent_flyer_accounts: Mapped[List["PassengerFrequentFlyer"]] = relationship(back_populates="passenger", cascade="all, delete-orphan")
    preferences: Mapped[Optional["PassengerPreferences"]] = relationship(back_populates="passenger", cascade="all, delete-orphan", uselist=False)
    travel_documents: Mapped[List["PassengerTravelDocument"]] = relationship(back_populates="passenger", cascade="all, delete-orphan")
    itineraries: Mapped[List["Itinerary"]] = relationship(back_populates="passenger")
    
    # Indexes
    __table_args__ = (
        Index("idx_passenger_name", "first_name", "last_name"),
        Index("idx_passenger_user", "user_id"),
        UniqueConstraint("first_name", "last_name", "user_id", "email", "phone", "date_of_birth", name="uq_passenger_identity")
    )
    
    @property
    def full_name(self) -> str:
        parts = [self.title, self.first_name, self.middle_name, self.last_name]
        return " ".join(p for p in parts if p)
    
    def to_dict(self, include_related: bool = False) -> dict:
        data = {
            "id": self.id,
            "title": self.title,
            "first_name": self.first_name,
            "middle_name": self.middle_name,
            "last_name": self.last_name,
            "full_name": self.full_name,
            "date_of_birth": self.date_of_birth.isoformat() if self.date_of_birth else None,
            "gender": self.gender,
            "nationality": self.nationality,
            "email": self.email,
            "phone": self.phone,
            "alternate_phone": self.alternate_phone,
            "address_line1": self.address_line1,
            "address_line2": self.address_line2,
            "city": self.city,
            "state": self.state,
            "pincode": self.pincode,
            "country": self.country,
            "emergency_contact_name": self.emergency_contact_name,
            "emergency_contact_phone": self.emergency_contact_phone,
            "emergency_contact_relationship": self.emergency_contact_relationship,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "is_active": self.is_active
        }
        
        if include_related:
            data["frequent_flyer_accounts"] = [ff.to_dict() for ff in self.frequent_flyer_accounts] if self.frequent_flyer_accounts else []
            data["preferences"] = self.preferences.to_dict() if self.preferences else None
            data["travel_documents"] = [td.to_dict() for td in self.travel_documents] if self.travel_documents else []
            data["corporate_links"] = [cl.to_dict() for cl in self.corporate_links] if self.corporate_links else []
        
        return data


# ==================== AIRLINE MODEL ====================

class Airline(Base):
    """Master airline codes and names."""
    __tablename__ = "airlines"
    
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    iata_code: Mapped[str] = mapped_column(String(3), unique=True, nullable=False, index=True)
    icao_code: Mapped[Optional[str]] = mapped_column(String(4), nullable=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    country: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    logo_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    
    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    
    # Relationships
    promo_codes: Mapped[List["CorporateAirlinePromoCode"]] = relationship(back_populates="airline")
    frequent_flyer_accounts: Mapped[List["PassengerFrequentFlyer"]] = relationship(back_populates="airline")
    
    # Indexes
    __table_args__ = (
        Index("idx_airline_iata", "iata_code"),
    )
    
    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "iata_code": self.iata_code,
            "icao_code": self.icao_code,
            "name": self.name,
            "country": self.country,
            "logo_url": self.logo_url,
            "is_active": self.is_active
        }


# ==================== CORPORATE-PASSENGER RELATIONSHIP ====================

class CorporatePassenger(Base):
    """Links passengers (employees) to corporates with roles and remarks."""
    __tablename__ = "corporate_passengers"
    
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    corporate_id: Mapped[str] = mapped_column(String(36), ForeignKey("corporates.id"), nullable=False)
    passenger_id: Mapped[str] = mapped_column(String(36), ForeignKey("passengers.id"), nullable=False)
    
    # Role and Details
    employee_id: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    role: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)  # Manager, Executive, Director, etc.
    department: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    cost_center: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    remarks: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    # Approval settings
    requires_approval: Mapped[bool] = mapped_column(Boolean, default=False)
    approval_limit: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    
    # Relationships
    corporate: Mapped["Corporate"] = relationship(back_populates="passenger_links")
    passenger: Mapped["Passenger"] = relationship(back_populates="corporate_links")
    
    # Indexes
    __table_args__ = (
        Index("idx_corp_pass_corporate", "corporate_id"),
        Index("idx_corp_pass_passenger", "passenger_id"),
    )
    
    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "corporate_id": self.corporate_id,
            "passenger_id": self.passenger_id,
            "corporate_name": self.corporate.company_name if self.corporate else None,
            "passenger_name": self.passenger.full_name if self.passenger else None,
            "employee_id": self.employee_id,
            "role": self.role,
            "department": self.department,
            "cost_center": self.cost_center,
            "remarks": self.remarks,
            "requires_approval": self.requires_approval,
            "approval_limit": self.approval_limit,
            "is_active": self.is_active
        }


# ==================== CORPORATE AIRLINE PROMO CODE ====================

class CorporateAirlinePromoCode(Base):
    """Airline-specific promo codes for corporates with validity dates."""
    __tablename__ = "corporate_airline_promo_codes"
    
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    corporate_id: Mapped[str] = mapped_column(String(36), ForeignKey("corporates.id"), nullable=False)
    airline_id: Mapped[str] = mapped_column(String(36), ForeignKey("airlines.id"), nullable=False)
    
    promo_code: Mapped[str] = mapped_column(String(50), nullable=False)
    discount_type: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # percentage, fixed
    discount_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    description: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    
    # Validity
    valid_from: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    valid_until: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    
    # Usage limits
    max_uses: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    used_count: Mapped[int] = mapped_column(Integer, default=0)
    
    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    
    # Relationships
    corporate: Mapped["Corporate"] = relationship(back_populates="promo_codes")
    airline: Mapped["Airline"] = relationship(back_populates="promo_codes")
    
    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "corporate_id": self.corporate_id,
            "airline_id": self.airline_id,
            "corporate_name": self.corporate.company_name if self.corporate else None,
            "airline_name": self.airline.name if self.airline else None,
            "airline_code": self.airline.iata_code if self.airline else None,
            "promo_code": self.promo_code,
            "discount_type": self.discount_type,
            "discount_value": self.discount_value,
            "description": self.description,
            "valid_from": self.valid_from.isoformat() if self.valid_from else None,
            "valid_until": self.valid_until.isoformat() if self.valid_until else None,
            "max_uses": self.max_uses,
            "used_count": self.used_count,
            "is_active": self.is_active
        }


# ==================== PASSENGER FREQUENT FLYER ====================

class PassengerFrequentFlyer(Base):
    """Multiple airline-specific frequent flyer numbers with tier status."""
    __tablename__ = "passenger_frequent_flyers"
    
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    passenger_id: Mapped[str] = mapped_column(String(36), ForeignKey("passengers.id"), nullable=False)
    airline_id: Mapped[str] = mapped_column(String(36), ForeignKey("airlines.id"), nullable=False)
    
    frequent_flyer_number: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    tier_status: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)  # Gold, Silver, Platinum, etc.
    miles_balance: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    tier_expiry_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    
    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    
    # Relationships
    passenger: Mapped["Passenger"] = relationship(back_populates="frequent_flyer_accounts")
    airline: Mapped["Airline"] = relationship(back_populates="frequent_flyer_accounts")
    
    # Indexes
    __table_args__ = (
        Index("idx_ff_number", "frequent_flyer_number"),
        Index("idx_ff_passenger", "passenger_id"),
    )
    
    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "passenger_id": self.passenger_id,
            "airline_id": self.airline_id,
            "airline_name": self.airline.name if self.airline else None,
            "airline_code": self.airline.iata_code if self.airline else None,
            "frequent_flyer_number": self.frequent_flyer_number,
            "tier_status": self.tier_status,
            "miles_balance": self.miles_balance,
            "tier_expiry_date": self.tier_expiry_date.isoformat() if self.tier_expiry_date else None,
            "is_active": self.is_active
        }


# ==================== PASSENGER PREFERENCES ====================

class PassengerPreferences(Base):
    """Meal, seat, cabin, and special assistance preferences."""
    __tablename__ = "passenger_preferences"
    
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    passenger_id: Mapped[str] = mapped_column(String(36), ForeignKey("passengers.id"), nullable=False, unique=True)
    
    # Meal Preferences
    meal_preference: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)  # Vegetarian, Non-Veg, Vegan, etc.
    meal_special_request: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    
    # Seat Preferences
    seat_preference: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # Window, Aisle, Middle
    seat_location: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # Front, Middle, Rear
    
    # Cabin Preferences
    preferred_cabin_class: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # Economy, Premium Economy, Business, First
    
    # Special Assistance
    wheelchair_required: Mapped[bool] = mapped_column(Boolean, default=False)
    special_assistance_type: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)  # WCHR, WCHS, WCHC, etc.
    special_assistance_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    # Other Preferences
    preferred_airlines: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)  # Comma-separated airline codes
    avoid_airlines: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    
    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    passenger: Mapped["Passenger"] = relationship(back_populates="preferences")
    
    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "passenger_id": self.passenger_id,
            "meal_preference": self.meal_preference,
            "meal_special_request": self.meal_special_request,
            "seat_preference": self.seat_preference,
            "seat_location": self.seat_location,
            "preferred_cabin_class": self.preferred_cabin_class,
            "wheelchair_required": self.wheelchair_required,
            "special_assistance_type": self.special_assistance_type,
            "special_assistance_notes": self.special_assistance_notes,
            "preferred_airlines": self.preferred_airlines,
            "avoid_airlines": self.avoid_airlines
        }


# ==================== PASSENGER TRAVEL DOCUMENTS ====================

class PassengerTravelDocument(Base):
    """Passport and known traveler details."""
    __tablename__ = "passenger_travel_documents"
    
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    passenger_id: Mapped[str] = mapped_column(String(36), ForeignKey("passengers.id"), nullable=False)
    
    # Document Type
    document_type: Mapped[str] = mapped_column(String(30), nullable=False)  # PASSPORT, VISA, KTN, REDRESS
    
    # Passport Details
    document_number: Mapped[str] = mapped_column(String(50), nullable=False)
    issuing_country: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    issue_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    expiry_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    
    # Name as on document (may differ from profile)
    name_on_document: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    
    # Known Traveler / Redress
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False)
    
    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    
    # Relationships
    passenger: Mapped["Passenger"] = relationship(back_populates="travel_documents")
    
    # Indexes
    __table_args__ = (
        Index("idx_travel_doc_passenger", "passenger_id"),
    )
    
    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "passenger_id": self.passenger_id,
            "document_type": self.document_type,
            "document_number": self.document_number,
            "issuing_country": self.issuing_country,
            "issue_date": self.issue_date.isoformat() if self.issue_date else None,
            "expiry_date": self.expiry_date.isoformat() if self.expiry_date else None,
            "name_on_document": self.name_on_document,
            "is_primary": self.is_primary,
            "is_active": self.is_active
        }


# ==================== ITINERARY MODEL ====================

class Itinerary(Base):
    """Central workflow object linking passengers, corporates, and flights."""
    __tablename__ = "itineraries_v2"
    
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    
    # Status: draft, approved, on_hold, confirmed, reverted, cancelled
    status: Mapped[str] = mapped_column(String(30), default="draft", index=True)
    
    # Core Data
    title: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    reference_number: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    
    # Trip Type: one_way, round_trip, multi_city
    trip_type: Mapped[Optional[str]] = mapped_column(String(20), nullable=True, default="one_way")
    
    # Passenger Management
    num_passengers: Mapped[int] = mapped_column(Integer, default=1)
    passengers_data: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON string of secondary passenger data
    
    # Flight Parser Output
    flights_data: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON string of flight data
    parser_output_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # Original parser output
    selected_flight_option: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # Index of selected flight
    
    # Raw input data for edit capability (preserves original parser input state)
    raw_input_data: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON: {flights_text, fares, layover_flags, etc.}
    
    # Financials
    total_amount: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    markup: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    service_charge: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    gst_amount: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    discount_amount: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    promo_code_used: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    
    # Billing Context
    billing_type: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # passenger, corporate
    
    # Direct billing fields (denormalized for convenience)
    bill_to_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    bill_to_email: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    bill_to_phone: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    bill_to_address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    bill_to_company: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    bill_to_gst: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    
    # Approval workflow
    requires_approval: Mapped[bool] = mapped_column(Boolean, default=False)
    approved_by: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    approval_remarks: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    # Hold / Confirm tracking
    held_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    confirmed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    reverted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    hold_deadline: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    
    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Foreign Keys
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("user.id"), nullable=False)
    passenger_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("passengers.id"), nullable=True)
    corporate_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("corporates.id"), nullable=True)
    billing_account_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("billing_accounts.id"), nullable=True)
    
    # Relationships
    user: Mapped["User"] = relationship(back_populates="itineraries")
    passenger: Mapped[Optional["Passenger"]] = relationship(back_populates="itineraries")
    corporate: Mapped[Optional["Corporate"]] = relationship(back_populates="itineraries")
    billing_account: Mapped[Optional["BillingAccount"]] = relationship(back_populates="itineraries")
    
    # Indexes
    __table_args__ = (
        Index("idx_itinerary_status", "status"),
        Index("idx_itinerary_user", "user_id"),
        Index("idx_itinerary_passenger", "passenger_id"),
        Index("idx_itinerary_corporate", "corporate_id"),
        Index("idx_itinerary_billing_account", "billing_account_id"),
    )
    
    def to_dict(self, include_flights: bool = False) -> dict:
        import json
        
        data = {
            "id": self.id,
            "status": self.status,
            "title": self.title,
            "description": self.description,
            "reference_number": self.reference_number,
            "trip_type": self.trip_type,
            "num_passengers": self.num_passengers,
            "passengers_data": json.loads(self.passengers_data) if self.passengers_data else [],
            "selected_flight_option": self.selected_flight_option,
            "total_amount": self.total_amount,
            "markup": self.markup,
            "service_charge": self.service_charge,
            "gst_amount": self.gst_amount,
            "discount_amount": self.discount_amount,
            "promo_code_used": self.promo_code_used,
            "billing_type": self.billing_type,
            "billing_account_id": self.billing_account_id,
            "bill_to_name": self.bill_to_name,
            "bill_to_email": self.bill_to_email,
            "bill_to_phone": self.bill_to_phone,
            "bill_to_address": self.bill_to_address,
            "bill_to_company": self.bill_to_company,
            "bill_to_gst": self.bill_to_gst,
            "requires_approval": self.requires_approval,
            "approved_by": self.approved_by,
            "approved_at": self.approved_at.isoformat() if self.approved_at else None,
            "approval_remarks": self.approval_remarks,
            "held_at": self.held_at.isoformat() if self.held_at else None,
            "hold_deadline": self.hold_deadline.isoformat() if self.hold_deadline else None,
            "confirmed_at": self.confirmed_at.isoformat() if self.confirmed_at else None,
            "reverted_at": self.reverted_at.isoformat() if self.reverted_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "user_id": self.user_id,
            "passenger_id": self.passenger_id,
            "corporate_id": self.corporate_id,
            "passenger": self.passenger.to_dict() if self.passenger else None,
            "corporate": self.corporate.to_dict() if self.corporate else None,
            "billing_account": self.billing_account.to_dict() if self.billing_account else None
        }
        
        if include_flights:
            data["flights"] = json.loads(self.flights_data) if self.flights_data else []
            data["parser_output_text"] = self.parser_output_text
            data["raw_input_data"] = json.loads(self.raw_input_data) if self.raw_input_data else None
        
        return data


# ==================== BILLING ACCOUNT MODEL ====================

class BillingAccount(Base):
    """Unified billing profile for generating invoices."""
    __tablename__ = "billing_accounts"
    
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    
    # Type: individual, corporate
    account_type: Mapped[str] = mapped_column(String(20), nullable=False)
    
    # Display Name / Label
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    
    # Billing fields
    company_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    contact_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    gst_number: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    
    # Links to existing entities (optional)
    passenger_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("passengers.id"), nullable=True)
    corporate_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("corporates.id"), nullable=True)
    
    # User ownership
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("user.id"), nullable=False)
    
    # Timestamps & Active
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    # Relationships
    user: Mapped["User"] = relationship(back_populates="billing_accounts")
    itineraries: Mapped[List["Itinerary"]] = relationship(back_populates="billing_account")
    
    # Constraints
    __table_args__ = (
        UniqueConstraint("display_name", "user_id", name="uq_billing_account_name_user"),
    )
    
    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "account_type": self.account_type,
            "display_name": self.display_name,
            "company_name": self.company_name,
            "contact_name": self.contact_name,
            "email": self.email,
            "phone": self.phone,
            "address": self.address,
            "gst_number": self.gst_number,
            "passenger_id": self.passenger_id,
            "corporate_id": self.corporate_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "is_active": self.is_active
        }
