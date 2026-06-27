from functools import wraps
from flask import Blueprint, request, jsonify, session, redirect, url_for, render_template
from extensions import db
from models import User
from models_rbac import (
    Organization, Membership, OrgInvitation,
    OrgType, Role, InvitationStatus, PERMISSIONS, has_permission
)

auth_bp = Blueprint('auth', __name__)

def login_required(f):
    """Enhanced login_required that also checks workspace selection."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            if not request.path.startswith('/api/'):
                return redirect(url_for('login_page', next=request.full_path if request.query_string else request.path))
            return jsonify({'error': 'Authentication required'}), 401
        # Require workspace selection (except for workspace/auth endpoints)
        exempt_prefixes = ('/api/workspace', '/api/logout', '/api/user', '/workspace')
        
        org_id = session.get('organization_id')
        role = session.get('role')
        
        if role != 'PLATFORM_SUPER_ADMIN':
            if org_id:
                # Security Check: Verify membership still exists
                m = Membership.query.filter_by(user_id=session['user_id'], organization_id=org_id).first()
                if not m:
                    # Access was revoked, clear workspace session
                    session.pop('organization_id', None)
                    session.pop('role', None)
                    session.pop('org_name', None)
                    session.pop('org_type', None)
                    session.pop('org_slug', None)
                    org_id = None
            
            if not org_id:
                if not any(request.path.startswith(p) for p in exempt_prefixes):
                    if request.path.startswith('/api/'):
                        return jsonify({'error': 'Workspace access revoked or not selected', 'requires_workspace_selection': True}), 403
                    return redirect('/workspace')
                    
        return f(*args, **kwargs)
    return decorated_function

def role_required(*allowed_roles):
    """Decorator that checks user role. PLATFORM_SUPER_ADMIN always passes."""
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            user_role = session.get('role')
            if user_role == 'PLATFORM_SUPER_ADMIN':
                return f(*args, **kwargs)
            if user_role not in allowed_roles:
                if request.path.startswith('/api/'):
                    return jsonify({'error': 'Insufficient permissions'}), 403
                return redirect('/')
            return f(*args, **kwargs)
        return decorated_function
    return decorator

def org_type_required(*allowed_types):
    """Decorator that restricts to specific org types."""
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            if session.get('role') == 'PLATFORM_SUPER_ADMIN':
                return f(*args, **kwargs)
            if session.get('org_type') not in allowed_types:
                if request.path.startswith('/api/'):
                    return jsonify({'error': 'Feature not available for your organization type'}), 403
                return redirect('/')
            return f(*args, **kwargs)
        return decorated_function
    return decorator

def get_org_scope():
    """Returns filter kwargs to scope queries to the current organization.
    Super admins see everything (returns empty dict)."""
    if session.get('role') == 'PLATFORM_SUPER_ADMIN':
        return {}
    return {'organization_id': session.get('organization_id')}

@auth_bp.route('/workspace')
def workspace_selector_page():
    if 'user_id' not in session:
        return redirect(url_for('login_page'))
    return render_template('workspace.html')

@auth_bp.route('/api/workspace/list', methods=['GET'])
def list_workspaces():
    if 'user_id' not in session:
        return jsonify({'error': 'Authentication required'}), 401
    memberships = Membership.query.filter_by(user_id=session['user_id'], is_active=True).all()
    workspaces = []
    for m in memberships:
        org = m.organization
        if org and org.is_active:
            workspaces.append({
                'organization_id': org.id,
                'name': org.name,
                'slug': org.slug,
                'org_type': org.org_type,
                'role': m.role,
                'is_approved': org.is_approved,
                'logo_url': org.logo_url,
            })
    return jsonify({'workspaces': workspaces})

@auth_bp.route('/api/workspace/switch', methods=['POST'])
def switch_workspace():
    if 'user_id' not in session:
        return jsonify({'error': 'Authentication required'}), 401
    data = request.get_json()
    org_id = data.get('organization_id') if data else None
    if not org_id:
        return jsonify({'error': 'organization_id required'}), 400
    membership = Membership.query.filter_by(
        user_id=session['user_id'], organization_id=org_id, is_active=True
    ).first()
    if not membership:
        return jsonify({'error': 'Invalid workspace'}), 403
    org = membership.organization
    if not org or not org.is_active:
        return jsonify({'error': 'Organization is inactive'}), 403
    session['organization_id'] = org.id
    session['role'] = membership.role
    session['org_name'] = org.name
    session['org_type'] = org.org_type
    session['org_slug'] = org.slug
    return jsonify({
        'message': 'Workspace switched',
        'organization_id': org.id,
        'org_name': org.name,
        'org_type': org.org_type,
        'role': membership.role,
    })

@auth_bp.route('/api/workspace/current', methods=['GET'])
def current_workspace():
    if 'user_id' not in session:
        return jsonify({'error': 'Authentication required'}), 401
    return jsonify({
        'organization_id': session.get('organization_id'),
        'org_name': session.get('org_name'),
        'org_type': session.get('org_type'),
        'role': session.get('role'),
        'org_slug': session.get('org_slug'),
    })

@auth_bp.route('/api/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'success': True})

@auth_bp.route('/api/register/agency', methods=['POST'])
def register_agency():
    """Register a new travel agency — creates org + admin user."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Missing request body'}), 400
        agency_name = (data.get('agency_name') or '').strip()
        username = (data.get('username') or '').strip()
        email = (data.get('email') or '').strip().lower()
        password = data.get('password') or ''
        full_name = (data.get('full_name') or '').strip()
        if not agency_name or not username or not email or not password:
            return jsonify({'error': 'Missing required fields: agency_name, username, email, password'}), 400
        # Check uniqueness
        if User.query.filter_by(username=username).first():
            return jsonify({'error': 'Username already exists'}), 400
        if User.query.filter_by(email=email).first():
            return jsonify({'error': 'Email already exists'}), 400
        # Check slug uniqueness
        slug = Organization.generate_slug(agency_name)
        base_slug = slug
        counter = 1
        while Organization.query.filter_by(slug=slug).first():
            slug = f'{base_slug}-{counter}'
            counter += 1
        # Create user
        user = User(username=username, email=email, full_name=full_name)
        user.set_password(password)
        db.session.add(user)
        db.session.flush()  # Get user.id
        # Create organization
        org = Organization(
            name=agency_name, slug=slug, org_type=OrgType.TRAVEL_AGENCY,
            is_approved=True, max_users=None, created_by=user.id
        )
        db.session.add(org)
        db.session.flush()  # Get org.id
        # Create membership
        membership = Membership(
            user_id=user.id, organization_id=org.id, role=Role.AGENCY_ADMIN
        )
        db.session.add(membership)
        db.session.commit()
        # Set session
        session.permanent = True
        session['user_id'] = user.id
        session['username'] = user.username
        session['organization_id'] = org.id
        session['role'] = Role.AGENCY_ADMIN
        session['org_name'] = org.name
        session['org_type'] = org.org_type
        session['org_slug'] = org.slug
        return jsonify({
            'message': 'Agency registered successfully',
            'user': user.to_dict() if hasattr(user, 'to_dict') else {'id': user.id, 'username': user.username},
            'organization': org.to_dict(),
        }), 201
    except Exception as e:
        db.session.rollback()
        print(f'Agency registration error: {e}')
        return jsonify({'error': 'Registration failed'}), 500

@auth_bp.route('/api/register/individual', methods=['POST'])
def register_individual():
    """Register an individual user — creates personal org."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Missing request body'}), 400
        username = (data.get('username') or '').strip()
        email = (data.get('email') or '').strip().lower()
        password = data.get('password') or ''
        full_name = (data.get('full_name') or '').strip()
        if not username or not email or not password:
            return jsonify({'error': 'Missing required fields: username, email, password'}), 400
        if User.query.filter_by(username=username).first():
            return jsonify({'error': 'Username already exists'}), 400
        if User.query.filter_by(email=email).first():
            return jsonify({'error': 'Email already exists'}), 400
        slug = Organization.generate_slug(full_name or username)
        base_slug = slug
        counter = 1
        while Organization.query.filter_by(slug=slug).first():
            slug = f'{base_slug}-{counter}'
            counter += 1
        user = User(username=username, email=email, full_name=full_name)
        user.set_password(password)
        db.session.add(user)
        db.session.flush()
        org = Organization(
            name=full_name or username, slug=slug, org_type=OrgType.INDIVIDUAL,
            is_approved=True, max_users=1, created_by=user.id
        )
        db.session.add(org)
        db.session.flush()
        membership = Membership(
            user_id=user.id, organization_id=org.id, role=Role.CLIENT_USER
        )
        db.session.add(membership)
        db.session.commit()
        session.permanent = True
        session['user_id'] = user.id
        session['username'] = user.username
        session['organization_id'] = org.id
        session['role'] = Role.CLIENT_USER
        session['org_name'] = org.name
        session['org_type'] = org.org_type
        session['org_slug'] = org.slug
        return jsonify({
            'message': 'Registration successful',
            'user': {'id': user.id, 'username': user.username},
            'organization': org.to_dict(),
        }), 201
    except Exception as e:
        db.session.rollback()
        print(f'Individual registration error: {e}')
        return jsonify({'error': 'Registration failed'}), 500
@auth_bp.route('/api/register/invite', methods=['POST'])
def register_invite():
    """Register a user using an invitation token."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Missing request body'}), 400
        token = data.get('token')
        password = data.get('password') or ''
        full_name = (data.get('full_name') or '').strip()
        
        if not token or not password or not full_name:
            return jsonify({'error': 'Missing required fields: token, password, full_name'}), 400
            
        invitation = OrgInvitation.query.filter_by(token=token).first()
        if not invitation:
            return jsonify({'error': 'Invalid or expired invitation'}), 404
            
        # Email comes from form or from invite
        email = (data.get('email') or invitation.email or '').strip().lower()
        if not email:
            return jsonify({'error': 'Email is required'}), 400
            
        username = email.split('@')[0]
        if User.query.filter_by(username=username).first():
            username = email
            
        if User.query.filter_by(email=email).first():
            return jsonify({'error': 'User with this email already exists'}), 400
            
        user = User(username=username, email=email, full_name=full_name)
        user.set_password(password)
        db.session.add(user)
        db.session.flush()
        
        membership = Membership(
            user_id=user.id,
            organization_id=invitation.organization_id,
            role=invitation.role
        )
        db.session.add(membership)
        
        # Link to employee profile if applicable
        if getattr(invitation, 'employee_id', None):
            from models import OwnershipEmployee
            emp = OwnershipEmployee.query.get(invitation.employee_id)
            if emp:
                old_name = emp.name
                emp.email = email
                emp.user_id = user.id
                # Cascade rename if registrant used a different name
                if full_name and full_name != old_name:
                    from app import _cascade_employee_rename
                    _cascade_employee_rename(old_name, full_name)
                emp.name = full_name
                
        # Save organization details before deleting invitation
        org_id = invitation.organization_id
        org_role = invitation.role
        org_name = invitation.organization.name
        org_type = invitation.organization.org_type
        org_slug = invitation.organization.slug
        
        db.session.delete(invitation)
        db.session.commit()
        
        session.permanent = True
        session['user_id'] = user.id
        session['username'] = user.username
        session['organization_id'] = org_id
        session['role'] = org_role
        session['org_name'] = org_name
        session['org_type'] = org_type
        session['org_slug'] = org_slug
        
        return jsonify({
            'message': 'Registration successful',
            'user': {'id': user.id, 'username': user.username},
        }), 201
    except Exception as e:
        db.session.rollback()
        print(f'Invite registration error: {e}')
        return jsonify({'error': 'Registration failed'}), 500

@auth_bp.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    username = (data.get('username') or '').strip()
    password = data.get('password')
    if not username or not password:
        return jsonify({'error': 'Missing credentials'}), 400
        
    user = User.query.filter_by(username=username).first()
    if user and user.check_password(password):
        
        # Check if they are accepting an invite
        token = data.get('token')
        if token:
            from models_rbac import OrgInvitation
            invitation = OrgInvitation.query.filter_by(token=token).first()
            if invitation:
                # Add them to the org
                existing_membership = Membership.query.filter_by(user_id=user.id, organization_id=invitation.organization_id).first()
                if not existing_membership:
                    membership = Membership(
                        user_id=user.id,
                        organization_id=invitation.organization_id,
                        role=invitation.role
                    )
                    db.session.add(membership)
                
                # Link to employee profile
                if getattr(invitation, 'employee_id', None):
                    from models import OwnershipEmployee
                    emp = OwnershipEmployee.query.get(invitation.employee_id)
                    if emp:
                        emp.email = user.email
                        emp.user_id = user.id
                
                db.session.delete(invitation)
                db.session.commit()
                
        session.permanent = True
        session['user_id'] = user.id
        session['username'] = user.username
        
        # Load active memberships
        memberships = Membership.query.filter_by(user_id=user.id, is_active=True).all()
        if not memberships:
            # Maybe they haven't set up a workspace yet, but let's let them through to workspace picker
            return jsonify({'message': 'Please select a workspace', 'requires_workspace_selection': True}), 200
            
        if len(memberships) == 1:
            org = memberships[0].organization
            if org and org.is_active:
                session['organization_id'] = org.id
                session['role'] = memberships[0].role
                session['org_name'] = org.name
                session['org_type'] = org.org_type
                session['org_slug'] = org.slug
                return jsonify({
                    'message': 'Logged in successfully',
                    'organization_id': org.id,
                    'role': memberships[0].role
                }), 200
                
        # If multiple, require selection
        return jsonify({'message': 'Please select a workspace', 'requires_workspace_selection': True}), 200
        
    return jsonify({'error': 'Invalid credentials'}), 401

@auth_bp.route('/api/user', methods=['GET'])
def get_current_user():
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    user = User.query.get(session['user_id'])
    if not user:
        return jsonify({'error': 'User not found'}), 404
        
    return jsonify({
        'id': user.id,
        'username': user.username,
        'full_name': user.full_name,
        'email': user.email,
        'organization_id': session.get('organization_id'),
        'role': session.get('role'),
        'org_name': session.get('org_name'),
        'org_type': session.get('org_type')
    }), 200
