import os
from app import app
from extensions import db
from extensions_v2 import engine, db_session
from models_v2 import Base
from models import User, Customer, Itinerary, Ticket, Aggregator, BookingGroup, LedgerEntry, TicketOperation, OwnershipTrip, OwnershipTaskTemplate, HotelBooking
from models_v2 import Corporate, Passenger, Itinerary as ItineraryV2, BillingAccount, SupplierAccount
from models_rbac import Organization, Membership, OrgType, Role

def migrate():
    with app.app_context():
        # Create new tables
        db.create_all()
        Base.metadata.create_all(engine)
        print("Tables created.")

        # 1. Create Super Admin
        super_email = "tourstime7@gmail.com"
        super_user = User.query.filter_by(email=super_email).first()
        if not super_user:
            super_user = User(username="superadmin", email=super_email, full_name="Super Admin")
            super_user.set_password("admin123")  # Temporary password, user should change it
            db.session.add(super_user)
            db.session.flush()
            print(f"Created Super Admin user: {super_email}")
        
        platform_org = Organization.query.filter_by(slug="platform-admin").first()
        if not platform_org:
            platform_org = Organization(
                name="Platform Admin",
                slug="platform-admin",
                org_type=OrgType.TRAVEL_AGENCY,
                is_approved=True,
                max_users=None,
                created_by=super_user.id
            )
            db.session.add(platform_org)
            db.session.flush()
            
            membership = Membership(
                user_id=super_user.id,
                organization_id=platform_org.id,
                role=Role.PLATFORM_SUPER_ADMIN
            )
            db.session.add(membership)
            db.session.commit()
            print("Created Platform Organization and Membership.")

        # 2. Migrate existing user timetours.in
        legacy_email = "mail@timetours.in"
        legacy_user = User.query.filter_by(email=legacy_email).first()
        
        if legacy_user:
            tt_org = Organization.query.filter_by(slug="time-tours").first()
            if not tt_org:
                tt_org = Organization(
                    name="Time Tours",
                    slug="time-tours",
                    org_type=OrgType.TRAVEL_AGENCY,
                    is_approved=True,
                    max_users=None,
                    created_by=legacy_user.id
                )
                db.session.add(tt_org)
                db.session.flush()
                
                membership = Membership(
                    user_id=legacy_user.id,
                    organization_id=tt_org.id,
                    role=Role.AGENCY_ADMIN
                )
                db.session.add(membership)
                db.session.commit()
                print("Created Time Tours Organization and Membership.")
            
            org_id = tt_org.id
            
            # Migrate data in models.py
            print("Migrating data in models.py...")
            models_to_update = [Customer, Itinerary, Ticket, Aggregator, BookingGroup, LedgerEntry, TicketOperation, OwnershipTrip, OwnershipTaskTemplate, HotelBooking]
            for model in models_to_update:
                count = model.query.filter_by(user_id=legacy_user.id, organization_id=None).update({"organization_id": org_id})
                print(f"Updated {count} records in {model.__name__}")
            db.session.commit()

            # Migrate data in models_v2.py
            print("Migrating data in models_v2.py...")
            v2_models_to_update = [Corporate, Passenger, ItineraryV2, BillingAccount, SupplierAccount]
            for model in v2_models_to_update:
                count = db_session.query(model).filter(model.user_id == legacy_user.id, model.organization_id == None).update({"organization_id": org_id})
                print(f"Updated {count} records in {model.__name__}")
            db_session.commit()
            
            print("Migration completed successfully.")
        else:
            print("Legacy user not found. No data to migrate.")

if __name__ == "__main__":
    migrate()
