"""Versioned API routes (/api/v1/). Each app contributes its own urls module."""

from django.urls import include, path

urlpatterns = [
    path("", include("apps.core.urls")),
    path("auth/", include("apps.accounts.auth_urls")),
    path("users/", include("apps.accounts.user_urls")),
    path("media/", include("apps.media.urls")),
]
