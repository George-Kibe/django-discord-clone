from django.urls import path

from . import views

server_urlpatterns = [
    path("<uuid:server_id>/categories", views.CategoryListView.as_view(), name="server-categories"),
    path("<uuid:server_id>/channels", views.ChannelListView.as_view(), name="server-channels"),
    path(
        "<uuid:server_id>/channels/reorder",
        views.ChannelReorderView.as_view(),
        name="server-channels-reorder",
    ),
]

category_urlpatterns = [
    path("<uuid:category_id>", views.CategoryDetailView.as_view(), name="category"),
]

channel_urlpatterns = [
    path("<uuid:channel_id>", views.ChannelDetailView.as_view(), name="channel"),
    path(
        "<uuid:channel_id>/overwrites", views.OverwriteListView.as_view(), name="channel-overwrites"
    ),
    path(
        "<uuid:channel_id>/overwrites/<uuid:overwrite_id>",
        views.OverwriteDetailView.as_view(),
        name="channel-overwrite",
    ),
]
