import os
import json
import uuid
import requests
from flask import Flask, request, jsonify, render_template, session, redirect, url_for, send_file
from dotenv import load_dotenv
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime
from functools import wraps
from query_parser import extract_flight, extract_multiple_flights
from models import User, Customer, Itinerary, Ticket
from extensions import db

import pytesseract

load_dotenv()
app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///app.db"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "your-secret-key-change-in-production")
# 🔐 Shared secret for ticket parser
API_KEY ="timetours@1978"

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

        # Determine trip type - properly handle layovers
        # A layover exists when consecutive segments share airports
        # (arrival airport of seg N == departure airport of seg N+1)
        seg_count = len(segments)
        
        # First, group segments into logical legs (a leg = direct or layover flight)
        legs = []
        current_leg_start = 0
        for i in range(1, seg_count):
            prev_arr = segments[i-1].get("arrival", {}).get("airport", "").strip().upper()
            curr_dep = segments[i].get("departure", {}).get("airport", "").strip().upper()
            # Also check layover_duration field from parser
            has_layover_info = segments[i].get("layover_duration") and segments[i].get("layover_duration") != "N/A"
            
            if prev_arr and curr_dep and prev_arr == curr_dep or has_layover_info:
                # This is a layover/connection, same leg continues
                continue
            else:
                # New leg starts here
                legs.append(segments[current_leg_start:i])
                current_leg_start = i
        legs.append(segments[current_leg_start:])
        
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

        # Calculate grand_total from passengers if available to ensure it's not just basic fare
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
        
        final_grand_total = calculated_grand_total if pax_fares_found else booking.get("grand_total", 0)

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

        return jsonify({
            "status": "accepted",
            "ticket_id": ticket.id,
            "matched": matched,
            "matched_itinerary_id": ticket.matched_itinerary_id
        }), 201

    except Exception as e:
        db.session.rollback()
        print(f"Ticket receive error: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"Failed to process ticket: {str(e)}"}), 500


# ==================== TICKETS PAGE ====================

@app.route("/tickets")
def tickets_page():
    """Serve the tickets dashboard page"""
    return render_template('tickets.html')


# ==================== TICKET CRUD ROUTES ====================

@app.route("/api/tickets/list", methods=["GET"])
@login_required
def get_tickets():
    """Get all tickets for the logged-in user"""
    tickets = Ticket.query.filter_by(user_id=session['user_id']).order_by(Ticket.created_at.desc()).all()
    
    result = []
    for t in tickets:
        passengers = json.loads(t.passengers_data) if t.passengers_data else []
        segments = json.loads(t.segments_data) if t.segments_data else []
        journey = json.loads(t.journey_data) if t.journey_data else {}
        
        # Group segments into logical legs (handling layovers)
        legs = []
        current_leg_start = 0
        for i in range(1, len(segments)):
            prev_arr = segments[i-1].get("arrival", {}).get("airport", "").strip().upper()
            curr_dep = segments[i].get("departure", {}).get("airport", "").strip().upper()
            has_layover_info = segments[i].get("layover_duration") and segments[i].get("layover_duration") != "N/A"
            
            if (prev_arr and curr_dep and prev_arr == curr_dep) or has_layover_info:
                continue
            else:
                legs.append(list(range(current_leg_start, i)))
                current_leg_start = i
        legs.append(list(range(current_leg_start, len(segments))))
        
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
        
        result.append({
            "id": t.id,
            "created_at": t.created_at.isoformat(),
            "updated_at": t.updated_at.isoformat() if t.updated_at else None,
            "pnr": t.pnr,
            "booking_date": t.booking_date,
            "phone": t.phone,
            "currency": t.currency,
            "grand_total": t.grand_total,
            "class_of_travel": t.class_of_travel,
            "trip_type": t.trip_type,
            "status": t.status,
            "matched_itinerary_id": t.matched_itinerary_id,
            "parser_version": t.parser_version,
            "passengers": passengers,
            "segments": segments,
            "journey": journey,
            "legs": legs,
            "route": " → ".join(route_parts) if route_parts else "",
            "passenger_names": [p.get("name", "") for p in passengers]
        })
    
    return jsonify({"tickets": result})


@app.route("/api/tickets/<ticket_id>", methods=["GET"])
@login_required
def get_ticket(ticket_id):
    """Get a specific ticket with full data"""
    ticket = Ticket.query.filter_by(id=ticket_id, user_id=session['user_id']).first()
    if not ticket:
        return jsonify({"error": "Ticket not found"}), 404
    
    passengers = json.loads(ticket.passengers_data) if ticket.passengers_data else []
    segments = json.loads(ticket.segments_data) if ticket.segments_data else []
    journey = json.loads(ticket.journey_data) if ticket.journey_data else {}
    raw = json.loads(ticket.raw_data) if ticket.raw_data else {}
    
    return jsonify({
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
        "matched_itinerary_id": ticket.matched_itinerary_id,
        "parser_version": ticket.parser_version,
        "passengers": passengers,
        "segments": segments,
        "journey": journey,
        "raw_data": raw
    })


@app.route("/api/tickets/<ticket_id>", methods=["PUT"])
@login_required
def update_ticket(ticket_id):
    """Update a ticket (edit passengers, segments, fares, etc.)"""
    try:
        ticket = Ticket.query.filter_by(id=ticket_id, user_id=session['user_id']).first()
        if not ticket:
            return jsonify({"error": "Ticket not found"}), 404
        
        data = request.get_json()
        
        if 'pnr' in data:
            ticket.pnr = data['pnr']
        if 'booking_date' in data:
            ticket.booking_date = data['booking_date']
        if 'phone' in data:
            ticket.phone = data['phone']
        if 'currency' in data:
            ticket.currency = data['currency']
        if 'grand_total' in data:
            ticket.grand_total = data['grand_total']
        if 'class_of_travel' in data:
            ticket.class_of_travel = data['class_of_travel']
        if 'trip_type' in data:
            ticket.trip_type = data['trip_type']
        if 'passengers' in data:
            ticket.passengers_data = json.dumps(data['passengers'])
        if 'segments' in data:
            ticket.segments_data = json.dumps(data['segments'])
        if 'journey' in data:
            ticket.journey_data = json.dumps(data['journey'])
        if 'raw_data' in data:
            ticket.raw_data = json.dumps(data['raw_data'])
        if 'status' in data:
            ticket.status = data['status']
        
        ticket.updated_at = datetime.utcnow()
        db.session.commit()
        
        return jsonify({"message": "Ticket updated successfully"})
    
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
        
        db.session.delete(ticket)
        db.session.commit()
        return jsonify({"message": "Ticket deleted successfully"})
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": f"Failed to delete ticket: {str(e)}"}), 500


@app.route("/api/tickets/<ticket_id>/pdf", methods=["GET"])
@login_required
def generate_ticket_pdf(ticket_id):
    """Generate PDF for a ticket (with or without fare)"""
    ticket = Ticket.query.filter_by(id=ticket_id, user_id=session['user_id']).first()
    if not ticket:
        return jsonify({"error": "Ticket not found"}), 404
    
    include_fare = request.args.get('include_fare', 'true').lower() == 'true'
    
    passengers = json.loads(ticket.passengers_data) if ticket.passengers_data else []
    segments = json.loads(ticket.segments_data) if ticket.segments_data else []
    
    # Extract journey and raw data for additional info
    journey = json.loads(ticket.journey_data) if ticket.journey_data else {}
    raw = json.loads(ticket.raw_data) if ticket.raw_data else {}
    gst_details = raw.get("gst_details") or {}
    
    # Build data dict for PDF generator
    pdf_data = {
        "booking_date": ticket.booking_date,
        "phone": ticket.phone,
        "pnr": ticket.pnr,
        "currency": ticket.currency,
        "grand_total": ticket.grand_total,
        "class_of_travel": ticket.class_of_travel,
        "passengers": passengers,
        "segments": segments,
        "journey": journey,
        "reference_number": raw.get("booking", {}).get("reference_number"),
        "gst_company_name": gst_details.get("company_name"),
        "gst_number": gst_details.get("gst_number"),
        "trip_type": ticket.trip_type,
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
