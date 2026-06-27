"""
Multi-Tenant RBAC Models — Organization, Membership, and Invitation.
Integrates with the existing Flask-SQLAlchemy `db` from extensions.py.
"""

import uuid
import secrets
from datetime import datetime, timedelta
from extensions import db


# ==================== CONSTANTS ====================

class OrgType:
    """Organization type constants."""
    TRAVEL_AGENCY = 'TRAVEL_AGENCY'
    CORPORATE = 'CORPORATE'
    INDIVIDUAL = 'INDIVIDUAL'

    ALL = [TRAVEL_AGENCY, CORPORATE, INDIVIDUAL]


class Role:
    """Role constants — ordered by privilege level (highest first)."""
    PLATFORM_SUPER_ADMIN = 'PLATFORM_SUPER_ADMIN'
    AGENCY_ADMIN = 'AGENCY_ADMIN'
    AGENCY_EMPLOYEE = 'AGENCY_EMPLOYEE'
    CLIENT_ADMIN = 'CLIENT_ADMIN'
    CLIENT_USER = 'CLIENT_USER'

    ALL = [PLATFORM_SUPER_ADMIN, AGENCY_ADMIN, AGENCY_EMPLOYEE, CLIENT_ADMIN, CLIENT_USER]

    # Roles that can manage other users
    ADMIN_ROLES = [PLATFORM_SUPER_ADMIN, AGENCY_ADMIN, CLIENT_ADMIN]

    # Roles allowed per org type
    ROLES_BY_ORG_TYPE = {
        OrgType.TRAVEL_AGENCY: [AGENCY_ADMIN, AGENCY_EMPLOYEE],
        OrgType.CORPORATE: [CLIENT_ADMIN, CLIENT_USER],
        OrgType.INDIVIDUAL: [CLIENT_USER],
    }


class InvitationStatus:
    """Invitation status constants."""
    PENDING = 'pending'
    ACCEPTED = 'accepted'
    EXPIRED = 'expired'
    REVOKED = 'revoked'


# ==================== PERMISSIONS ====================

# Feature → set of roles that can access it
PERMISSIONS = {
    'query':         {Role.PLATFORM_SUPER_ADMIN, Role.AGENCY_ADMIN, Role.AGENCY_EMPLOYEE},
    'itineraries':   {Role.PLATFORM_SUPER_ADMIN, Role.AGENCY_ADMIN, Role.AGENCY_EMPLOYEE, Role.CLIENT_ADMIN, Role.CLIENT_USER},
    'tickets':       {Role.PLATFORM_SUPER_ADMIN, Role.AGENCY_ADMIN, Role.AGENCY_EMPLOYEE},
    'hotels':        {Role.PLATFORM_SUPER_ADMIN, Role.AGENCY_ADMIN, Role.AGENCY_EMPLOYEE},
    'ownership':     {Role.PLATFORM_SUPER_ADMIN, Role.AGENCY_ADMIN, Role.AGENCY_EMPLOYEE},
    'billing':       {Role.PLATFORM_SUPER_ADMIN, Role.AGENCY_ADMIN, Role.CLIENT_ADMIN},
    'ledger':        {Role.PLATFORM_SUPER_ADMIN, Role.AGENCY_ADMIN},
    'fare_rules':    {Role.PLATFORM_SUPER_ADMIN, Role.AGENCY_ADMIN, Role.AGENCY_EMPLOYEE},
    'passengers':    {Role.PLATFORM_SUPER_ADMIN, Role.AGENCY_ADMIN, Role.AGENCY_EMPLOYEE, Role.CLIENT_ADMIN, Role.CLIENT_USER},
    'corporates':    {Role.PLATFORM_SUPER_ADMIN, Role.AGENCY_ADMIN, Role.AGENCY_EMPLOYEE, Role.CLIENT_ADMIN},
    'settings':      {Role.PLATFORM_SUPER_ADMIN, Role.AGENCY_ADMIN, Role.AGENCY_EMPLOYEE, Role.CLIENT_ADMIN, Role.CLIENT_USER},
    'manage_users':  {Role.PLATFORM_SUPER_ADMIN, Role.AGENCY_ADMIN, Role.CLIENT_ADMIN},
    'invite_users':  {Role.PLATFORM_SUPER_ADMIN, Role.AGENCY_ADMIN, Role.CLIENT_ADMIN},
    'manage_orgs':   {Role.PLATFORM_SUPER_ADMIN},
}

# Features restricted to specific org types (None = all org types)
FEATURE_ORG_TYPES = {
    'query':      {OrgType.TRAVEL_AGENCY},
    'tickets':    {OrgType.TRAVEL_AGENCY},
    'hotels':     {OrgType.TRAVEL_AGENCY},
    'ownership':  {OrgType.TRAVEL_AGENCY},
    'ledger':     {OrgType.TRAVEL_AGENCY},
    'fare_rules': {OrgType.TRAVEL_AGENCY},
}


def has_permission(role, org_type, feature):
    """Check if a role + org_type combination has access to a feature."""
    if role == Role.PLATFORM_SUPER_ADMIN:
        return True
    if feature not in PERMISSIONS:
        return False
    if role not in PERMISSIONS[feature]:
        return False
    # Check org type restriction
    allowed_types = FEATURE_ORG_TYPES.get(feature)
    if allowed_types and org_type not in allowed_types:
        return False
    return True


# ==================== ORGANIZATION MODEL ====================

class Organization(db.Model):
    """Multi-tenant organization (workspace)."""
    __tablename__ = 'organizations'

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = db.Column(db.String(200), nullable=False)
    slug = db.Column(db.String(100), unique=True, nullable=False, index=True)
    org_type = db.Column(db.String(30), nullable=False)  # TRAVEL_AGENCY, CORPORATE, INDIVIDUAL

    # Approval & status
    is_approved = db.Column(db.Boolean, default=False, nullable=False)
    is_active = db.Column(db.Boolean, default=True, nullable=False)

    # Limits
    max_users = db.Column(db.Integer, nullable=True, default=1)  # None = unlimited

    # Settings (JSON — org-level configuration)
    settings = db.Column(db.Text, nullable=True)  # JSON string

    # Branding
    logo_url = db.Column(db.String(500), nullable=True)

    # Creator
    created_by = db.Column(db.String(36), db.ForeignKey('user.id'), nullable=True)

    # Timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    memberships = db.relationship('Membership', backref='organization', lazy='selectin',
                                  cascade='all, delete-orphan')
    invitations = db.relationship('OrgInvitation', backref='organization', lazy='dynamic',
                                  cascade='all, delete-orphan')

    __table_args__ = (
        db.Index('idx_org_type', 'org_type'),
        db.Index('idx_org_approved', 'is_approved'),
        db.Index('idx_org_created_by', 'created_by'),
    )

    @staticmethod
    def generate_slug(name):
        """Generate a URL-safe slug from organization name."""
        import re
        slug = name.lower().strip()
        slug = re.sub(r'[^a-z0-9]+', '-', slug)
        slug = slug.strip('-')
        return slug or 'org'

    def get_member_count(self):
        """Count active members."""
        return Membership.query.filter_by(
            organization_id=self.id, is_active=True
        ).count()

    def can_add_member(self):
        """Check if the organization can accept another member."""
        if self.max_users is None:
            return True
        return self.get_member_count() < self.max_users

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'slug': self.slug,
            'org_type': self.org_type,
            'is_approved': self.is_approved,
            'is_active': self.is_active,
            'max_users': self.max_users,
            'logo_url': self.logo_url,
            'member_count': self.get_member_count(),
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }


# ==================== MEMBERSHIP MODEL ====================

class Membership(db.Model):
    """Links users to organizations with roles."""
    __tablename__ = 'memberships'

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(db.String(36), db.ForeignKey('user.id'), nullable=False)
    organization_id = db.Column(db.String(36), db.ForeignKey('organizations.id'), nullable=False)
    role = db.Column(db.String(30), nullable=False)  # From Role constants

    # Status
    is_active = db.Column(db.Boolean, default=True, nullable=False)

    # Metadata
    joined_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    invited_by = db.Column(db.String(36), db.ForeignKey('user.id'), nullable=True)

    # Relationships
    user = db.relationship('User', foreign_keys=[user_id], backref='memberships')
    inviter = db.relationship('User', foreign_keys=[invited_by])

    __table_args__ = (
        db.UniqueConstraint('user_id', 'organization_id', name='uq_membership_user_org'),
        db.Index('idx_membership_user', 'user_id'),
        db.Index('idx_membership_org', 'organization_id'),
        db.Index('idx_membership_role', 'role'),
    )

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'organization_id': self.organization_id,
            'role': self.role,
            'is_active': self.is_active,
            'joined_at': self.joined_at.isoformat() if self.joined_at else None,
            'user': {
                'id': self.user.id,
                'username': self.user.username,
                'email': self.user.email,
                'full_name': self.user.full_name,
            } if self.user else None,
            'organization': {
                'id': self.organization.id,
                'name': self.organization.name,
                'org_type': self.organization.org_type,
            } if self.organization else None,
        }


# ==================== INVITATION MODEL ====================

class OrgInvitation(db.Model):
    """Invitation to join an organization. Supports both email-link and invite-code."""
    __tablename__ = 'org_invitations'

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    organization_id = db.Column(db.String(36), db.ForeignKey('organizations.id'), nullable=False)
    employee_id = db.Column(db.String(36), db.ForeignKey('ownership_employee.id'), nullable=True)
    email = db.Column(db.String(120), nullable=True)  # Null for code-based invitations
    role = db.Column(db.String(30), nullable=False)

    # Token — used for both email links and invite codes
    token = db.Column(db.String(64), unique=True, nullable=False,
                      default=lambda: secrets.token_urlsafe(32))

    # Invite code — short human-readable code (for code-based invitations)
    invite_code = db.Column(db.String(12), unique=True, nullable=True,
                            default=lambda: secrets.token_hex(4).upper())

    # Status
    status = db.Column(db.String(20), default=InvitationStatus.PENDING, nullable=False)

    # Metadata
    invited_by = db.Column(db.String(36), db.ForeignKey('user.id'), nullable=True)
    expires_at = db.Column(db.DateTime, nullable=False,
                           default=lambda: datetime.utcnow() + timedelta(days=7))
    accepted_at = db.Column(db.DateTime, nullable=True)
    accepted_by = db.Column(db.String(36), db.ForeignKey('user.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    inviter = db.relationship('User', foreign_keys=[invited_by])
    acceptor = db.relationship('User', foreign_keys=[accepted_by])

    __table_args__ = (
        db.Index('idx_invitation_org', 'organization_id'),
        db.Index('idx_invitation_email', 'email'),
        db.Index('idx_invitation_token', 'token'),
        db.Index('idx_invitation_code', 'invite_code'),
        db.Index('idx_invitation_status', 'status'),
    )

    @property
    def is_expired(self):
        return datetime.utcnow() > self.expires_at

    @property
    def is_valid(self):
        return self.status == InvitationStatus.PENDING and not self.is_expired

    def to_dict(self):
        return {
            'id': self.id,
            'organization_id': self.organization_id,
            'email': self.email,
            'role': self.role,
            'invite_code': self.invite_code,
            'status': self.status,
            'expires_at': self.expires_at.isoformat() if self.expires_at else None,
            'accepted_at': self.accepted_at.isoformat() if self.accepted_at else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'organization_name': self.organization.name if self.organization else None,
        }
