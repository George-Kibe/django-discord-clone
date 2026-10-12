from django.urls import path

from . import views

channel_urlpatterns = [
    path(
        "<uuid:channel_id>/messages", views.ChannelMessagesView.as_view(), name="channel-messages"
    ),
    path("<uuid:channel_id>/pins", views.ChannelPinsView.as_view(), name="channel-pins"),
]

server_urlpatterns = [
    path(
        "<uuid:server_id>/messages/search",
        views.ServerSearchView.as_view(),
        name="server-message-search",
    ),
]

message_urlpatterns = [
    path("<uuid:message_id>", views.MessageDetailView.as_view(), name="message"),
    path("<uuid:message_id>/pin", views.MessagePinView.as_view(), name="message-pin"),
    path("<uuid:message_id>/report", views.MessageReportView.as_view(), name="message-report"),
    path(
        "<uuid:message_id>/reactions/<str:emoji>",
        views.ReactionView.as_view(),
        name="message-reaction",
    ),
]

dm_urlpatterns = [
    path("", views.DMListView.as_view(), name="dms"),
    path("<uuid:dm_id>", views.DMDetailView.as_view(), name="dm"),
    path("<uuid:dm_id>/messages", views.DMMessagesView.as_view(), name="dm-messages"),
    path("<uuid:dm_id>/messages/search", views.DMSearchView.as_view(), name="dm-message-search"),
    path("<uuid:dm_id>/pins", views.DMPinsView.as_view(), name="dm-pins"),
    path("<uuid:dm_id>/ack", views.DMAckView.as_view(), name="dm-ack"),
    path("<uuid:dm_id>/participants", views.DMParticipantsView.as_view(), name="dm-participants"),
    path(
        "<uuid:dm_id>/participants/<uuid:user_id>",
        views.DMParticipantView.as_view(),
        name="dm-participant",
    ),
]
