from django.urls import path

from . import views

urlpatterns = [
    path("me", views.MeView.as_view(), name="users-me"),
    path("me/email", views.EmailChangeView.as_view(), name="users-me-email"),
    path("me/avatar", views.AvatarView.as_view(), name="users-me-avatar"),
    path("<uuid:pk>", views.UserDetailView.as_view(), name="users-detail"),
]
