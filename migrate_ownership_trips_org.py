from app import app
from extensions import db
from models import OwnershipTrip

with app.app_context():
    # Find all trips with no organization_id
    trips = OwnershipTrip.query.filter_by(organization_id=None).all()
    count = 0
    for t in trips:
        t.organization_id = '75702319-34f9-4e5c-abf0-64444156ccf4'
        count += 1
    db.session.commit()
    print(f"Successfully migrated {count} trips to Time Tours organization.")

    # Invalidate cache so frontend re-fetches
    from app import _invalidate_ownership_cache
    version = _invalidate_ownership_cache()
    print(f"Ownership cache invalidated. New cache version: {version}")
