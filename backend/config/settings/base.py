"""Settings shared by every environment. Environment-specific modules import * from here."""

from pathlib import Path
from typing import Any

import environ

BASE_DIR = Path(__file__).resolve().parent.parent.parent

env = environ.Env()

ENVIRONMENT = env("ENVIRONMENT", default="development")

SECRET_KEY = env("DJANGO_SECRET_KEY")
DEBUG = env.bool("DJANGO_DEBUG", default=False)
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=["localhost"])
CSRF_TRUSTED_ORIGINS = env.list("DJANGO_CSRF_TRUSTED_ORIGINS", default=["http://localhost"])

# --------------------------------------------------------------------------- applications

DJANGO_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "whitenoise.runserver_nostatic",
    "django.contrib.staticfiles",
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
CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {"hosts": [f"{REDIS_URL}/1"]},
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

AUTH_PASSWORD_VALIDATORS = [
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
        # JWT cookie authentication is added in Phase 1 (ADR-006).
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
    "DEFAULT_FILTER_BACKENDS": ["django_filters.rest_framework.DjangoFilterBackend"],
    "DEFAULT_PAGINATION_CLASS": "apps.core.pagination.PageNumberPagination",
    "PAGE_SIZE": 50,
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "EXCEPTION_HANDLER": "apps.core.exceptions.exception_handler",
    "DEFAULT_THROTTLE_RATES": {"user": "120/min", "anon": "30/min"},
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
# Static schedule (ADR-021). Phase-specific maintenance tasks are added here as they land.
CELERY_BEAT_SCHEDULE: dict[str, dict[str, object]] = {}
CELERY_BROKER_CONNECTION_RETRY_ON_STARTUP = True

# --------------------------------------------------------------------------- integrations

CLOUDINARY_URL = env("CLOUDINARY_URL", default="")
CLOUDINARY_FOLDER_PREFIX = env("CLOUDINARY_FOLDER_PREFIX", default=ENVIRONMENT)

# Django 6.1 replaces the EMAIL_* settings with MAILERS. EMAIL_URL (e.g. smtp+tls://user:pass@host:587)
# is parsed by django-environ and translated into the new structure.
_email = env.email_url("EMAIL_URL", default="consolemail://")
_SMTP_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
_smtp_options = {
    "host": _email.get("EMAIL_HOST"),
    "port": _email.get("EMAIL_PORT"),
    "username": _email.get("EMAIL_HOST_USER"),
    "password": _email.get("EMAIL_HOST_PASSWORD"),
    "use_tls": _email.get("EMAIL_USE_TLS"),
    "use_ssl": _email.get("EMAIL_USE_SSL"),
    "timeout": 10,
}
MAILERS = {
    "default": {
        "BACKEND": _email["EMAIL_BACKEND"],
        "OPTIONS": (
            {k: v for k, v in _smtp_options.items() if v not in (None, "")}
            if _email["EMAIL_BACKEND"] == _SMTP_BACKEND
            else {}
        ),
    }
}
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", default="Discord Clone <no-reply@localhost>")

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
