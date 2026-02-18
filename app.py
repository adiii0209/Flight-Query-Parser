import os
import json
import uuid
import requests
from flask import Flask, request, jsonify, render_template, session, redirect, url_for
from dotenv import load_dotenv
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime
from functools import wraps
from query_parser import extract_flight, extract_multiple_flights
from models import User, Customer, Itinerary
from extensions import db

import pytesseract

load_dotenv()
app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///app.db"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "your-secret-key-change-in-production")
UPLOAD_FOLDER = "uploads"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

db.init_app(app)

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
            return jsonify({"error": "Authentication required"}), 401
        return f(*args, **kwargs)
    return decorated_function


# ==================== ROUTES ====================

@app.route("/")
def home():
    """Serve the main HTML page"""
    return render_template('index.html')

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



# ==================== DATABASE INITIALIZATION ====================

def init_db():
    """Initialize the database"""
    with app.app_context():
        db.create_all()
        # Also initialize v2 tables
        from extensions_v2 import init_db as init_db_v2
        init_db_v2()
        print("Database initialized successfully!")

if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000, debug=True)
