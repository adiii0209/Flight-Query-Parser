import os
from sqlalchemy import text
from app import app
from extensions import db
from models import OwnershipEmployee

with app.app_context():
    # 1. Add user_id column if it doesn't exist
    try:
        db.session.execute(text('ALTER TABLE ownership_employee ADD COLUMN user_id VARCHAR(36);'))
        db.session.execute(text('CREATE INDEX ix_ownership_employee_user_id ON ownership_employee (user_id);'))
        db.session.commit()
        print("Column added successfully.")
    except Exception as e:
        db.session.rollback()
        print("Column might already exist or error:", e)

    # 2. Restore Aditya
    try:
        # We also need to add user_id to the model for SQLAlchemy to map it correctly. 
        # But wait! We haven't updated models.py yet.
        # Let's run raw SQL for restoring Aditya to avoid model mismatches right now.
        db.session.execute(text("UPDATE ownership_employee SET email = 'adityarana200502@gmail.com', user_id = '509f1cb7-8229-45f8-abd1-8d6bf2412ff7' WHERE id = '21f2b3c4-81a2-41a5-8eb8-8812b6a2ab9f'"))
        db.session.commit()
        print("Aditya restored!")
    except Exception as e:
        db.session.rollback()
        print("Error restoring Aditya:", e)
