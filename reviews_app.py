"""Entry point for the reviews service (reviews.timetours.in):
    gunicorn reviews_app:app --bind 0.0.0.0:$PORT --worker-class gthread --workers 2 --threads 8 --timeout 60
"""
from reviews import create_reviews_app

app = create_reviews_app()
