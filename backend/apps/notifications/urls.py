from django.urls import path

from . import views

urlpatterns = [
    path("notifications", views.NotificationListView.as_view(), name="notifications"),
    path("notifications/read", views.NotificationReadView.as_view(), name="notifications-read"),
    path("mute-settings", views.MuteSettingsView.as_view(), name="mute-settings"),
]
