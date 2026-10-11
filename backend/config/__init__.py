# Load Celery when Django starts so @shared_task binds to this app.
from .celery import app as celery_app

__all__ = ("celery_app",)
