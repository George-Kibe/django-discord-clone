from django.apps import AppConfig


class CoreConfig(AppConfig):
    name = "apps.core"
    label = "core"

    def ready(self) -> None:
        # Request-ID propagation into Celery: publishers (api) and workers both need the signals.
        from . import celery_context  # noqa: F401
