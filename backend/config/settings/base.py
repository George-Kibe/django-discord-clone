"""Settings shared by every environment. Environment-specific modules import * from here."""

from datetime import timedelta
from pathlib import Path
from typing import Any

import environ
from celery.schedules import crontab

BASE_DIR = Path(__file__).resolve().parent.parent.parent

env = environ.Env()

ENVIRONMENT = env("ENVIRONMENT", default="development")

SECRET_KEY = env("DJANGO_SECRET_KEY")
DEBUG = env.bool("DJANGO_DEBUG", default=False)
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=["localhost"])
CSRF_TRUSTED_ORIGINS = env.list("DJANGO_CSRF_TRUSTED_ORIGINS", default=["http://localhost"])

# Public URL of the frontend; used to build links in emails.
SITE_URL = env("NEXT_PUBLIC_SITE_URL", default="http://localhost").rstrip("/")

# --------------------------------------------------------------------------- applications

DJANGO_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "whitenoise.runserver_nostatic",
    "django.contrib.staticfiles",
    "django.contrib.postgres",
]
THIRD_PARTY_APPS = [
    "channels",
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "django_filters",
    "drf_spectacular",
]
LOCAL_APPS = [
    "apps.core",
    "apps.accounts",
    "apps.realtime",
    "apps.media",
    "apps.servers",
    "apps.chat_channels",
    "apps.messaging",
    "apps.notifications",
]
INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS

MIDDLEWARE = [
    "apps.core.middleware.RequestIDMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

# --------------------------------------------------------------------------- data stores

DATABASES = {"default": env.db("DATABASE_URL")}
DATABASES["default"]["ATOMIC_REQUESTS"] = False
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REDIS_URL = env("REDIS_URL", default="redis://redis:6379")

# Logical Redis DBs are documented in docs/ARCHITECTURE.md §2.6.
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": f"{REDIS_URL}/0",
    }
}
# Presence keys (apps/realtime/presence.py) live next to the cache.
PRESENCE_REDIS_URL = env("PRESENCE_REDIS_URL", default=f"{REDIS_URL}/0")

CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        # redis-py 8 defaults socket_timeout to 5 s, the same as channels-redis's blocking
        # BZPOPMIN, so idle consumers' reads timed out and crashed without cleanup.
        "CONFIG": {"hosts": [{"address": f"{REDIS_URL}/1", "socket_timeout": 30}]},
    }
}

# --------------------------------------------------------------------------- auth

AUTH_USER_MODEL = "accounts.User"

PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2SHA1PasswordHasher",
    "django.contrib.auth.hashers.ScryptPasswordHasher",
]

# JWTs live only in httpOnly cookies (ADR-006). See apps/accounts/cookies.py.
SIMPLE_JWT: dict[str, Any] = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=env.int("JWT_ACCESS_MINUTES", default=15)),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=env.int("JWT_REFRESH_DAYS", default=14)),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": False,  # handled by Django's user_logged_in signal
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "user_id",
}
AUTH_COOKIE_SECURE = env.bool("AUTH_COOKIE_SECURE", default=False)
AUTH_COOKIE_SAMESITE = "Lax"
# A concurrent refresh from another tab within this window is not treated as token theft.
AUTH_REFRESH_REUSE_GRACE_SECONDS = 30

PASSWORD_RESET_TIMEOUT = 60 * 60  # FR-AUTH-05: reset links expire after 1 hour
EMAIL_VERIFICATION_MAX_AGE = 60 * 60 * 24 * 3
UNVERIFIED_ACCOUNT_TTL_DAYS = 7  # FR-AUTH-02
AUTH_AUDIT_RETENTION_DAYS = 90  # NFR-PRIV-01

AUTH_PASSWORD_VALIDATORS: list[dict[str, Any]] = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 10},
    },
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# --------------------------------------------------------------------------- i18n / static

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES: dict[str, dict[str, Any]] = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}

# --------------------------------------------------------------------------- DRF

REST_FRAMEWORK: dict[str, Any] = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "apps.accounts.authentication.JWTCookieAuthentication",
        "rest_framework.authentication.SessionAuthentication",  # Django admin users
    ],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
    "DEFAULT_FILTER_BACKENDS": ["django_filters.rest_framework.DjangoFilterBackend"],
    "DEFAULT_PAGINATION_CLASS": "apps.core.pagination.PageNumberPagination",
    "PAGE_SIZE": 50,
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "EXCEPTION_HANDLER": "apps.core.exceptions.exception_handler",
    "TEST_REQUEST_DEFAULT_FORMAT": "json",
    # Initial limits from docs/API.md §1 "Rate limits".
    "DEFAULT_THROTTLE_RATES": {
        "user": "120/min",
        "anon": "30/min",
        "auth_login": "5/min",
        "auth_login_email": "10/hour",
        "auth_register": "5/hour",
        "auth_password_reset": "5/hour",
        "auth_verification": "10/hour",
        "media_sign": "30/min",
        "message_send": "10/10s",
        "invite_create": "20/hour",
    },
}

SPECTACULAR_SETTINGS: dict[str, Any] = {
    "TITLE": "Discord Clone API",
    "DESCRIPTION": (
        "REST API for the Discord clone. The WebSocket protocol is documented in docs/API.md."
    ),
    "VERSION": "0.1.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "SCHEMA_PATH_PREFIX": r"/api/v[0-9]+",
    "COMPONENT_SPLIT_REQUEST": True,
    "ENUM_NAME_OVERRIDES": {
        "UserStatusEnum": "apps.accounts.models.User.Status",
        "HealthStatusEnum": ["ok", "error"],
    },
}

# --------------------------------------------------------------------------- Celery

CELERY_BROKER_URL = env("CELERY_BROKER_URL", default=f"{REDIS_URL}/2")
CELERY_RESULT_BACKEND = env("CELERY_RESULT_BACKEND", default=f"{REDIS_URL}/3")
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
CELERY_RESULT_EXPIRES = 60 * 60 * 24
CELERY_TASK_ACKS_LATE = True
CELERY_TASK_REJECT_ON_WORKER_LOST = True
CELERY_WORKER_PREFETCH_MULTIPLIER = 1
CELERY_TASK_TIME_LIMIT = 5 * 60
CELERY_TASK_SOFT_TIME_LIMIT = 4 * 60
CELERY_TASK_DEFAULT_QUEUE = "default"
CELERY_TIMEZONE = TIME_ZONE
# Static schedule (ADR-021). Each phase adds its maintenance tasks here.
CELERY_BEAT_SCHEDULE: dict[str, dict[str, Any]] = {
    "accounts.delete_stale_unverified_users": {
        "task": "accounts.delete_stale_unverified_users",
        "schedule": crontab(hour=3, minute=10),
    },
    "accounts.prune_auth_audit_log": {
        "task": "accounts.prune_auth_audit_log",
        "schedule": crontab(hour=3, minute=20),
    },
    "accounts.flush_expired_tokens": {
        "task": "accounts.flush_expired_tokens",
        "schedule": crontab(hour=3, minute=30),
    },
    "realtime.sweep_presence": {
        "task": "realtime.sweep_presence",
        "schedule": 30.0,
    },
    "media.cleanup_orphaned_uploads": {
        "task": "media.cleanup_orphaned_uploads",
        "schedule": crontab(hour=3, minute=40),
    },
}
CELERY_BROKER_CONNECTION_RETRY_ON_STARTUP = True

# --------------------------------------------------------------------------- integrations

# The Cloudinary SDK reads CLOUDINARY_URL from the environment itself (ADR-010).
CLOUDINARY_FOLDER_PREFIX = env("CLOUDINARY_FOLDER_PREFIX", default=ENVIRONMENT)
MEDIA_UPLOAD_RULES: dict[str, dict[str, Any]] = {
    # purpose: max bytes, allowed formats (FR-PROF-02, FR-MSG-10)
    "avatar": {"max_bytes": 5 * 1024 * 1024, "formats": ["jpg", "jpeg", "png", "webp", "gif"]},
    "server_icon": {"max_bytes": 5 * 1024 * 1024, "formats": ["jpg", "jpeg", "png", "webp", "gif"]},
    # Images are stored as Cloudinary "image" resources (previews); everything else as "raw".
    "attachment": {
        "max_bytes": 10 * 1024 * 1024,
        "formats": ["jpg", "jpeg", "png", "webp", "gif"],
        "raw_formats": [
            "pdf",
            "txt",
            "md",
            "csv",
            "json",
            "zip",
            "docx",
            "xlsx",
            "pptx",
            "odt",
            "mp3",
            "mp4",
        ],
    },
}
PENDING_UPLOAD_TTL_HOURS = 24

# Django 6.1 replaces the EMAIL_* settings with MAILERS (apps/core/mail.py builds them).
# EMAIL_URL (e.g. smtp+tls://user:pass@host:587) wins; otherwise SENDER_EMAIL + EMAIL_PASSWORD
# configure Gmail. DEV_CAPTURE_EMAIL_URL (dev Compose: Mailpit) captures test-domain recipients.
from apps.core.mail import build_mailers  # noqa: E402

_GMAIL_USER = env("SENDER_EMAIL", default="")
MAILERS = build_mailers(
    email_url=env("EMAIL_URL", default=""),
    gmail_user=_GMAIL_USER,
    gmail_password=env("EMAIL_PASSWORD", default=""),
    capture_url=env("DEV_CAPTURE_EMAIL_URL", default=""),
)
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", default="Discord Clone <no-reply@localhost>")
if _GMAIL_USER and "@localhost" in DEFAULT_FROM_EMAIL:
    # Gmail only sends as the authenticated account; a localhost sender also looks like spam.
    DEFAULT_FROM_EMAIL = f"Discord Clone <{_GMAIL_USER}>"

# --------------------------------------------------------------------------- logging

LOG_LEVEL = env("LOG_LEVEL", default="INFO")
LOG_FORMAT = env("LOG_FORMAT", default="json")  # "json" | "console"

LOGGING: dict[str, Any] = {
    "version": 1,
    "disable_existing_loggers": False,
    "filters": {"request_id": {"()": "apps.core.logging.RequestIDFilter"}},
    "formatters": {
        "json": {
            "()": "pythonjsonlogger.json.JsonFormatter",
            "format": "%(asctime)s %(levelname)s %(name)s %(message)s %(request_id)s",
            "rename_fields": {"asctime": "time", "levelname": "level", "name": "logger"},
        },
        "console": {"format": "%(asctime)s %(levelname)-8s [%(request_id)s] %(name)s: %(message)s"},
    },
    "handlers": {
        "stdout": {
            "class": "logging.StreamHandler",
            "formatter": LOG_FORMAT,
            "filters": ["request_id"],
        },
    },
    "root": {"handlers": ["stdout"], "level": LOG_LEVEL},
    "loggers": {
        "django.db.backends": {"level": "WARNING"},
        "uvicorn.access": {"level": "WARNING"},  # Caddy writes access logs
    },
}
