"""
SQLAlchemy 2.x Extensions for Travel Agent Platform.
Provides session management and database utilities.
"""

from sqlalchemy import create_engine
from sqlalchemy import inspect, text
from sqlalchemy.orm import sessionmaker, scoped_session
from models_v2 import Base
import models_enterprise
import models_rbac

import os
from dotenv import load_dotenv

load_dotenv()

# Database URL from environment or derive from Flask's instance folder
# Supports PostgreSQL via DATABASE_URL and falls back to SQLite
_base_dir = os.path.abspath(os.path.dirname(__file__))
_instance_dir = os.path.join(_base_dir, 'instance')
os.makedirs(_instance_dir, exist_ok=True)
_default_db = f"sqlite:///{os.path.join(_instance_dir, 'app.db')}"
DATABASE_URL = (os.getenv("DATABASE_URL") or _default_db).strip()

# Fix Railway/Heroku postgres:// → postgresql://
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = "postgresql://" + DATABASE_URL[len("postgres://"):]

# Create engine with SQLAlchemy 2.0 style
# pool_pre_ping ensures stale connections are recycled (important for PostgreSQL)
engine_kwargs = {"echo": False}
if DATABASE_URL.startswith("postgresql"):
    engine_kwargs["pool_pre_ping"] = True
    engine_kwargs["pool_size"] = 5
    engine_kwargs["max_overflow"] = 10

engine = create_engine(DATABASE_URL, **engine_kwargs)

# Session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Scoped session for thread safety
db_session = scoped_session(SessionLocal)


def init_db():
    """Initialize the database by creating all tables."""
    Base.metadata.create_all(bind=engine)
    models_enterprise.Base.metadata.create_all(bind=engine)
    upgrade_itinerary_json_columns_for_postgres()
    seed_airlines()
    print("Travel Agent database initialized successfully! (V2 + Enterprise)")


def upgrade_itinerary_json_columns_for_postgres():
    """Convert existing itinerary JSON text columns to JSONB on PostgreSQL."""
    if engine.dialect.name != "postgresql":
        return

    inspector = inspect(engine)
    if "itineraries_v2" not in inspector.get_table_names():
        return

    columns = {
        column["name"]: str(column.get("type") or "").lower()
        for column in inspector.get_columns("itineraries_v2")
    }
    json_columns = {
        "passengers_data": "[]",
        "flights_data": "[]",
        "raw_input_data": "{}",
    }

    with engine.begin() as conn:
        for column_name, empty_json in json_columns.items():
            column_type = columns.get(column_name, "")
            if not column_type or "jsonb" in column_type:
                continue
            if "json" in column_type:
                conn.execute(text(
                    f"""
                    ALTER TABLE itineraries_v2
                    ALTER COLUMN {column_name}
                    TYPE JSONB
                    USING COALESCE({column_name}, CAST(:empty_json AS json))::jsonb
                    """
                ), {"empty_json": empty_json})
                continue
            conn.execute(text(
                f"""
                ALTER TABLE itineraries_v2
                ALTER COLUMN {column_name}
                TYPE JSONB
                USING CASE
                    WHEN {column_name} IS NULL OR btrim({column_name}::text) IN ('', 'null') THEN CAST(:empty_json AS jsonb)
                    ELSE {column_name}::jsonb
                END
                """
            ), {"empty_json": empty_json})


def get_db():
    """Get a database session (for use with Flask or FastAPI)."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def seed_airlines():
    """Seed the database with all airlines from mappings.py."""
    from models_v2 import Airline
    from mappings import AIRLINE_CODES
    
    session = SessionLocal()
    try:
        # Fetch all existing IATA codes in one query
        existing_codes = set(code[0] for code in session.query(Airline.iata_code).all())
        
        # Determine which airlines are missing
        new_airlines = []
        for code, name in AIRLINE_CODES.items():
            if code not in existing_codes:
                new_airlines.append(Airline(iata_code=code, name=name))
                
        # Bulk insert
        if new_airlines:
            session.bulk_save_objects(new_airlines)
            session.commit()
            print(f"Seeded {len(new_airlines)} new airlines from mappings")
    except Exception as e:
        session.rollback()
        print(f"Error seeding airlines: {e}")
    finally:
        session.close()
