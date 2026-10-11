from django.urls import path

from . import views

urlpatterns = [
    path("csrf", views.CSRFView.as_view(), name="auth-csrf"),
    path("register", views.RegisterView.as_view(), name="auth-register"),
    path("login", views.LoginView.as_view(), name="auth-login"),
    path("refresh", views.RefreshView.as_view(), name="auth-refresh"),
    path("logout", views.LogoutView.as_view(), name="auth-logout"),
    path("verify-email", views.VerifyEmailView.as_view(), name="auth-verify-email"),
    path(
        "resend-verification",
        views.ResendVerificationView.as_view(),
        name="auth-resend-verification",
    ),
    path("password/reset", views.PasswordResetView.as_view(), name="auth-password-reset"),
    path(
        "password/reset/confirm",
        views.PasswordResetConfirmView.as_view(),
        name="auth-password-reset-confirm",
    ),
    path("password/change", views.PasswordChangeView.as_view(), name="auth-password-change"),
]
