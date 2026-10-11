from .base import *

DEBUG = env.bool("DJANGO_DEBUG", default=True)

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
