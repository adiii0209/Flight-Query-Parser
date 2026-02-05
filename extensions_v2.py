"""
SQLAlchemy 2.x Extensions for Travel Agent Platform.
Provides session management and database utilities.
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, scoped_session
from models_v2 import Base

# Database URL - can be overridden
DATABASE_URL = "sqlite:///app.db"

# Create engine with SQLAlchemy 2.0 style
engine = create_engine(DATABASE_URL, echo=False)

# Session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Scoped session for thread safety
db_session = scoped_session(SessionLocal)


def init_db():
    """Initialize the database by creating all tables."""
    Base.metadata.create_all(bind=engine)
    print("Travel Agent database initialized successfully!")


def get_db():
    """Get a database session (for use with Flask or FastAPI)."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def seed_airlines():
    """Seed the database with common airlines."""
    from models_v2 import Airline
    
    airlines_data = [
        {"iata_code": "AI", "icao_code": "AIC", "name": "Air India", "country": "India"},
        {"iata_code": "6E", "icao_code": "IGO", "name": "IndiGo", "country": "India"},
        {"iata_code": "UK", "icao_code": "VTI", "name": "Vistara", "country": "India"},
        {"iata_code": "SG", "icao_code": "SEJ", "name": "SpiceJet", "country": "India"},
        {"iata_code": "G8", "icao_code": "GOW", "name": "Go First", "country": "India"},
        {"iata_code": "I5", "icao_code": "IAD", "name": "AirAsia India", "country": "India"},
        {"iata_code": "QP", "icao_code": "AKJ", "name": "Akasa Air", "country": "India"},
        {"iata_code": "EK", "icao_code": "UAE", "name": "Emirates", "country": "UAE"},
        {"iata_code": "QR", "icao_code": "QTR", "name": "Qatar Airways", "country": "Qatar"},
        {"iata_code": "EY", "icao_code": "ETD", "name": "Etihad Airways", "country": "UAE"},
        {"iata_code": "SQ", "icao_code": "SIA", "name": "Singapore Airlines", "country": "Singapore"},
        {"iata_code": "TG", "icao_code": "THA", "name": "Thai Airways", "country": "Thailand"},
        {"iata_code": "CX", "icao_code": "CPA", "name": "Cathay Pacific", "country": "Hong Kong"},
        {"iata_code": "BA", "icao_code": "BAW", "name": "British Airways", "country": "UK"},
        {"iata_code": "LH", "icao_code": "DLH", "name": "Lufthansa", "country": "Germany"},
        {"iata_code": "AF", "icao_code": "AFR", "name": "Air France", "country": "France"},
        {"iata_code": "AA", "icao_code": "AAL", "name": "American Airlines", "country": "USA"},
        {"iata_code": "UA", "icao_code": "UAL", "name": "United Airlines", "country": "USA"},
        {"iata_code": "DL", "icao_code": "DAL", "name": "Delta Air Lines", "country": "USA"},
    ]
    
    session = SessionLocal()
    try:
        for airline_data in airlines_data:
            # Check if airline already exists
            existing = session.query(Airline).filter_by(iata_code=airline_data["iata_code"]).first()
            if not existing:
                airline = Airline(**airline_data)
                session.add(airline)
        session.commit()
        print(f"Seeded {len(airlines_data)} airlines")
    except Exception as e:
        session.rollback()
        print(f"Error seeding airlines: {e}")
    finally:
        session.close()
