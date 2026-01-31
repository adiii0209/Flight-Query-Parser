"""
Database setup and initialization script
Run this to create the database and optionally seed demo data
"""

import os
import sys
from app import app, db, User, Customer, Itinerary
from datetime import datetime
import json

def init_database():
    """Initialize the database"""
    print("🗄️  Initializing database...")
    with app.app_context():
        db.create_all()
        print("✅ Database tables created successfully!")

def seed_demo_data():
    """Seed the database with demo data"""
    print("\n📊 Seeding demo data...")
    
    with app.app_context():
        # Check if demo user already exists
        existing_user = User.query.filter_by(username='demo').first()
        if existing_user:
            print("⚠️  Demo user already exists. Skipping seed.")
            return
        
        # Create demo user
        demo_user = User(
            username='demo',
            email='demo@timetours.in',
            full_name='Demo User'
        )
        demo_user.set_password('demo123')
        db.session.add(demo_user)
        db.session.flush()
        
        print("✅ Created demo user (username: demo, password: demo123)")
        
        # Create demo customers
        customers = [
            Customer(
                name='Rajesh Kumar',
                email='rajesh@example.com',
                phone='+919876543210',
                address='123 MG Road, Bangalore, Karnataka',
                customer_type='passenger',
                user_id=demo_user.id
            ),
            Customer(
                name='Priya Sharma',
                email='priya@example.com',
                phone='+919123456789',
                address='456 Park Street, Kolkata, West Bengal',
                customer_type='passenger',
                user_id=demo_user.id
            ),
            Customer(
                name='Amit Patel',
                email='amit@techcorp.com',
                phone='+919988776655',
                address='Tech Park, Whitefield, Bangalore',
                customer_type='corporate',
                company_name='Tech Corp India Pvt Ltd',
                gst_number='29AABCT1234C1Z5',
                user_id=demo_user.id
            )
        ]
        
        for customer in customers:
            db.session.add(customer)
        
        db.session.flush()
        print(f"✅ Created {len(customers)} demo customers")
        
        # Create demo itineraries
        sample_flights = [
            {
                "id": "1",
                "airline": "IndiGo",
                "flight_number": "6E-123",
                "departure_city": "Mumbai",
                "departure_airport": "BOM",
                "departure_date": "28 Jan 2026",
                "departure_time": "10:30",
                "arrival_city": "Delhi",
                "arrival_airport": "DEL",
                "arrival_time": "12:45",
                "duration": "2h 15m",
                "stops": "Non-stop",
                "baggage": "15 Kg",
                "refundability": "Refundable",
                "fares": {"saver": 5500, "corporate": 6500},
                "markup": 500
            }
        ]
        
        itinerary1 = Itinerary(
            total_amount=12000,
            markup=500,
            status='draft',
            flights_data=json.dumps(sample_flights),
            final_text="""Your Flight Itinerary for Oneway Air Travel for 1 Traveller(s):

*1. IndiGo : 6E-123*

*Departure:* Mumbai (BOM)
*Time:* 28 Jan 2026 , 10:30

*Arrival:* Delhi (DEL)
*Time:* 28 Jan 2026 , 12:45

*Duration:* 2h 15m (Non-stop)

*Baggage:* 15 Kg
*Refundable*

*Saver Fare:* ₹ 6,000
*Corporate Fare:* ₹ 7,000

Please confirm the same at the earliest. 

Contact: +919831020012
Email: mail@timetours.in

Thanks,
Time Travels

*Note:* Airline ticket pricing is dynamic. Fares are valid as of now and might change at the time of issuance.""",
            user_id=demo_user.id,
            customer_id=customers[0].id,
            billing_type='passenger',
            bill_to_name='Rajesh Kumar',
            bill_to_email='rajesh@example.com',
            bill_to_phone='+919876543210',
            bill_to_address='123 MG Road, Bangalore, Karnataka'
        )
        
        db.session.add(itinerary1)
        
        print("✅ Created 1 demo itinerary")
        
        db.session.commit()
        print("\n🎉 Demo data seeded successfully!")
        print("\n📝 Demo Credentials:")
        print("   Username: demo")
        print("   Password: demo123")
        print("\n🚀 You can now login and explore the application!")

def main():
    """Main setup function"""
    print("=" * 60)
    print("  ✈️  FLIGHT ITINERARY BUILDER - DATABASE SETUP")
    print("=" * 60)
    
    # Check if .env file exists
    if not os.path.exists('.env'):
        print("\n⚠️  WARNING: .env file not found!")
        print("Please copy .env.example to .env and configure it.")
        print("\nRun: cp .env.example .env")
        print("Then edit .env with your API keys.")
        sys.exit(1)
    
    # Initialize database
    init_database()
    
    # Ask if user wants to seed demo data
    print("\n" + "=" * 60)
    response = input("\n📊 Would you like to seed demo data? (y/n): ").lower()
    
    if response == 'y' or response == 'yes':
        seed_demo_data()
    else:
        print("\n✅ Database setup complete!")
        print("You can now run the application with: python app.py")
    
    print("\n" + "=" * 60)

if __name__ == '__main__':
    main()