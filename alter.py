import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()
db_url = os.getenv('DATABASE_URL')
if db_url and db_url.startswith('postgres://'):
    db_url = 'postgresql://' + db_url[len('postgres://'):]

engine = create_engine(db_url, isolation_level='AUTOCOMMIT')

tables = [
    'user', 'customer', 'itinerary', 'ticket', 'aggregator', 
    'booking_group', 'ledger_entry', 'ticket_operation', 
    'hotel_booking',
    'corporates', 'passengers', 'itineraries_v2', 'billing_accounts', 'supplier_accounts'
]

with engine.connect() as conn:
    for table in tables:
        try:
            conn.execute(text(f'ALTER TABLE "{table}" ADD COLUMN organization_id VARCHAR'))
            print(f'Added organization_id to {table}')
        except Exception as e:
            print(f'Skipped {table}: {e}')

print('Done')
