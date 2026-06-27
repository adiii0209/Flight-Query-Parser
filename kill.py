import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()
db_url = os.getenv('DATABASE_URL')
if db_url and db_url.startswith('postgres://'):
    db_url = 'postgresql://' + db_url[len('postgres://'):]

engine = create_engine(db_url, isolation_level='AUTOCOMMIT')

with engine.connect() as conn:
    print('Killing idle connections...')
    conn.execute(text("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle in transaction' AND pid != pg_backend_pid();"))
    print('Killed.')
