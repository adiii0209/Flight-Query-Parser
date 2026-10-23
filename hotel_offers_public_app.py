"""Entry point for the separate client-page service:
    gunicorn hotel_offers_public_app:app --bind 0.0.0.0:$PORT --worker-class gthread --workers 2 --threads 8 --timeout 60
"""
from hotel_offers.standalone import create_public_app

app = create_public_app()
