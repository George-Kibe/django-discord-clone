"""Versioned API routes (/api/v1/). Each app contributes its own urls module."""

from django.urls import include, path

from apps.chat_channels import urls as channel_urls
from apps.chat_channels.views import ReadStateListView
from apps.messaging import urls as message_urls
from apps.servers import urls as server_urls
from apps.servers.views import ServerListView, TopicListView

urlpatterns = [
    path("", include("apps.core.urls")),
    path("auth/", include("apps.accounts.auth_urls")),
    path("users/", include("apps.accounts.user_urls")),
    path("media/", include("apps.media.urls")),
    path("servers", ServerListView.as_view(), name="servers"),  # no trailing slash, like all routes
    path("servers/", include(server_urls.server_urlpatterns + channel_urls.server_urlpatterns)),
    path("invites/", include(server_urls.invite_urlpatterns)),
    path("topics", TopicListView.as_view(), name="topics"),
    path("categories/", include(channel_urls.category_urlpatterns)),
    path("channels/", include(channel_urls.channel_urlpatterns + message_urls.channel_urlpatterns)),
    path("messages/", include(message_urls.message_urlpatterns)),
    path("read-states", ReadStateListView.as_view(), name="read-states"),
]
