from .base import *

DEBUG = env.bool("DJANGO_DEBUG", default=True)

# Dev is also reachable directly on :3000 (Next) and :8000 (Django), see compose.override.yaml.
CSRF_TRUSTED_ORIGINS = [*CSRF_TRUSTED_ORIGINS, "http://localhost:3000", "http://localhost:8000"]

INSTALLED_APPS += ["debug_toolbar"]
MIDDLEWARE.insert(1, "debug_toolbar.middleware.DebugToolbarMiddleware")
DEBUG_TOOLBAR_CONFIG = {"SHOW_TOOLBAR_CALLBACK": lambda request: DEBUG}

REST_FRAMEWORK["DEFAULT_RENDERER_CLASSES"] = [
    "rest_framework.renderers.JSONRenderer",
    "rest_framework.renderers.BrowsableAPIRenderer",
]

LOGGING["handlers"]["stdout"]["formatter"] = env("LOG_FORMAT", default="console")

# Serve app static files (admin, DRF, debug toolbar) straight from finders; no collectstatic in dev.
STORAGES["staticfiles"] = {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"}
WHITENOISE_USE_FINDERS = True
WHITENOISE_AUTOREFRESH = True

# Generous auth throttles locally so repeated manual/E2E runs don't lock you out.
# Unit tests run with the real limits from base.py.
REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"] |= {
    "auth_login": "100/min",
    "auth_login_email": "1000/hour",
    "auth_register": "1000/hour",
    "auth_password_reset": "1000/hour",
    "auth_verification": "1000/hour",
}
