import sqlite3
import os

db_path = "instance/app.db"

def add_column():
    if not os.path.exists(db_path):
        print(f"Database not found at {db_path}")
        return

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    try:
        # Check if column exists
        cursor.execute("PRAGMA table_info(itineraries_v2)")
        columns = [info[1] for info in cursor.fetchall()]
        
        if "hold_deadline" not in columns:
            print("Adding hold_deadline column to itineraries_v2...")
            cursor.execute("ALTER TABLE itineraries_v2 ADD COLUMN hold_deadline DATETIME")
            conn.commit()
            print("Column added successfully.")
        else:
            print("Column hold_deadline already exists.")
            
    except Exception as e:
        print(f"Error: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    add_column()
