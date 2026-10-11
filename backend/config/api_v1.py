"""Versioned API routes (/api/v1/). Each app contributes its own urls module."""

from django.urls import include, path

urlpatterns = [
    path("", include("apps.core.urls")),
]
