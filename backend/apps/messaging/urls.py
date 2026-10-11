from django.urls import path

from . import views

channel_urlpatterns = [
    path(
        "<uuid:channel_id>/messages", views.ChannelMessagesView.as_view(), name="channel-messages"
    ),
]

message_urlpatterns = [
    path("<uuid:message_id>", views.MessageDetailView.as_view(), name="message"),
]
