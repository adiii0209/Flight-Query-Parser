from extensions_v2 import init_db, get_db, engine
from app import ensure_schema_compatibility
from sqlalchemy import text
import pprint

try:
    print("Testing connection to Neon DB...")
    with engine.connect() as conn:
        result = conn.execute(text("SELECT version();"))
        print(result.scalar())
        
        print("\nChecking tables...")
        # Get all table names
        tables = conn.execute(text("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public';")).fetchall()
        print("Tables found:", [t[0] for t in tables])
        
except Exception as e:
    print("Error:", e)
