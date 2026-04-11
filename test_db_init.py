from app import db, app, ensure_schema_compatibility
from extensions_v2 import init_db, get_db, engine
from sqlalchemy import text

with app.app_context():
    print("Testing connection to Neon DB through Flask+SQLAlchemy...")
    print("Database URI:", app.config["SQLALCHEMY_DATABASE_URI"])
    
    # Run the init to make sure tables are created
    ensure_schema_compatibility()
    init_db()

    with engine.connect() as conn:
        result = conn.execute(text("SELECT version();"))
        print("\nVersion:", result.scalar())
        
        print("\nChecking tables...")
        tables = conn.execute(text("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public';")).fetchall()
        print("Tables found:")
        for t in tables:
            print(" -", t[0])
