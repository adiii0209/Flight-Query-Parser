import uuid
from datetime import datetime
from werkzeug.security import generate_password_hash, check_password_hash
from extensions import db

# ==================== MODELS ====================

class User(db.Model):
    id = db.Column(db.String, primary_key=True, default=lambda: str(uuid.uuid4()))
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    full_name = db.Column(db.String(120))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
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
    flights_data = db.Column(db.Text)  # JSON string of flight data
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
