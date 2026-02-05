
import sqlite3
import os
from sqlalchemy import text
from extensions_v2 import engine, seed_airlines
from models_v2 import Base

DB_PATH = "c:\\Flight-Query-Parser\\app.db"

def upgrade_user_table():
    print(f"Checking {DB_PATH}...")
    if not os.path.exists(DB_PATH):
        print(f"Error: {DB_PATH} not found!")
        return

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Get existing columns
    cursor.execute("PRAGMA table_info(user)")
    columns = [row[1] for row in cursor.fetchall()]
    
    print(f"Existing columns in 'user': {columns}")
    
    # Add updated_at if missing
    if "updated_at" not in columns:
        print("Adding 'updated_at' column...")
        try:
            cursor.execute("ALTER TABLE user ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP")
            conn.commit()
            print("Added 'updated_at'.")
        except Exception as e:
            print(f"Error adding updated_at: {e}")

    # Add is_active if missing
    if "is_active" not in columns:
        print("Adding 'is_active' column...")
        try:
            cursor.execute("ALTER TABLE user ADD COLUMN is_active BOOLEAN DEFAULT 1")
            conn.commit()
            print("Added 'is_active'.")
        except Exception as e:
            print(f"Error adding is_active: {e}")

    conn.close()

def create_new_tables():
    print("Creating new tables from models_v2...")
    # This will create tables that don't exist (like passengers, corporates)
    # It will skip 'user' because it already exists (and we just patched it)
    Base.metadata.create_all(bind=engine)
    print("Tables created successfully.")

if __name__ == "__main__":
    upgrade_user_table()
    create_new_tables()
    seed_airlines()
