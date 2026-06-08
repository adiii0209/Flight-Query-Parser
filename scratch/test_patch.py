import sys
import traceback
from app import app, db, _ownership_query
from app import _apply_trip_payload

with app.app_context():
    trip = _ownership_query().first()
    if not trip:
        print("No trip found")
        sys.exit(0)
    print(f"Testing with trip {trip.id}")
    try:
        # Replicate patch request
        # Let's say we set proposalStatus to "Ongoing"
        payload = {"proposalStatus": "Ongoing", "version": trip.version}
        print("Applying payload...")
        _apply_trip_payload(trip, payload)
        print("Committing...")
        db.session.commit()
        print("Success!")
    except Exception as e:
        print("Error encountered:")
        traceback.print_exc()
