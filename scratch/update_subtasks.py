import os
from app import app
from models import db, OwnershipTrip
from datetime import datetime

with app.app_context():
    trips = OwnershipTrip.query.all()
    today_str = datetime.now().isoformat()[:10]
    updated_count = 0
    for trip in trips:
        subtasks_dict = trip.subtasks_json
        if not subtasks_dict or not isinstance(subtasks_dict, dict):
            continue
        
        changed = False
        for category, tasks in subtasks_dict.items():
            if not isinstance(tasks, list):
                continue
            for task in tasks:
                metadata = task.get('metadata', {})
                if 'reminder' not in metadata:
                    metadata['reminder'] = {'date': today_str, 'label': 'Due today'}
                    task['metadata'] = metadata
                    changed = True
        
        if changed:
            trip.subtasks_json = subtasks_dict
            db.session.add(trip)
            updated_count += 1
            
    if updated_count > 0:
        db.session.commit()
        print(f"Updated subtasks in {updated_count} trips.")
    else:
        print("No subtasks needed updating.")
