from sqlalchemy import create_engine, text
db_url = 'postgresql://neondb_owner:npg_DXS9zI4vqBkt@ep-sparkling-frost-aolg21mh-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require'
engine = create_engine(db_url)
with engine.connect() as conn:
    res = conn.execute(text('SELECT user_id, COUNT(*) FROM ticket GROUP BY user_id')).all()
    for r in res:
        print(dict(r._mapping))
