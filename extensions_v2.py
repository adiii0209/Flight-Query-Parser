"""
SQLAlchemy 2.x Extensions for Travel Agent Platform.
Provides session management and database utilities.
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, scoped_session
from models_v2 import Base
import models_enterprise

import os
from dotenv import load_dotenv

load_dotenv()

# Database URL from environment or derive from Flask's instance folder
# Flask-SQLAlchemy uses instance/ by default, so we match that
_base_dir = os.path.abspath(os.path.dirname(__file__))
_instance_dir = os.path.join(_base_dir, 'instance')
os.makedirs(_instance_dir, exist_ok=True)
_default_db = f"sqlite:///{os.path.join(_instance_dir, 'app.db')}"
DATABASE_URL = os.getenv("DATABASE_URL", _default_db)

# Create engine with SQLAlchemy 2.0 style
engine = create_engine(DATABASE_URL, echo=False)

# Session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Scoped session for thread safety
db_session = scoped_session(SessionLocal)


def init_db():
    """Initialize the database by creating all tables."""
    Base.metadata.create_all(bind=engine)
    models_enterprise.Base.metadata.create_all(bind=engine)
    seed_airlines()
    print("Travel Agent database initialized successfully! (V2 + Enterprise)")


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
        count = 0
        for code, name in AIRLINE_CODES.items():
            # Check if airline already exists
            existing = session.query(Airline).filter_by(iata_code=code).first()
            if not existing:
                airline = Airline(iata_code=code, name=name)
                session.add(airline)
                count += 1
        session.commit()
        if count > 0:
            print(f"Seeded {count} new airlines from mappings")
    except Exception as e:
        session.rollback()
        print(f"Error seeding airlines: {e}")
    finally:
        session.close()
