import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()
db_url = os.environ.get("DATABASE_URL")
if not db_url:
    print("No DATABASE_URL found.")
    exit(1)

engine = create_engine(db_url)
with engine.connect() as conn:
    try:
        conn.execute(text("ALTER TABLE ownership_trip ADD COLUMN archived BOOLEAN DEFAULT FALSE NOT NULL;"))
        conn.commit()
        print("Column added successfully.")
    except Exception as e:
        print(f"Error: {e}")
