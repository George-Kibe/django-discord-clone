from django.apps import AppConfig


class SignalstestConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'signalstest'

    def ready(self):
        import signalstest.signals

