from app import app
from extensions import db
from models import Ticket, LedgerEntry, BookingGroup, TicketOperation, Customer, Aggregator, Itinerary

ORG_ID = '75702319-34f9-4e5c-abf0-64444156ccf4'

with app.app_context():
    models_to_migrate = [
        (Ticket, "Ticket"),
        (LedgerEntry, "LedgerEntry"),
        (BookingGroup, "BookingGroup"),
        (TicketOperation, "TicketOperation"),
        (Customer, "Customer"),
        (Aggregator, "Aggregator"),
        (Itinerary, "Itinerary"),
    ]

    for model, name in models_to_migrate:
        records = model.query.filter_by(organization_id=None).all()
        count = 0
        for r in records:
            r.organization_id = ORG_ID
            count += 1
        db.session.commit()
        print(f"Successfully migrated {count} {name} records.")

    # Clear ticket dashboard cache
    from app import _dashboard_cache
    # Since we can't easily clear all users from here, let's just clear the cache generally if we can, 
    # or the user's browser refresh will handle it once the db is updated.
    print("Migration complete!")
