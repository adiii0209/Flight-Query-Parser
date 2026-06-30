"""
Travel Agent Flight Booking Platform - API Routes
REST API endpoints for Corporates, Passengers, Airlines, and Itineraries.
"""

import json
from datetime import datetime, date
from functools import wraps
from flask import Blueprint, request, jsonify, session
from routes.auth import login_required, role_required, org_type_required, get_org_scope
from sqlalchemy import String, cast, func
from sqlalchemy.orm import joinedload, load_only, selectinload, defer

from extensions_v2 import db_session
from models_v2 import (
    User, Corporate, Passenger, Airline, 
    CorporatePassenger, CorporateAirlinePromoCode,
    PassengerFrequentFlyer, PassengerPreferences, 
    PassengerTravelDocument, Itinerary, BillingAccount, SupplierAccount
)

# Create blueprint
api_v2 = Blueprint('api_v2', __name__, url_prefix='/api/v2')


# ==================== AUTHENTICATION DECORATOR ====================



# ==================== HELPER FUNCTIONS ====================

def parse_date(date_str):
    """Parse date string to date object."""
    if not date_str:
        return None
    try:
        return datetime.strptime(date_str, "%Y-%m-%d").date()
    except ValueError:
        return None


def normalize_str(s):
    """Normalize string for comparison (trim, lowercase, None check)."""
    if not s: return None
    return s.strip().lower()


def _itinerary_summary_options():
    return (
        load_only(
            Itinerary.id,
            Itinerary.status,
            Itinerary.title,
            Itinerary.description,
            Itinerary.reference_number,
            Itinerary.trip_type,
            Itinerary.num_passengers,
            Itinerary.passengers_data,
            Itinerary.selected_flight_option,
            Itinerary.total_amount,
            Itinerary.markup,
            Itinerary.service_charge,
            Itinerary.gst_amount,
            Itinerary.discount_amount,
            Itinerary.promo_code_used,
            Itinerary.billing_type,
            Itinerary.billing_account_id,
            Itinerary.bill_to_name,
            Itinerary.bill_to_email,
            Itinerary.bill_to_phone,
            Itinerary.bill_to_address,
            Itinerary.bill_to_company,
            Itinerary.bill_to_gst,
            Itinerary.requires_approval,
            Itinerary.approved_by,
            Itinerary.approved_at,
            Itinerary.approval_remarks,
            Itinerary.held_at,
            Itinerary.hold_deadline,
            Itinerary.confirmed_at,
            Itinerary.reverted_at,
            Itinerary.created_at,
            Itinerary.updated_at,
            Itinerary.user_id,
            Itinerary.passenger_id,
            Itinerary.corporate_id,
            Itinerary.flights_data,
            Itinerary.supplier_account_id,
            Itinerary.supplier_name,
            Itinerary.supplier_email,
            Itinerary.supplier_phone,
            Itinerary.supplier_address,
            Itinerary.supplier_company,
            Itinerary.supplier_gst,
        ),
        joinedload(Itinerary.billing_account).load_only(
            BillingAccount.id,
            BillingAccount.account_type,
            BillingAccount.display_name,
            BillingAccount.company_name,
            BillingAccount.contact_name,
            BillingAccount.email,
            BillingAccount.phone,
            BillingAccount.address,
            BillingAccount.gst_number,
        ),
        joinedload(Itinerary.supplier_account).load_only(
            SupplierAccount.id,
            SupplierAccount.account_type,
            SupplierAccount.display_name,
            SupplierAccount.company_name,
            SupplierAccount.contact_name,
            SupplierAccount.email,
            SupplierAccount.phone,
            SupplierAccount.address,
            SupplierAccount.gst_number,
        ),
    )


def _itinerary_detail_options():
    return (
        load_only(
            Itinerary.id,
            Itinerary.status,
            Itinerary.title,
            Itinerary.description,
            Itinerary.reference_number,
            Itinerary.trip_type,
            Itinerary.num_passengers,
            Itinerary.passengers_data,
            Itinerary.selected_flight_option,
            Itinerary.total_amount,
            Itinerary.markup,
            Itinerary.service_charge,
            Itinerary.gst_amount,
            Itinerary.discount_amount,
            Itinerary.promo_code_used,
            Itinerary.billing_type,
            Itinerary.billing_account_id,
            Itinerary.bill_to_name,
            Itinerary.bill_to_email,
            Itinerary.bill_to_phone,
            Itinerary.bill_to_address,
            Itinerary.bill_to_company,
            Itinerary.bill_to_gst,
            Itinerary.requires_approval,
            Itinerary.approved_by,
            Itinerary.approved_at,
            Itinerary.approval_remarks,
            Itinerary.held_at,
            Itinerary.hold_deadline,
            Itinerary.confirmed_at,
            Itinerary.reverted_at,
            Itinerary.created_at,
            Itinerary.updated_at,
            Itinerary.user_id,
            Itinerary.passenger_id,
            Itinerary.corporate_id,
            Itinerary.parser_output_text,
            Itinerary.supplier_account_id,
            Itinerary.supplier_name,
            Itinerary.supplier_email,
            Itinerary.supplier_phone,
            Itinerary.supplier_address,
            Itinerary.supplier_company,
            Itinerary.supplier_gst,
        ),
        joinedload(Itinerary.passenger),
        joinedload(Itinerary.corporate),
        joinedload(Itinerary.billing_account),
        joinedload(Itinerary.supplier_account),
    )

def _get_itinerary_detail_record(itinerary_id, user_id, include_flights=False):
    query = db_session.query(Itinerary).options(*_itinerary_detail_options())
    if not include_flights:
        query = query.options(defer(Itinerary.raw_input_data))
    return query.filter_by(
        id=itinerary_id,
        **get_org_scope()
    ).first()


def _json_or_none(value):
    if value is None or value == "":
        return None
    return value


def _itinerary_response(itinerary, include_flights=False):
    if include_flights:
        return itinerary.to_detail_dict(include_flights=True)
    return itinerary.to_summary_dict(include_flights=False)

# ==================== AIRLINE ROUTES ====================

@api_v2.route('/airlines', methods=['GET'])
def get_airlines():
    """Get all airlines."""
    airlines = db_session.query(Airline).filter_by(is_active=True).all()
    return jsonify({
        "airlines": [a.to_dict() for a in airlines]
    })


@api_v2.route('/airlines/<airline_id>', methods=['GET'])
def get_airline(airline_id):
    """Get a specific airline."""
    airline = db_session.query(Airline).filter_by(id=airline_id).first()
    if not airline:
        return jsonify({"error": "Airline not found"}), 404
    return jsonify(airline.to_dict())


@api_v2.route('/airlines/code/<iata_code>', methods=['GET'])
def get_airline_by_code(iata_code):
    """Get airline by IATA code."""
    airline = db_session.query(Airline).filter_by(iata_code=iata_code.upper()).first()
    if not airline:
        return jsonify({"error": "Airline not found"}), 404
    return jsonify(airline.to_dict())


# ==================== CORPORATE ROUTES ====================

@api_v2.route('/corporates', methods=['GET'])
@login_required
def get_corporates():
    """Get all corporates for the logged-in user."""
    try:
        limit = max(int(request.args.get('limit', 0) or 0), 0)
    except (TypeError, ValueError):
        limit = 0
    try:
        offset = max(int(request.args.get('offset', 0) or 0), 0)
    except (TypeError, ValueError):
        offset = 0

    base_query = db_session.query(Corporate).options(
        load_only(
            Corporate.id,
            Corporate.company_name,
            Corporate.gst_number,
            Corporate.pan_number,
            Corporate.billing_address_line1,
            Corporate.billing_address_line2,
            Corporate.billing_city,
            Corporate.billing_state,
            Corporate.billing_pincode,
            Corporate.billing_country,
            Corporate.contact_person_name,
            Corporate.contact_email,
            Corporate.contact_phone,
            Corporate.contact_alternate_phone,
            Corporate.internal_remarks,
            Corporate.credit_limit,
            Corporate.payment_terms_days,
            Corporate.created_at,
            Corporate.updated_at,
            Corporate.is_active,
        )
    ).filter_by(
        **get_org_scope(),
        is_active=True
    ).order_by(Corporate.company_name)
    total_count = base_query.count()
    corporates_query = base_query.offset(offset)
    if limit:
        corporates_query = corporates_query.limit(limit)
    corporates = corporates_query.all()
    returned_count = len(corporates)
    corporate_ids = [corporate.id for corporate in corporates]
    passenger_counts = {}
    promo_counts = {}
    if corporate_ids:
        passenger_counts = dict(
            db_session.query(
                CorporatePassenger.corporate_id,
                func.count(CorporatePassenger.id),
            ).filter(
                CorporatePassenger.corporate_id.in_(corporate_ids),
                CorporatePassenger.is_active == True,
            ).group_by(CorporatePassenger.corporate_id).all()
        )
        promo_counts = dict(
            db_session.query(
                CorporateAirlinePromoCode.corporate_id,
                func.count(CorporateAirlinePromoCode.id),
            ).filter(
                CorporateAirlinePromoCode.corporate_id.in_(corporate_ids),
                CorporateAirlinePromoCode.is_active == True,
            ).group_by(CorporateAirlinePromoCode.corporate_id).all()
        )
    payload = {
        "corporates": [
            {
                "id": corporate.id,
                "company_name": corporate.company_name,
                "gst_number": corporate.gst_number,
                "pan_number": corporate.pan_number,
                "billing_address_line1": corporate.billing_address_line1,
                "billing_address_line2": corporate.billing_address_line2,
                "billing_city": corporate.billing_city,
                "billing_state": corporate.billing_state,
                "billing_pincode": corporate.billing_pincode,
                "billing_country": corporate.billing_country,
                "contact_person_name": corporate.contact_person_name,
                "contact_email": corporate.contact_email,
                "contact_phone": corporate.contact_phone,
                "contact_alternate_phone": corporate.contact_alternate_phone,
                "internal_remarks": corporate.internal_remarks,
                "credit_limit": corporate.credit_limit,
                "payment_terms_days": corporate.payment_terms_days,
                "created_at": corporate.created_at.isoformat() if corporate.created_at else None,
                "updated_at": corporate.updated_at.isoformat() if corporate.updated_at else None,
                "is_active": corporate.is_active,
                "passengers_count": int(passenger_counts.get(corporate.id, 0) or 0),
                "promo_codes_count": int(promo_counts.get(corporate.id, 0) or 0),
            }
            for corporate in corporates
        ],
        "total_count": total_count,
        "offset": offset,
        "returned_count": returned_count,
        "has_more": bool(limit and (offset + returned_count) < total_count),
    }
    if limit:
        payload["limit"] = limit
    return jsonify(payload)


@api_v2.route('/corporates', methods=['POST'])
@login_required
def create_corporate():
    """Create a new corporate."""
    try:
        data = request.get_json()
        
        if not data or not data.get('company_name'):
            return jsonify({"error": "Company name is required"}), 400
        
        # Uniqueness Validation
        existing_corp = db_session.query(Corporate).filter(
            Corporate.organization_id == session.get("organization_id"),
            Corporate.company_name.ilike(data['company_name'].strip()),
            Corporate.is_active == True
        ).first()

        if existing_corp:
            # Check for distinguishing fields if name matches
            fields_differ = False
            if normalize_str(data.get('gst_number')) != normalize_str(existing_corp.gst_number): fields_differ = True
            if normalize_str(data.get('contact_email')) != normalize_str(existing_corp.contact_email): fields_differ = True
            
            if not fields_differ:
                return jsonify({"error": f"A corporate with name '{data['company_name']}' already exists. Provide a different GST or Email to distinguish."}), 409

        corporate = Corporate(
            company_name=data['company_name'].strip(),
            gst_number=data.get('gst_number'),
            pan_number=data.get('pan_number'),
            billing_address_line1=data.get('billing_address_line1'),
            billing_address_line2=data.get('billing_address_line2'),
            billing_city=data.get('billing_city'),
            billing_state=data.get('billing_state'),
            billing_pincode=data.get('billing_pincode'),
            billing_country=data.get('billing_country', 'India'),
            contact_person_name=data.get('contact_person_name'),
            contact_email=data.get('contact_email'),
            contact_phone=data.get('contact_phone'),
            contact_alternate_phone=data.get('contact_alternate_phone'),
            internal_remarks=data.get('internal_remarks'),
            credit_limit=data.get('credit_limit'),
            payment_terms_days=data.get('payment_terms_days', 30),
            user_id=session['user_id'],
            **get_org_scope()
        )
        
        db_session.add(corporate)
        db_session.commit()
        
        return jsonify({
            "message": "Corporate created successfully",
            "corporate": corporate.to_dict()
        }), 201
        
    except Exception as e:
        db_session.rollback()
        # Handle Unique Constraint Integrity Error specifically if needed
        if "uq_corporate_name_user" in str(e):
             return jsonify({"error": "Duplicate corporate entry detected at database level."}), 409
        return jsonify({"error": f"Failed to create corporate: {str(e)}"}), 500


@api_v2.route('/corporates/<corporate_id>', methods=['GET'])
@login_required
def get_corporate(corporate_id):
    """Get a specific corporate with related data."""
    corporate = db_session.query(Corporate).options(
        selectinload(Corporate.passenger_links).selectinload(CorporatePassenger.passenger),
        selectinload(Corporate.promo_codes).selectinload(CorporateAirlinePromoCode.airline),
    ).filter_by(
        id=corporate_id, **get_org_scope()
    ).first()
    
    if not corporate:
        return jsonify({"error": "Corporate not found"}), 404
    
    data = corporate.to_dict()
    data['passengers'] = [link.to_dict() for link in corporate.passenger_links if link.is_active]
    data['promo_codes'] = [pc.to_dict() for pc in corporate.promo_codes if pc.is_active]
    itineraries = db_session.query(Itinerary).options(
        *_itinerary_summary_options()
    ).filter_by(
        corporate_id=corporate_id, **get_org_scope()
    ).order_by(Itinerary.created_at.desc()).limit(10).all()
    data['itineraries'] = [it.to_summary_dict(include_flights=False) for it in itineraries]
    
    return jsonify(data)


@api_v2.route('/corporates/<corporate_id>', methods=['PUT'])
@login_required
def update_corporate(corporate_id):
    """Update a corporate."""
    try:
        corporate = db_session.query(Corporate).filter_by(
            id=corporate_id, **get_org_scope()
        ).first()
        
        if not corporate:
            return jsonify({"error": "Corporate not found"}), 404
        
        data = request.get_json()
        
        # Uniqueness Validation for Update
        if 'company_name' in data:
            new_name = data['company_name'].strip()
            existing_corp = db_session.query(Corporate).filter(
                Corporate.organization_id == session.get("organization_id"),
                Corporate.company_name.ilike(new_name),
                Corporate.id != corporate_id,  # Exclude self
                Corporate.is_active == True
            ).first()

            if existing_corp:
                # Check distinguishing fields
                gst = data.get('gst_number', corporate.gst_number)
                email = data.get('contact_email', corporate.contact_email)
                
                fields_differ = False
                if normalize_str(gst) != normalize_str(existing_corp.gst_number): fields_differ = True
                if normalize_str(email) != normalize_str(existing_corp.contact_email): fields_differ = True
                
                if not fields_differ:
                    return jsonify({"error": f"Another corporate with name '{new_name}' already exists. Provide a different GST or Email."}), 409

        # Update fields
        for field in ['company_name', 'gst_number', 'pan_number', 
                      'billing_address_line1', 'billing_address_line2',
                      'billing_city', 'billing_state', 'billing_pincode', 'billing_country',
                      'contact_person_name', 'contact_email', 'contact_phone',
                      'contact_alternate_phone', 'internal_remarks', 'credit_limit',
                      'payment_terms_days', 'is_active']:
            if field in data:
                if field == 'company_name':
                     setattr(corporate, field, data[field].strip())
                else:
                     setattr(corporate, field, data[field])
        
        db_session.commit()
        
        return jsonify({
            "message": "Corporate updated successfully",
            "corporate": corporate.to_dict()
        })
        
    except Exception as e:
        db_session.rollback()
        return jsonify({"error": f"Failed to update corporate: {str(e)}"}), 500


@api_v2.route('/corporates/<corporate_id>', methods=['DELETE'])
@login_required
def delete_corporate(corporate_id):
    """Delete a corporate (soft delete)."""
    try:
        corporate = db_session.query(Corporate).filter_by(
            id=corporate_id, **get_org_scope()
        ).first()
        
        if not corporate:
            return jsonify({"error": "Corporate not found"}), 404
        
        corporate.is_active = False
        db_session.commit()
        
        return jsonify({"message": "Corporate deleted successfully"})
        
    except Exception as e:
        db_session.rollback()
        return jsonify({"error": f"Failed to delete corporate: {str(e)}"}), 500


# ==================== CORPORATE PROMO CODE ROUTES ====================

@api_v2.route('/corporates/<corporate_id>/promo-codes', methods=['GET'])
@login_required
def get_corporate_promo_codes(corporate_id):
    """Get promo codes for a corporate."""
    if not db_session.query(Corporate.id).filter(
        Corporate.id == corporate_id,
        Corporate.organization_id == session.get("organization_id"),
        Corporate.is_active == True,
    ).first():
        return jsonify({"error": "Corporate not found"}), 404

    promo_codes = db_session.query(CorporateAirlinePromoCode).options(
        joinedload(CorporateAirlinePromoCode.airline).load_only(
            Airline.id,
            Airline.iata_code,
            Airline.name,
        )
    ).filter(
        CorporateAirlinePromoCode.corporate_id == corporate_id,
        CorporateAirlinePromoCode.is_active == True,
        CorporateAirlinePromoCode.corporate.has(organization_id=session.get('organization_id'), is_active=True),
    ).order_by(CorporateAirlinePromoCode.created_at.desc()).all()
    return jsonify({"promo_codes": [pc.to_dict() for pc in promo_codes]})


@api_v2.route('/corporates/<corporate_id>/promo-codes', methods=['POST'])
@login_required
def create_corporate_promo_code(corporate_id):
    """Create a promo code for a corporate."""
    try:
        corporate = db_session.query(Corporate).filter_by(
            id=corporate_id, **get_org_scope()
        ).first()
        
        if not corporate:
            return jsonify({"error": "Corporate not found"}), 404
        
        data = request.get_json()
        
        if not data.get('airline_id') or not data.get('promo_code'):
            return jsonify({"error": "Airline and promo code are required"}), 400
        
        promo = CorporateAirlinePromoCode(
            corporate_id=corporate_id,
            airline_id=data['airline_id'],
            promo_code=data['promo_code'],
            discount_type=data.get('discount_type'),
            discount_value=data.get('discount_value'),
            description=data.get('description'),
            valid_from=parse_date(data.get('valid_from')),
            valid_until=parse_date(data.get('valid_until')),
            max_uses=data.get('max_uses')
        )
        
        db_session.add(promo)
        db_session.commit()
        
        return jsonify({
            "message": "Promo code created successfully",
            "promo_code": promo.to_dict()
        }), 201
        
    except Exception as e:
        db_session.rollback()
        return jsonify({"error": f"Failed to create promo code: {str(e)}"}), 500


@api_v2.route('/corporates/<corporate_id>/promo-codes/<promo_id>', methods=['DELETE'])
@login_required
def delete_corporate_promo_code(corporate_id, promo_id):
    """Delete a corporate promo code."""
    try:
        corporate = db_session.query(Corporate).filter_by(
            id=corporate_id, **get_org_scope()
        ).first()
        
        if not corporate:
            return jsonify({"error": "Corporate not found"}), 404
        
        promo = db_session.query(CorporateAirlinePromoCode).filter_by(
            id=promo_id,
            corporate_id=corporate_id
        ).first()
        
        if not promo:
            return jsonify({"error": "Promo code not found"}), 404
        
        promo.is_active = False
        db_session.commit()
        
        return jsonify({"message": "Promo code deleted successfully"})
        
    except Exception as e:
        db_session.rollback()
        return jsonify({"error": f"Failed to delete promo code: {str(e)}"}), 500


# ==================== PASSENGER ROUTES ====================

@api_v2.route('/passengers', methods=['GET'])
@login_required
def get_passengers():
    """Get all passengers for the logged-in user."""
    try:
        limit = max(int(request.args.get('limit', 0) or 0), 0)
    except (TypeError, ValueError):
        limit = 0
    try:
        offset = max(int(request.args.get('offset', 0) or 0), 0)
    except (TypeError, ValueError):
        offset = 0

    base_query = db_session.query(Passenger).filter_by(
        is_active=True, **get_org_scope()
    ).order_by(Passenger.first_name, Passenger.last_name)
    total_count = base_query.count()
    passengers_query = base_query.offset(offset)
    if limit:
        passengers_query = passengers_query.limit(limit)
    passengers = passengers_query.all()
    payload = {
        "passengers": [p.to_dict() for p in passengers],
        "total_count": total_count,
        "offset": offset,
        "returned_count": len(passengers),
        "has_more": bool(limit and (offset + len(passengers)) < total_count),
    }
    if limit:
        payload["limit"] = limit
    return jsonify(payload)


@api_v2.route('/passengers', methods=['POST'])
@login_required
def create_passenger():
    """Create a new passenger."""
    try:
        data = request.get_json()
        
        if not data.get('first_name') or not data.get('last_name'):
            return jsonify({"error": "First name and last name are required"}), 400
        
        first_name = data['first_name'].strip()
        last_name = data['last_name'].strip()
        
        # Uniqueness Validation
        existing_pax = db_session.query(Passenger).filter(
            Passenger.organization_id == session.get("organization_id"),
            Passenger.first_name.ilike(first_name),
            Passenger.last_name.ilike(last_name),
            Passenger.is_active == True
        ).first()

        if existing_pax:
            # Check for distinguishing fields
            fields_differ = False
            
            # Normalize inputs
            new_email = normalize_str(data.get('email'))
            new_phone = normalize_str(data.get('phone'))
            new_dob = parse_date(data.get('date_of_birth'))

            # Compare (Note: handle existing_pax.date_of_birth which is date object)
            if new_email and new_email != normalize_str(existing_pax.email): fields_differ = True
            if new_phone and new_phone != normalize_str(existing_pax.phone): fields_differ = True
            if new_dob and (not existing_pax.date_of_birth or new_dob != existing_pax.date_of_birth): fields_differ = True
            
            # If distinguishing fields are empty in incoming data, we can't distinguish, so assume duplicate unless existing fields were also empty
            # But the requirement says "if at least one... is different AND explicitly provided"
            
            if not fields_differ:
                # If no distinguishing field provided or they match, reject
                return jsonify({"error": f"Passenger '{first_name} {last_name}' already exists. Provide Email, Phone, or DOB to distinguish."}), 409

        passenger = Passenger(
            title=data.get('title'),
            first_name=first_name,
            middle_name=data.get('middle_name'),
            last_name=last_name,
            date_of_birth=parse_date(data.get('date_of_birth')),
            gender=data.get('gender'),
            nationality=data.get('nationality', 'Indian'),
            email=data.get('email'),
            phone=data.get('phone'),
            alternate_phone=data.get('alternate_phone'),
            address_line1=data.get('address_line1'),
            address_line2=data.get('address_line2'),
            city=data.get('city'),
            state=data.get('state'),
            pincode=data.get('pincode'),
            country=data.get('country', 'India'),
            emergency_contact_name=data.get('emergency_contact_name'),
            emergency_contact_phone=data.get('emergency_contact_phone'),
            emergency_contact_relationship=data.get('emergency_contact_relationship'), 
            user_id=session.get('user_id'),
            **get_org_scope()
        )
        
        db_session.add(passenger)
        db_session.commit()
        
        return jsonify({
            "message": "Passenger created successfully",
            "passenger": passenger.to_dict()
        }), 201
        
    except Exception as e:
        db_session.rollback()
        if "uq_passenger_identity" in str(e):
             return jsonify({"error": "Duplicate passenger entry detected (DB constraint)."}), 409
        return jsonify({"error": f"Failed to create passenger: {str(e)}"}), 500


@api_v2.route('/passengers/<passenger_id>', methods=['GET'])
@login_required
def get_passenger(passenger_id):
    """Get a specific passenger with all related data."""
    passenger = db_session.query(Passenger).options(
        selectinload(Passenger.frequent_flyer_accounts).selectinload(PassengerFrequentFlyer.airline),
        selectinload(Passenger.travel_documents),
        selectinload(Passenger.preferences),
        selectinload(Passenger.corporate_links).selectinload(CorporatePassenger.corporate),
    ).filter_by(
        id=passenger_id, **get_org_scope()
    ).first()
    
    if not passenger:
        return jsonify({"error": "Passenger not found"}), 404
    
    return jsonify(passenger.to_dict(include_related=True))


@api_v2.route('/passengers/<passenger_id>', methods=['PUT'])
@login_required
def update_passenger(passenger_id):
    """Update a passenger."""
    try:
        passenger = db_session.query(Passenger).filter_by(
            id=passenger_id, **get_org_scope()
        ).first()
        
        if not passenger:
            return jsonify({"error": "Passenger not found"}), 404
        
        data = request.get_json()
        
        # Uniqueness Validation for Update
        # Determine the effective new values
        new_first = data.get('first_name', passenger.first_name).strip()
        new_last = data.get('last_name', passenger.last_name).strip()
        new_dob = parse_date(data.get('date_of_birth')) if 'date_of_birth' in data else passenger.date_of_birth
        new_email = normalize_str(data.get('email', passenger.email))
        new_phone = normalize_str(data.get('phone', passenger.phone))

        # Check if any identity field is being updated
        # (If we only update 'is_active' or address, strictly speaking we might not need to check, 
        #  but checking is safer to ensure we don't accidentally converge on a duplicate)
        identity_fields = ['first_name', 'last_name', 'date_of_birth', 'email', 'phone']
        should_check_dupes = any(f in data for f in identity_fields)

        if should_check_dupes:
            existing_pax = db_session.query(Passenger).filter(
                Passenger.organization_id == session.get("organization_id"),
                Passenger.first_name.ilike(new_first),
                Passenger.last_name.ilike(new_last),
                Passenger.id != passenger_id,  # Exclude self
                Passenger.is_active == True
            ).first()

            if existing_pax:
                # Compare strict differentiating fields
                fields_differ = False
                
                # Check against the EXISTING passenger's details
                if new_email and new_email != normalize_str(existing_pax.email): fields_differ = True
                if new_phone and new_phone != normalize_str(existing_pax.phone): fields_differ = True
                if new_dob and (not existing_pax.date_of_birth or new_dob != existing_pax.date_of_birth): fields_differ = True
                
                # If the other passenger has empty distinguishing fields, we can't be sure, 
                # but standard logic is: if provided info matches or doesn't verify difference, it's a dupe.
                # However, usually we check if the NEW provided info conflicts.
                
                if not fields_differ:
                     return jsonify({"error": f"Another passenger '{new_first} {new_last}' already exists. Provide different Email, Phone, or DOB to distinguish."}), 409

        # Update fields
        for field in ['title', 'first_name', 'middle_name', 'last_name',
                      'gender', 'nationality', 'email', 'phone', 'alternate_phone',
                      'address_line1', 'address_line2', 'city', 'state', 'pincode', 'country',
                      'emergency_contact_name', 'emergency_contact_phone', 
                      'emergency_contact_relationship', 'is_active']:
            if field in data:
                 if field in ['first_name', 'last_name']:
                     setattr(passenger, field, data[field].strip())
                 else:
                     setattr(passenger, field, data[field])
        
        if 'date_of_birth' in data:
            passenger.date_of_birth = parse_date(data['date_of_birth'])
        
        db_session.commit()

        # Synchronize itineraries containing this passenger
        try:
            search_pattern = f'"{passenger_id}"'
            affected_itineraries = db_session.query(Itinerary).filter(
                Itinerary.organization_id == session.get("organization_id"),
                (Itinerary.passenger_id == passenger_id) | (cast(Itinerary.passengers_data, String).like(f"%{search_pattern}%"))
            ).all()

            for itin in affected_itineraries:
                if itin.passengers_data:
                    p_list = itin._parse_json_field(itin.passengers_data, [])
                    updated_itin = False
                    for p_entry in p_list:
                        if p_entry.get('passenger_id') == passenger_id or p_entry.get('id') == passenger_id:
                            p_entry['first_name'] = passenger.first_name
                            p_entry['last_name'] = passenger.last_name
                            p_entry['email'] = passenger.email
                            p_entry['phone'] = passenger.phone
                            p_entry['gender'] = passenger.gender
                            p_entry['date_of_birth'] = passenger.date_of_birth.isoformat() if passenger.date_of_birth else None
                            p_entry['name'] = f"{passenger.first_name} {passenger.last_name}".strip()
                            updated_itin = True
                    if updated_itin:
                        itin.passengers_data = p_list
            
            db_session.commit()
        except Exception as sync_err:
            print(f"Sync error: {sync_err}")
        
        return jsonify({
            "message": "Passenger updated successfully",
            "passenger": passenger.to_dict()
        })
        
    except Exception as e:
        db_session.rollback()
        return jsonify({"error": f"Failed to update passenger: {str(e)}"}), 500


@api_v2.route('/passengers/<passenger_id>', methods=['DELETE'])
@login_required
def delete_passenger(passenger_id):
    """Delete a passenger (soft delete)."""
    try:
        passenger = db_session.query(Passenger).filter_by(
            id=passenger_id, **get_org_scope()
        ).first()
        
        if not passenger:
            return jsonify({"error": "Passenger not found"}), 404
        
        passenger.is_active = False
        db_session.commit()
        
        return jsonify({"message": "Passenger deleted successfully"})
        
    except Exception as e:
        db_session.rollback()
        return jsonify({"error": f"Failed to delete passenger: {str(e)}"}), 500


# ==================== PASSENGER FREQUENT FLYER ROUTES ====================

@api_v2.route('/passengers/<passenger_id>/frequent-flyer', methods=['GET'])
@login_required
def get_passenger_frequent_flyer(passenger_id):
    """Get frequent flyer accounts for a passenger."""
    if not db_session.query(Passenger.id).filter(
        Passenger.id == passenger_id,
        Passenger.organization_id == session.get("organization_id"),
        Passenger.is_active == True,
    ).first():
        return jsonify({"error": "Passenger not found"}), 404

    accounts = db_session.query(PassengerFrequentFlyer).options(
        joinedload(PassengerFrequentFlyer.airline).load_only(
            Airline.id,
            Airline.iata_code,
            Airline.name,
        )
    ).filter(
        PassengerFrequentFlyer.passenger_id == passenger_id,
        PassengerFrequentFlyer.is_active == True,
        PassengerFrequentFlyer.passenger.has(organization_id=session.get('organization_id'), is_active=True),
    ).order_by(PassengerFrequentFlyer.created_at.desc()).all()
    return jsonify({"frequent_flyer_accounts": [ff.to_dict() for ff in accounts]})


@api_v2.route('/passengers/<passenger_id>/frequent-flyer', methods=['POST'])
@login_required
def create_passenger_frequent_flyer(passenger_id):
    """Create a frequent flyer account for a passenger."""
    try:
        passenger = db_session.query(Passenger).filter_by(
            id=passenger_id, **get_org_scope()
        ).first()
        
        if not passenger:
            return jsonify({"error": "Passenger not found"}), 404
        
        data = request.get_json()
        
        if not data.get('airline_id') or not data.get('frequent_flyer_number'):
            return jsonify({"error": "Airline and frequent flyer number are required"}), 400
        
        ff = PassengerFrequentFlyer(
            passenger_id=passenger_id,
            airline_id=data['airline_id'],
            frequent_flyer_number=data['frequent_flyer_number'],
            tier_status=data.get('tier_status'),
            miles_balance=data.get('miles_balance'),
            tier_expiry_date=parse_date(data.get('tier_expiry_date'))
        )
        
        db_session.add(ff)
        db_session.commit()
        
        return jsonify({
            "message": "Frequent flyer account added successfully",
            "frequent_flyer": ff.to_dict()
        }), 201
        
    except Exception as e:
        db_session.rollback()
        return jsonify({"error": f"Failed to add frequent flyer account: {str(e)}"}), 500


@api_v2.route('/passengers/<passenger_id>/frequent-flyer/<ff_id>', methods=['PUT'])
@login_required
def update_passenger_frequent_flyer(passenger_id, ff_id):
    """Update a frequent flyer account."""
    try:
        passenger = db_session.query(Passenger).filter_by(
            id=passenger_id, **get_org_scope()
        ).first()
        
        if not passenger:
            return jsonify({"error": "Passenger not found"}), 404
        
        ff = db_session.query(PassengerFrequentFlyer).filter_by(
            id=ff_id,
            passenger_id=passenger_id
        ).first()
        
        if not ff:
            return jsonify({"error": "Frequent flyer account not found"}), 404
        
        data = request.get_json()
        
        for field in ['frequent_flyer_number', 'tier_status', 'miles_balance', 'is_active']:
            if field in data:
                setattr(ff, field, data[field])
        
        if 'tier_expiry_date' in data:
            ff.tier_expiry_date = parse_date(data['tier_expiry_date'])
        
        db_session.commit()
        
        return jsonify({
            "message": "Frequent flyer account updated successfully",
            "frequent_flyer": ff.to_dict()
        })
        
    except Exception as e:
        db_session.rollback()
        return jsonify({"error": f"Failed to update frequent flyer account: {str(e)}"}), 500


@api_v2.route('/passengers/<passenger_id>/frequent-flyer/<ff_id>', methods=['DELETE'])
@login_required
def delete_passenger_frequent_flyer(passenger_id, ff_id):
    """Delete a frequent flyer account."""
    try:
        passenger = db_session.query(Passenger).filter_by(
            id=passenger_id, **get_org_scope()
        ).first()
        
        if not passenger:
            return jsonify({"error": "Passenger not found"}), 404
        
        ff = db_session.query(PassengerFrequentFlyer).filter_by(
            id=ff_id,
            passenger_id=passenger_id
        ).first()
        
        if not ff:
            return jsonify({"error": "Frequent flyer account not found"}), 404
        
        ff.is_active = False
        db_session.commit()
        
        return jsonify({"message": "Frequent flyer account deleted successfully"})
        
    except Exception as e:
        db_session.rollback()
        return jsonify({"error": f"Failed to delete frequent flyer account: {str(e)}"}), 500


# ==================== PASSENGER PREFERENCES ROUTES ====================

@api_v2.route('/passengers/<passenger_id>/preferences', methods=['GET'])
@login_required
def get_passenger_preferences(passenger_id):
    """Get preferences for a passenger."""
    passenger = db_session.query(Passenger).filter_by(
        id=passenger_id, **get_org_scope()
    ).first()
    
    if not passenger:
        return jsonify({"error": "Passenger not found"}), 404
    
    if passenger.preferences:
        return jsonify(passenger.preferences.to_dict())
    return jsonify({})


@api_v2.route('/passengers/<passenger_id>/preferences', methods=['POST', 'PUT'])
@login_required
def save_passenger_preferences(passenger_id):
    """Save or update preferences for a passenger."""
    try:
        passenger = db_session.query(Passenger).filter_by(
            id=passenger_id, **get_org_scope()
        ).first()
        
        if not passenger:
            return jsonify({"error": "Passenger not found"}), 404
        
        data = request.get_json()
        
        if passenger.preferences:
            prefs = passenger.preferences
        else:
            prefs = PassengerPreferences(passenger_id=passenger_id)
            db_session.add(prefs)
        
        for field in ['meal_preference', 'meal_special_request', 'seat_preference',
                      'seat_location', 'preferred_cabin_class', 'wheelchair_required',
                      'special_assistance_type', 'special_assistance_notes',
                      'preferred_airlines', 'avoid_airlines']:
            if field in data:
                setattr(prefs, field, data[field])
        
        db_session.commit()
        
        return jsonify({
            "message": "Preferences saved successfully",
            "preferences": prefs.to_dict()
        })
        
    except Exception as e:
        db_session.rollback()
        return jsonify({"error": f"Failed to save preferences: {str(e)}"}), 500


# ==================== PASSENGER TRAVEL DOCUMENTS ROUTES ====================

@api_v2.route('/passengers/<passenger_id>/documents', methods=['GET'])
@login_required
def get_passenger_documents(passenger_id):
    """Get travel documents for a passenger."""
    if not db_session.query(Passenger.id).filter(
        Passenger.id == passenger_id,
        Passenger.organization_id == session.get("organization_id"),
        Passenger.is_active == True,
    ).first():
        return jsonify({"error": "Passenger not found"}), 404

    documents = db_session.query(PassengerTravelDocument).filter(
        PassengerTravelDocument.passenger_id == passenger_id,
        PassengerTravelDocument.is_active == True,
        PassengerTravelDocument.passenger.has(organization_id=session.get('organization_id'), is_active=True),
    ).order_by(PassengerTravelDocument.created_at.desc()).all()
    return jsonify({"documents": [doc.to_dict() for doc in documents]})


@api_v2.route('/passengers/<passenger_id>/documents', methods=['POST'])
@login_required
def create_passenger_document(passenger_id):
    """Create a travel document for a passenger."""
    try:
        passenger = db_session.query(Passenger).filter_by(
            id=passenger_id, **get_org_scope()
        ).first()
        
        if not passenger:
            return jsonify({"error": "Passenger not found"}), 404
        
        data = request.get_json()
        
        if not data.get('document_type') or not data.get('document_number'):
            return jsonify({"error": "Document type and number are required"}), 400
        
        doc = PassengerTravelDocument(
            passenger_id=passenger_id,
            document_type=data['document_type'],
            document_number=data['document_number'],
            issuing_country=data.get('issuing_country'),
            issue_date=parse_date(data.get('issue_date')),
            expiry_date=parse_date(data.get('expiry_date')),
            name_on_document=data.get('name_on_document'),
            is_primary=data.get('is_primary', False)
        )
        
        db_session.add(doc)
        db_session.commit()
        
        return jsonify({
            "message": "Document added successfully",
            "document": doc.to_dict()
        }), 201
        
    except Exception as e:
        db_session.rollback()
        return jsonify({"error": f"Failed to add document: {str(e)}"}), 500


@api_v2.route('/passengers/<passenger_id>/documents/<doc_id>', methods=['PUT'])
@login_required
def update_passenger_document(passenger_id, doc_id):
    """Update a travel document."""
    try:
        passenger = db_session.query(Passenger).filter_by(
            id=passenger_id, **get_org_scope()
        ).first()
        
        if not passenger:
            return jsonify({"error": "Passenger not found"}), 404
        
        doc = db_session.query(PassengerTravelDocument).filter_by(
            id=doc_id,
            passenger_id=passenger_id
        ).first()
        
        if not doc:
            return jsonify({"error": "Document not found"}), 404
        
        data = request.get_json()
        
        for field in ['document_type', 'document_number', 'issuing_country',
                      'name_on_document', 'is_primary', 'is_active']:
            if field in data:
                setattr(doc, field, data[field])
        
        if 'issue_date' in data:
            doc.issue_date = parse_date(data['issue_date'])
        if 'expiry_date' in data:
            doc.expiry_date = parse_date(data['expiry_date'])
        
        db_session.commit()
        
        return jsonify({
            "message": "Document updated successfully",
            "document": doc.to_dict()
        })
        
    except Exception as e:
        db_session.rollback()
        return jsonify({"error": f"Failed to update document: {str(e)}"}), 500


@api_v2.route('/passengers/<passenger_id>/documents/<doc_id>', methods=['DELETE'])
@login_required
def delete_passenger_document(passenger_id, doc_id):
    """Delete a travel document."""
    try:
        passenger = db_session.query(Passenger).filter_by(
            id=passenger_id, **get_org_scope()
        ).first()
        
        if not passenger:
            return jsonify({"error": "Passenger not found"}), 404
        
        doc = db_session.query(PassengerTravelDocument).filter_by(
            id=doc_id,
            passenger_id=passenger_id
        ).first()
        
        if not doc:
            return jsonify({"error": "Document not found"}), 404
        
        doc.is_active = False
        db_session.commit()
        
        return jsonify({"message": "Document deleted successfully"})
        
    except Exception as e:
        db_session.rollback()
        return jsonify({"error": f"Failed to delete document: {str(e)}"}), 500


# ==================== CORPORATE-PASSENGER LINK ROUTES ====================

@api_v2.route('/corporates/<corporate_id>/passengers', methods=['GET'])
@login_required
def get_corporate_passengers(corporate_id):
    """Get all passengers linked to a corporate."""
    corporate = db_session.query(Corporate).filter_by(
        id=corporate_id, **get_org_scope()
    ).first()
    
    if not corporate:
        return jsonify({"error": "Corporate not found"}), 404
    
    links = [link.to_dict() for link in corporate.passenger_links if link.is_active]
    return jsonify({"passengers": links})


@api_v2.route('/corporates/<corporate_id>/passengers', methods=['POST'])
@login_required
def link_passenger_to_corporate(corporate_id):
    """Link a passenger to a corporate."""
    try:
        corporate = db_session.query(Corporate).filter_by(
            id=corporate_id, **get_org_scope()
        ).first()
        
        if not corporate:
            return jsonify({"error": "Corporate not found"}), 404
        
        data = request.get_json()
        
        if not data.get('passenger_id'):
            return jsonify({"error": "Passenger ID is required"}), 400
        
        # Verify passenger exists and belongs to user
        passenger = db_session.query(Passenger).filter_by(
            id=data['passenger_id'], **get_org_scope()
        ).first()
        
        if not passenger:
            return jsonify({"error": "Passenger not found"}), 404
        
        # Check if link already exists
        existing = db_session.query(CorporatePassenger).filter_by(
            corporate_id=corporate_id,
            passenger_id=data['passenger_id']
        ).first()
        
        if existing:
            if existing.is_active:
                return jsonify({"error": "Passenger already linked to this corporate"}), 400
            else:
                existing.is_active = True
                existing.role = data.get('role')
                existing.department = data.get('department')
                existing.employee_id = data.get('employee_id')
                existing.cost_center = data.get('cost_center')
                existing.remarks = data.get('remarks')
                db_session.commit()
                return jsonify({
                    "message": "Passenger link restored",
                    "link": existing.to_dict()
                })
        
        link = CorporatePassenger(
            corporate_id=corporate_id,
            passenger_id=data['passenger_id'],
            employee_id=data.get('employee_id'),
            role=data.get('role'),
            department=data.get('department'),
            cost_center=data.get('cost_center'),
            remarks=data.get('remarks'),
            requires_approval=data.get('requires_approval', False),
            approval_limit=data.get('approval_limit')
        )
        
        db_session.add(link)
        db_session.commit()
        
        return jsonify({
            "message": "Passenger linked successfully",
            "link": link.to_dict()
        }), 201
        
    except Exception as e:
        db_session.rollback()
        return jsonify({"error": f"Failed to link passenger: {str(e)}"}), 500


@api_v2.route('/corporates/<corporate_id>/passengers/<link_id>', methods=['DELETE'])
@login_required
def unlink_passenger_from_corporate(corporate_id, link_id):
    """Unlink a passenger from a corporate."""
    try:
        corporate = db_session.query(Corporate).filter_by(
            id=corporate_id, **get_org_scope()
        ).first()
        
        if not corporate:
            return jsonify({"error": "Corporate not found"}), 404
        
        link = db_session.query(CorporatePassenger).filter_by(
            id=link_id,
            corporate_id=corporate_id
        ).first()
        
        if not link:
            return jsonify({"error": "Link not found"}), 404
        
        link.is_active = False
        db_session.commit()
        
        return jsonify({"message": "Passenger unlinked successfully"})
        
    except Exception as e:
        db_session.rollback()
        return jsonify({"error": f"Failed to unlink passenger: {str(e)}"}), 500


# ==================== ITINERARY ROUTES ====================

@api_v2.route('/itineraries', methods=['GET'])
@login_required
def get_itineraries():
    """Get all itineraries for the logged-in user."""
    status_filter = request.args.get('status')
    passenger_id = request.args.get('passenger_id')
    corporate_id = request.args.get('corporate_id')
    try:
        limit = max(int(request.args.get('limit', 0) or 0), 0)
    except (TypeError, ValueError):
        limit = 0
    try:
        offset = max(int(request.args.get('offset', 0) or 0), 0)
    except (TypeError, ValueError):
        offset = 0
    
    query = db_session.query(Itinerary).options(
        *_itinerary_summary_options()
    ).filter_by(**get_org_scope())
    
    if status_filter:
        query = query.filter_by(status=status_filter)
    if passenger_id:
        query = query.filter_by(passenger_id=passenger_id)
    if corporate_id:
        query = query.filter_by(corporate_id=corporate_id)
    
    query = query.order_by(Itinerary.created_at.desc())
    fetch_limit = limit + 1 if limit else 0
    itineraries_query = query.offset(offset)
    if fetch_limit:
        itineraries_query = itineraries_query.limit(fetch_limit)
    itineraries = itineraries_query.all()
    has_more = bool(limit and len(itineraries) > limit)
    if has_more:
        itineraries = itineraries[:limit]
    returned_count = len(itineraries)
    total_count = len(itineraries) if not limit else (offset + returned_count + (1 if has_more else 0))
    
    return jsonify({
        "itineraries": [it.to_summary_dict(include_flights=False) for it in itineraries],
        "total_count": total_count,
        "offset": offset,
        "returned_count": returned_count,
        "has_more": has_more,
    })


@api_v2.route('/itineraries', methods=['POST'])
@login_required
def create_itinerary():
    """Create a new itinerary."""
    try:
        data = request.get_json()
        
        def safe_float(val):
            if val is None or val == '':
                return None
            try:
                return float(val)
            except (ValueError, TypeError):
                return None

        itinerary = Itinerary(
            title=data.get('title'),
            description=data.get('description'),
            reference_number=data.get('reference_number'),
            trip_type=data.get('trip_type', 'one_way'),
            status=data.get('status', 'draft'),
            flights_data=_json_or_none(data.get('flights', [])),
            parser_output_text=data.get('parser_output_text') or data.get('final_text'),
            raw_input_data=_json_or_none(data.get('raw_input_data')),
            selected_flight_option=data.get('selected_flight_option'),
            total_amount=safe_float(data.get('total_amount')),
            markup=safe_float(data.get('markup')),
            service_charge=safe_float(data.get('service_charge')),
            gst_amount=safe_float(data.get('gst_amount')),
            discount_amount=safe_float(data.get('discount_amount')),
            promo_code_used=data.get('promo_code_used'),
            billing_type='corporate' if (data.get('bill_to_company') or data.get('bill_to_gst')) else data.get('billing_type', 'personal'),
            bill_to_name=data.get('bill_to_name'),
            bill_to_email=data.get('bill_to_email'),
            bill_to_phone=data.get('bill_to_phone'),
            bill_to_address=data.get('bill_to_address'),
            bill_to_company=data.get('bill_to_company'),
            bill_to_gst=data.get('bill_to_gst'),
            requires_approval=data.get('requires_approval', False),
            num_passengers=int(safe_float(data.get('num_passengers')) or 1),
            passengers_data=_json_or_none(data.get('passengers_data', [])),
            passenger_id=data.get('passenger_id'),
            corporate_id=data.get('corporate_id'),
            billing_account_id=data.get('billing_account_id'),
            user_id=session['user_id'],
            supplier_account_id=data.get('supplier_account_id'),
            supplier_name=data.get('supplier_name'),
            supplier_email=data.get('supplier_email'),
            supplier_phone=data.get('supplier_phone'),
            supplier_address=data.get('supplier_address'),
            supplier_company=data.get('supplier_company'),
            supplier_gst=data.get('supplier_gst'),
            **get_org_scope()
        )
        
        db_session.add(itinerary)
        db_session.commit()
        
        detail_itinerary = _get_itinerary_detail_record(itinerary.id, session['user_id'], include_flights=True)
        return jsonify({
            "message": "Itinerary created successfully",
            "itinerary": detail_itinerary.to_detail_dict(include_flights=True)
        }), 201
        
    except Exception as e:
        db_session.rollback()
        return jsonify({"error": f"Failed to create itinerary: {str(e)}"}), 500


@api_v2.route('/itineraries/<itinerary_id>', methods=['GET'])
@login_required
def get_itinerary(itinerary_id):
    """Get a specific itinerary with full details."""
    itinerary = _get_itinerary_detail_record(itinerary_id, session['user_id'], include_flights=True)
    
    if not itinerary:
        return jsonify({"error": "Itinerary not found"}), 404
    
    return jsonify(itinerary.to_detail_dict(include_flights=True))


@api_v2.route('/itineraries/<itinerary_id>', methods=['PUT'])
@login_required
def update_itinerary(itinerary_id):
    """Update an itinerary."""
    from sqlalchemy.orm.attributes import flag_modified
    try:
        response_wants_flights = request.args.get('response') == 'detail'
        itinerary = _get_itinerary_detail_record(itinerary_id, session['user_id'], include_flights=response_wants_flights)
        
        if not itinerary:
            return jsonify({"error": "Itinerary not found"}), 404
        
        data = request.get_json()
        
        # Update fields
        numeric_fields = ['total_amount', 'markup', 'service_charge', 'gst_amount', 'discount_amount', 'num_passengers']
        
        def safe_float(val):
            if val is None or val == '':
                return None
            try:
                return float(val)
            except (ValueError, TypeError):
                return None

        for field in ['title', 'description', 'status', 'selected_flight_option',
                      'total_amount', 'markup', 'service_charge', 'gst_amount',
                      'discount_amount', 'promo_code_used',
                      'bill_to_name', 'bill_to_email', 'bill_to_phone',
                      'bill_to_address', 'bill_to_company', 'bill_to_gst',
                      'supplier_account_id', 'supplier_name', 'supplier_email',
                      'supplier_phone', 'supplier_address', 'supplier_company', 'supplier_gst',
                      'requires_approval', 'approved_by', 'approval_remarks',
                      'passenger_id', 'corporate_id', 'parser_output_text',
                      'num_passengers', 'billing_account_id',
                      'reference_number', 'trip_type']:
            if field in data:
                val = data[field]
                if field in numeric_fields:
                    val = safe_float(val)
                setattr(itinerary, field, val)
        
        # Auto-detect billing_type
        if 'bill_to_company' in data or 'bill_to_gst' in data:
            c_name = data.get('bill_to_company', itinerary.bill_to_company)
            gst = data.get('bill_to_gst', itinerary.bill_to_gst)
            itinerary.billing_type = 'corporate' if (c_name or gst) else 'personal'
        elif 'billing_type' in data:
            itinerary.billing_type = data['billing_type']
        
        if 'passengers_data' in data:
            incoming_pax = data['passengers_data']
            itinerary.passengers_data = _json_or_none(incoming_pax)
            flag_modified(itinerary, "passengers_data")
            import logging
            logging.getLogger(__name__).info(
                "UPDATE passengers_data for itin %s: %d passengers received",
                itinerary_id, len(incoming_pax) if isinstance(incoming_pax, list) else 0
            )
        
        if 'flights' in data:
            itinerary.flights_data = _json_or_none(data['flights'])
            flag_modified(itinerary, "flights_data")
        
        if 'raw_input_data' in data:
            itinerary.raw_input_data = _json_or_none(data['raw_input_data'])
            flag_modified(itinerary, "raw_input_data")
        
        if 'final_text' in data:
            itinerary.parser_output_text = data['final_text']
        
        # Status workflow timestamps
        if data.get('status') == 'approved' and not itinerary.approved_at:
            itinerary.approved_at = datetime.utcnow()
        if data.get('status') == 'on_hold' and not itinerary.held_at:
            itinerary.held_at = datetime.utcnow()
        if data.get('status') == 'confirmed' and not itinerary.confirmed_at:
            itinerary.confirmed_at = datetime.utcnow()
        if data.get('status') == 'reverted':
            itinerary.reverted_at = datetime.utcnow()
        
        db_session.commit()
        db_session.expire(itinerary)
        
        detail_itinerary = _get_itinerary_detail_record(itinerary.id, session['user_id'], include_flights=response_wants_flights)
        return jsonify({
            "message": "Itinerary updated successfully",
            "itinerary": _itinerary_response(
                detail_itinerary,
                include_flights=response_wants_flights
            )
        })
        
    except Exception as e:
        db_session.rollback()
        return jsonify({"error": f"Failed to update itinerary: {str(e)}"}), 500


@api_v2.route('/itineraries/<itinerary_id>', methods=['DELETE'])
@login_required
def delete_itinerary(itinerary_id):
    """Delete an itinerary."""
    try:
        itinerary = db_session.query(Itinerary).filter_by(
            id=itinerary_id, **get_org_scope()
        ).first()
        
        if not itinerary:
            return jsonify({"error": "Itinerary not found"}), 404
        
        db_session.delete(itinerary)
        db_session.commit()
        
        return jsonify({"message": "Itinerary deleted successfully"})
        
    except Exception as e:
        db_session.rollback()
        return jsonify({"error": f"Failed to delete itinerary: {str(e)}"}), 500


@api_v2.route('/itineraries/<itinerary_id>/approve', methods=['POST'])
@login_required
def approve_itinerary(itinerary_id):
    """Approve an itinerary."""
    try:
        itinerary = db_session.query(Itinerary).filter_by(
            id=itinerary_id, **get_org_scope()
        ).first()
        
        if not itinerary:
            return jsonify({"error": "Itinerary not found"}), 404
        
        # Check if exactly one flight option is selected
        if itinerary.selected_flight_option is None:
            return jsonify({"error": "Please select a flight option before approving"}), 400
        
        data = request.get_json() or {}
        
        itinerary.status = 'approved'
        itinerary.approved_at = datetime.utcnow()
        itinerary.approved_by = data.get('approved_by', session.get('username', 'System'))
        itinerary.approval_remarks = data.get('remarks')
        
        db_session.commit()
        detail_itinerary = _get_itinerary_detail_record(itinerary.id, session['user_id'], include_flights=False)
        
        return jsonify({
            "message": "Itinerary approved successfully",
            "itinerary": _itinerary_response(detail_itinerary)
        })
        
    except Exception as e:
        db_session.rollback()
        return jsonify({"error": f"Failed to approve itinerary: {str(e)}"}), 500


# ==================== DASHBOARD STATS ====================

@api_v2.route('/itineraries/<itinerary_id>/hold', methods=['POST'])
@login_required
def hold_itinerary(itinerary_id):
    """Put an itinerary on hold."""
    try:
        itinerary = db_session.query(Itinerary).filter_by(
            id=itinerary_id, **get_org_scope()
        ).first()
        
        if not itinerary:
            return jsonify({"error": "Itinerary not found"}), 404
        
        data = request.get_json() or {}
        deadline_str = data.get('deadline')
        
        itinerary.status = 'on_hold'
        itinerary.held_at = datetime.utcnow()
        if deadline_str:
            try:
                # Expecting ISO format or similar
                itinerary.hold_deadline = datetime.fromisoformat(deadline_str.replace('Z', '+00:00'))
            except ValueError:
                # Fallback or allow null if parsing fails
                pass
        else:
            itinerary.hold_deadline = None
        
        db_session.commit()
        detail_itinerary = _get_itinerary_detail_record(itinerary.id, session['user_id'], include_flights=False)
        
        return jsonify({
            "message": "Itinerary put on hold",
            "itinerary": _itinerary_response(detail_itinerary)
        })
        
    except Exception as e:
        db_session.rollback()
        return jsonify({"error": f"Failed to hold itinerary: {str(e)}"}), 500


@api_v2.route('/itineraries/<itinerary_id>/confirm', methods=['POST'])
@login_required
def confirm_itinerary(itinerary_id):
    """Confirm an itinerary."""
    try:
        itinerary = db_session.query(Itinerary).filter_by(
            id=itinerary_id, **get_org_scope()
        ).first()
        
        if not itinerary:
            return jsonify({"error": "Itinerary not found"}), 404
        
        itinerary.status = 'issued'
        itinerary.confirmed_at = datetime.utcnow()
        
        db_session.commit()
        detail_itinerary = _get_itinerary_detail_record(itinerary.id, session['user_id'], include_flights=False)
        
        return jsonify({
            "message": "Itinerary confirmed",
            "itinerary": _itinerary_response(detail_itinerary)
        })
        
    except Exception as e:
        db_session.rollback()
        return jsonify({"error": f"Failed to confirm itinerary: {str(e)}"}), 500


@api_v2.route('/itineraries/<itinerary_id>/revert', methods=['POST'])
@login_required
def revert_itinerary(itinerary_id):
    """Revert itinerary back to approved for editing."""
    try:
        itinerary = db_session.query(Itinerary).filter_by(
            id=itinerary_id, **get_org_scope()
        ).first()
        
        if not itinerary:
            return jsonify({"error": "Itinerary not found"}), 404
        
        itinerary.status = 'approved'
        itinerary.reverted_at = datetime.utcnow()
        
        db_session.commit()
        detail_itinerary = _get_itinerary_detail_record(itinerary.id, session['user_id'], include_flights=False)
        
        return jsonify({
            "message": "Itinerary reverted to approved",
            "itinerary": _itinerary_response(detail_itinerary)
        })
        
    except Exception as e:
        db_session.rollback()
        return jsonify({"error": f"Failed to revert itinerary: {str(e)}"}), 500


@api_v2.route('/dashboard/stats', methods=['GET'])
@login_required
def get_dashboard_stats():
    """Get dashboard statistics."""
    user_id = session['user_id']
    
    # Count entities
    corporates_count = db_session.query(Corporate).filter_by(
        user_id=user_id, is_active=True
    ).count()
    
    passengers_count = db_session.query(Passenger).filter_by(
        user_id=user_id, is_active=True
    ).count()
    
    # Itinerary stats
    total_itineraries = db_session.query(Itinerary).filter_by(**get_org_scope()).count()
    draft_count = db_session.query(Itinerary).filter_by(status='draft', **get_org_scope()).count()
    approved_count = db_session.query(Itinerary).filter_by(status='approved', **get_org_scope()).count()
    on_hold_count = db_session.query(Itinerary).filter_by(status='on_hold', **get_org_scope()).count()
    confirmed_count = db_session.query(Itinerary).filter(
        Itinerary.status.in_(['confirmed', 'issued'])
    ).filter_by(**get_org_scope()).count()
    
    # Revenue stats
    from sqlalchemy import func
    total_revenue = db_session.query(func.sum(Itinerary.total_amount)).filter(
        Itinerary.user_id == user_id, 
        Itinerary.status.in_(['confirmed', 'issued'])
    ).scalar() or 0
    
    pending_revenue = db_session.query(func.sum(Itinerary.total_amount)).filter(
        Itinerary.user_id == user_id,
        Itinerary.status.in_(['draft', 'approved', 'on_hold'])
    ).scalar() or 0
    
    # Recent itineraries
    recent_itineraries = db_session.query(Itinerary).options(
        *_itinerary_summary_options()
    ).filter_by(
        user_id=user_id
    ).order_by(Itinerary.created_at.desc()).limit(5).all()
    
    return jsonify({
        "corporates_count": corporates_count,
        "passengers_count": passengers_count,
        "total_itineraries": total_itineraries,
        "draft_count": draft_count,
        "approved_count": approved_count,
        "on_hold_count": on_hold_count,
        "confirmed_count": confirmed_count,
        "total_revenue": total_revenue,
        "pending_revenue": pending_revenue,
        "recent_itineraries": [it.to_summary_dict(include_flights=False) for it in recent_itineraries]
    })


# ==================== BILLING ACCOUNT ROUTES ====================

@api_v2.route('/billing-accounts', methods=['GET'])
@login_required
def get_billing_accounts():
    """Get all billing accounts for the current user."""
    accounts = db_session.query(BillingAccount).filter_by(
        user_id=session['user_id'],
        is_active=True
    ).order_by(BillingAccount.display_name.asc()).all()
    
    return jsonify({
        "billing_accounts": [acc.to_dict() for acc in accounts]
    })


@api_v2.route('/billing-accounts', methods=['POST'])
@login_required
def create_billing_account():
    """Create a new billing account."""
    try:
        data = request.get_json()
        print(f"DEBUG: Billing account POST data: {data}")
        
        required_fields = ['account_type', 'display_name']
        if not all(field in data for field in required_fields):
            return jsonify({"error": "Missing required fields"}), 400
            
        company_name = data.get('company_name')
        gst_number = data.get('gst_number')
        
        # Auto-detect account type
        account_type = 'corporate' if (company_name or gst_number) else 'personal'
            
        account = BillingAccount(
            account_type=account_type,
            display_name=data['display_name'],
            company_name=company_name,
            contact_name=data.get('contact_name') or data['display_name'],
            email=data.get('email'),
            phone=data.get('phone'),
            address=data.get('address'),
            gst_number=gst_number,
            passenger_id=data.get('passenger_id'),
            corporate_id=data.get('corporate_id'), 
            user_id=session['user_id'],
            **get_org_scope()
        )
        
        print(f"Creating billing account: {account.display_name} for user {account.user_id}")
        db_session.add(account)
        db_session.commit()
        print(f"Billing account created with ID: {account.id}")
        
        return jsonify({
            "message": "Billing account created successfully",
            "billing_account": account.to_dict()
        }), 201
        
    except Exception as e:
        db_session.rollback()
        return jsonify({"error": f"Failed to create billing account: {str(e)}"}), 500


@api_v2.route('/billing-accounts/<account_id>', methods=['GET'])
@login_required
def get_billing_account(account_id):
    """Get a specific billing account."""
    account = db_session.query(BillingAccount).filter_by(
        id=account_id, **get_org_scope()
    ).first()
    
    if not account:
        return jsonify({"error": "Billing account not found"}), 404
    
    return jsonify(account.to_dict())


@api_v2.route('/billing-accounts/<account_id>', methods=['PUT'])
@login_required
def update_billing_account(account_id):
    """Update a billing account."""
    try:
        account = db_session.query(BillingAccount).filter_by(
            id=account_id, **get_org_scope()
        ).first()
        
        if not account:
            return jsonify({"error": "Billing account not found"}), 404
        
        data = request.get_json()
        
        # Auto-detect account type if relevant fields are being updated
        company_name = data.get('company_name', account.company_name)
        gst_number = data.get('gst_number', account.gst_number)
        
        if 'company_name' in data or 'gst_number' in data:
            account.account_type = 'corporate' if (company_name or gst_number) else 'personal'
            
        for field in ['display_name', 'company_name', 'contact_name',
                      'email', 'phone', 'address', 'gst_number',
                      'passenger_id', 'corporate_id']:
            if field in data:
                setattr(account, field, data[field])
        
        db_session.commit()
        
        return jsonify({
            "message": "Billing account updated successfully",
            "billing_account": account.to_dict()
        })
        
    except Exception as e:
        db_session.rollback()
        return jsonify({"error": f"Failed to update billing account: {str(e)}"}), 500


@api_v2.route('/billing-accounts/<account_id>', methods=['DELETE'])
@login_required
def delete_billing_account(account_id):
    """Delete (deactivate) a billing account."""
    try:
        account = db_session.query(BillingAccount).filter_by(
            id=account_id, **get_org_scope()
        ).first()
        
        if not account:
            return jsonify({"error": "Billing account not found"}), 404
        
        account.is_active = False
        db_session.commit()
        
        return jsonify({"message": "Billing account deleted successfully"})
        
    except Exception as e:
        db_session.rollback()
        return jsonify({"error": f"Failed to delete billing account: {str(e)}"}), 500


@api_v2.route('/billing-accounts/<account_id>/passengers', methods=['GET'])
@login_required
def get_billing_account_passengers(account_id):
    """Get all passengers linked to a billing account's underlying entity."""
    try:
        account = db_session.query(BillingAccount).filter_by(
            id=account_id, **get_org_scope(), is_active=True
        ).first()
        
        if not account:
            return jsonify({"error": "Billing account not found"}), 404
            
        passengers = []
        
        if account.account_type == "corporate" and account.corporate_id:
            # Get passengers linked to this corporate
            links = db_session.query(CorporatePassenger).filter_by(
                corporate_id=account.corporate_id, 
                is_active=True,
                **get_org_scope()
            ).all()
            
            for link in links:
                if link.passenger and link.passenger.is_active:
                    passengers.append(link.passenger.to_dict())
                    
        elif account.account_type == "individual" and account.passenger_id:
            # Just return the single passenger
            passenger = db_session.query(Passenger).filter_by(
                id=account.passenger_id,
                is_active=True,
                **get_org_scope()
            ).first()
            if passenger:
                passengers.append(passenger.to_dict())
                
        return jsonify({
            "passengers": passengers
        })
        
    except Exception as e:
        return jsonify({"error": f"Failed to fetch billing account passengers: {str(e)}"}), 500



# ==================== SUPPLIER ACCOUNT ROUTES ====================

@api_v2.route('/suppliere-accounts', methods=['GET'])
@api_v2.route('/supplier-accounts', methods=['GET'])
@login_required
def get_supplier_accounts():
    """Get all supplier accounts for the current user."""
    accounts = db_session.query(SupplierAccount).filter_by(
        user_id=session['user_id'],
        is_active=True
    ).order_by(SupplierAccount.display_name.asc()).all()
    
    return jsonify({
        "supplier_accounts": [acc.to_dict() for acc in accounts]
    })


@api_v2.route('/supplier-accounts', methods=['POST'])
@login_required
def create_supplier_account():
    """Create a new supplier account."""
    try:
        data = request.get_json()
        
        required_fields = ['account_type', 'display_name']
        if not all(field in data for field in required_fields):
            return jsonify({"error": "Missing required fields"}), 400
            
        account = SupplierAccount(
            user_id=session['user_id'],
            account_type=data['account_type'],
            display_name=data['display_name'],
            company_name=data.get('company_name'),
            contact_name=data.get('contact_name') or data['display_name'],
            email=data.get('email'),
            phone=data.get('phone'),
            address=data.get('address'),
            gst_number=data.get('gst_number'),
            **get_org_scope()
        )
        
        db_session.add(account)
        db_session.commit()
        
        return jsonify({
            "message": "Supplier account created successfully",
            "supplier_account": account.to_dict()
        }), 201
        
    except Exception as e:
        db_session.rollback()
        return jsonify({"error": f"Failed to create supplier account: {str(e)}"}), 500


@api_v2.route('/supplier-accounts/<account_id>', methods=['GET'])
@login_required
def get_supplier_account(account_id):
    """Get a specific supplier account."""
    account = db_session.query(SupplierAccount).filter_by(
        id=account_id, **get_org_scope()
    ).first()
    
    if not account:
        return jsonify({"error": "Supplier account not found"}), 404
    
    return jsonify(account.to_dict())


@api_v2.route('/supplier-accounts/<account_id>', methods=['PUT'])
@login_required
def update_supplier_account(account_id):
    """Update a supplier account."""
    try:
        account = db_session.query(SupplierAccount).filter_by(
            id=account_id, **get_org_scope()
        ).first()
        
        if not account:
            return jsonify({"error": "Supplier account not found"}), 404
        
        data = request.get_json()
        
        for field in ['account_type', 'display_name', 'company_name', 'contact_name',
                      'email', 'phone', 'address', 'gst_number']:
            if field in data:
                setattr(account, field, data[field])
        
        db_session.commit()
        
        return jsonify({
            "message": "Supplier account updated successfully",
            "supplier_account": account.to_dict()
        })
        
    except Exception as e:
        db_session.rollback()
        return jsonify({"error": f"Failed to update supplier account: {str(e)}"}), 500


@api_v2.route('/supplier-accounts/<account_id>', methods=['DELETE'])
@login_required
def delete_supplier_account(account_id):
    """Delete (deactivate) a supplier account."""
    try:
        account = db_session.query(SupplierAccount).filter_by(
            id=account_id, **get_org_scope()
        ).first()
        
        if not account:
            return jsonify({"error": "Supplier account not found"}), 404
        
        account.is_active = False
        db_session.commit()
        
        return jsonify({"message": "Supplier account deleted successfully"})
        
    except Exception as e:
        db_session.rollback()
        return jsonify({"error": f"Failed to delete supplier account: {str(e)}"}), 500
