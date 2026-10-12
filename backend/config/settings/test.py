from .base import *

DEBUG = False
SECRET_KEY = "test-insecure-secret-key-not-for-production"  # noqa: S105
ALLOWED_HOSTS = ["localhost", "testserver", "api"]

# Fast hashing in tests; Argon2 is exercised by the production settings check.
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]

CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
# A dedicated Redis DB for presence tests (flushed per test); never the dev/prod data.
PRESENCE_REDIS_URL = f"{REDIS_URL}/15"

CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = True

MAILERS = {"default": {"BACKEND": "django.core.mail.backends.locmem.EmailBackend"}}
STORAGES["staticfiles"] = {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"}
MIDDLEWARE = [m for m in MIDDLEWARE if not m.startswith("whitenoise")]

LOGGING["handlers"]["stdout"]["formatter"] = "console"
LOGGING["root"]["level"] = "WARNING"
