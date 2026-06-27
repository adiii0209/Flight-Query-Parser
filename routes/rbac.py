from functools import wraps
from flask import Blueprint, request, jsonify, session
from extensions import db
from models import User
from models_rbac import (
    Organization, Membership, OrgInvitation,
    OrgType, Role, InvitationStatus
)
from routes.auth import get_org_scope

rbac_bp = Blueprint('rbac', __name__)

def _require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'error': 'Authentication required'}), 401
        return f(*args, **kwargs)
    return decorated

def _require_role(*allowed_roles):
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            role = session.get('role')
            if role == Role.PLATFORM_SUPER_ADMIN:
                return f(*args, **kwargs)
            if role not in allowed_roles:
                return jsonify({'error': 'Insufficient permissions'}), 403
            return f(*args, **kwargs)
        return decorated
    return decorator

@rbac_bp.route('/api/organizations', methods=['GET'])
@_require_auth
def list_organizations():
    role = session.get('role')
    if role == Role.PLATFORM_SUPER_ADMIN:
        orgs = Organization.query.all()
    else:
        memberships = Membership.query.filter_by(user_id=session['user_id']).all()
        orgs = [m.organization for m in memberships if m.organization]
    return jsonify({'organizations': [org.to_dict() for org in orgs]})

@rbac_bp.route('/api/organizations', methods=['POST'])
@_require_auth
@_require_role(Role.PLATFORM_SUPER_ADMIN)
def create_organization():
    data = request.get_json()
    name = data.get('name')
    org_type = data.get('org_type')
    if not name or not org_type:
        return jsonify({'error': 'name and org_type are required'}), 400
    slug = Organization.generate_slug(name)
    org = Organization(
        name=name,
        slug=slug,
        org_type=org_type,
        max_users=data.get('max_users'),
        created_by=session['user_id'],
        is_approved=True
    )
    db.session.add(org)
    db.session.commit()
    return jsonify(org.to_dict()), 201

@rbac_bp.route('/api/organizations/<org_id>', methods=['GET'])
@_require_auth
def get_organization(org_id):
    org = Organization.query.get_or_404(org_id)
    if session.get('role') != Role.PLATFORM_SUPER_ADMIN:
        m = Membership.query.filter_by(user_id=session['user_id'], organization_id=org_id).first()
        if not m:
            return jsonify({'error': 'Access denied'}), 403
    return jsonify(org.to_dict())

@rbac_bp.route('/api/organizations/<org_id>', methods=['PUT'])
@_require_auth
def update_organization(org_id):
    org = Organization.query.get_or_404(org_id)
    role = session.get('role')
    if role != Role.PLATFORM_SUPER_ADMIN:
        m = Membership.query.filter_by(user_id=session['user_id'], organization_id=org_id).first()
        if not m or m.role not in (Role.AGENCY_ADMIN, Role.CLIENT_ADMIN):
            return jsonify({'error': 'Access denied'}), 403
    
    data = request.get_json()
    if 'name' in data:
        org.name = data['name']
    if 'logo_url' in data:
        org.logo_url = data['logo_url']
    if 'settings' in data:
        org.settings = data['settings']
    db.session.commit()
    return jsonify(org.to_dict())

@rbac_bp.route('/api/invitations', methods=['POST'])
@_require_auth
@_require_role(Role.AGENCY_ADMIN, Role.PLATFORM_SUPER_ADMIN)
def create_invitation():
    data = request.get_json() or {}
    email = data.get('email')
    employee_id = data.get('employee_id')
    org_id = data.get('organization_id') or session.get('organization_id')
    
    print(f"DEBUG create_invitation: data={data}, email={email}, employee_id={employee_id}, org_id={org_id}")
    
    if not employee_id and not email:
        print("DEBUG create_invitation: returning 400 because no employee_id and no email")
        return jsonify({'error': 'employee_id or email is required'}), 400
        
    if not org_id:
        print("DEBUG create_invitation: returning 400 because no org_id")
        return jsonify({'error': 'organization_id is required'}), 400
        
    if session.get('role') != Role.PLATFORM_SUPER_ADMIN and org_id != session.get('organization_id'):
        return jsonify({'error': 'Access denied'}), 403
        
    org = Organization.query.get_or_404(org_id)
    
    # If the employee is already linked to a user, restore access instantly
    if employee_id:
        from models import OwnershipEmployee
        emp = OwnershipEmployee.query.filter_by(id=employee_id, organization_id=org.id).first()
        if emp and emp.user_id:
            m = Membership.query.filter_by(user_id=emp.user_id, organization_id=org.id).first()
            if m:
                m.is_active = True
                if m.role not in (Role.AGENCY_ADMIN, Role.AGENCY_EMPLOYEE):
                    m.role = Role.AGENCY_EMPLOYEE
            else:
                m = Membership(
                    user_id=emp.user_id,
                    organization_id=org.id,
                    role=Role.AGENCY_EMPLOYEE,
                    is_active=True
                )
                db.session.add(m)
            db.session.commit()
            return jsonify({
                'message': 'Access instantly restored', 
                'access_restored': True
            }), 200
    
    import secrets
    token = secrets.token_urlsafe(32)
    
    invitation = OrgInvitation(
        organization_id=org.id,
        email=email,
        employee_id=employee_id,
        token=token,
        role=Role.AGENCY_EMPLOYEE
    )
    db.session.add(invitation)
    db.session.commit()
    
    # In a real app, send an email here. We return the link for the UI to display.
    invite_link = request.host_url.rstrip('/') + f"/register?token={token}"
    return jsonify({'message': 'Invitation created', 'invite_link': invite_link, 'token': token}), 201

@rbac_bp.route('/api/invitations/verify', methods=['GET'])
def verify_invitation():
    token = request.args.get('token')
    if not token:
        return jsonify({'error': 'Token required'}), 400
    invitation = OrgInvitation.query.filter_by(token=token).first()
    if not invitation:
        return jsonify({'error': 'Invalid or expired token'}), 404
        
    return jsonify({
        'email': invitation.email, # Can be null if using employee_id flow
        'organization_name': invitation.organization.name
    })

@rbac_bp.route('/api/organizations/<org_id>/members', methods=['GET'])
@_require_auth
def get_organization_members(org_id):
    org = Organization.query.get_or_404(org_id)
    if session.get('role') != Role.PLATFORM_SUPER_ADMIN:
        m = Membership.query.filter_by(user_id=session['user_id'], organization_id=org_id).first()
        if not m or m.role not in (Role.AGENCY_ADMIN, Role.CLIENT_ADMIN):
            return jsonify({'error': 'Access denied'}), 403
            
    memberships = Membership.query.filter_by(organization_id=org_id).all()
    from models import OwnershipEmployee
    employees = OwnershipEmployee.query.filter_by(organization_id=org_id, is_active=True).all()
    
    members_dict = {}
    
    for m in memberships:
        user = m.user
        if not user:
            continue
        members_dict[user.id] = {
            'type': 'membership',
            'membership_id': m.id,
            'user_id': user.id,
            'employee_id': None,
            'name': user.full_name or user.username,
            'email': user.email,
            'role': m.role,
            'joined_at': m.joined_at.isoformat() if m.joined_at else None,
            'has_access': True
        }
        
    for emp in employees:
        if emp.user_id and emp.user_id in members_dict:
            members_dict[emp.user_id]['employee_id'] = emp.id
            members_dict[emp.user_id]['type'] = 'linked'
        else:
            members_dict[f'emp_{emp.id}'] = {
                'type': 'employee_only',
                'membership_id': None,
                'user_id': None,
                'employee_id': emp.id,
                'name': emp.name,
                'email': emp.email,
                'role': 'AGENCY_EMPLOYEE',
                'joined_at': None,
                'has_access': False
            }
            
    return jsonify({'members': list(members_dict.values())})

@rbac_bp.route('/api/organizations/<org_id>/members/<membership_id>', methods=['PUT'])
@_require_auth
def update_organization_member(org_id, membership_id):
    if session.get('role') != Role.PLATFORM_SUPER_ADMIN:
        m = Membership.query.filter_by(user_id=session['user_id'], organization_id=org_id).first()
        if not m or m.role not in (Role.AGENCY_ADMIN, Role.CLIENT_ADMIN):
            return jsonify({'error': 'Access denied'}), 403
            
    membership = Membership.query.filter_by(id=membership_id, organization_id=org_id).first_or_404()
    
    # Prevent removing last admin
    if membership.role in (Role.AGENCY_ADMIN, Role.CLIENT_ADMIN):
        admin_count = Membership.query.filter_by(organization_id=org_id, role=membership.role).count()
        if admin_count <= 1 and request.json.get('role') != membership.role:
            return jsonify({'error': 'Cannot change role of the last admin'}), 400
            
    data = request.get_json()
    if 'role' in data and data['role'] in Role.ALL:
        membership.role = data['role']
        
    db.session.commit()
    return jsonify(membership.to_dict())

@rbac_bp.route('/api/organizations/<org_id>/members/<membership_id>', methods=['DELETE'])
@_require_auth
def remove_organization_member(org_id, membership_id):
    if session.get('role') != Role.PLATFORM_SUPER_ADMIN:
        m = Membership.query.filter_by(user_id=session['user_id'], organization_id=org_id).first()
        if not m or m.role not in (Role.AGENCY_ADMIN, Role.CLIENT_ADMIN):
            return jsonify({'error': 'Access denied'}), 403
            
    membership = Membership.query.filter_by(id=membership_id, organization_id=org_id).first_or_404()
    
    # Prevent removing last admin
    if membership.role in (Role.AGENCY_ADMIN, Role.CLIENT_ADMIN):
        admin_count = Membership.query.filter_by(organization_id=org_id, role=membership.role).count()
        if admin_count <= 1:
            return jsonify({'error': 'Cannot remove the last admin'}), 400

    # Note: We do NOT disconnect the employee profile (user_id=None) here.
    # This allows us to instantly restore their access later without re-inviting.
    
    db.session.delete(membership)
    db.session.commit()
    return jsonify({'message': 'Member removed successfully'})

