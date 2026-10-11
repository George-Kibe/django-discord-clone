from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin
from django.contrib.auth.forms import UserChangeForm, UserCreationForm

from .models import User


class AccountCreationForm(UserCreationForm):  # type: ignore[type-arg]
    class Meta:
        model = User
        fields = ("email", "username")


class AccountChangeForm(UserChangeForm):  # type: ignore[type-arg]
    class Meta:
        model = User
        fields = "__all__"


@admin.register(User)
class UserAdmin(DjangoUserAdmin):  # type: ignore[type-arg]
    form = AccountChangeForm
    add_form = AccountCreationForm
    ordering = ("username",)
    list_display = (
        "username",
        "email",
        "display_name",
        "is_staff",
        "is_active",
        "email_verified_at",
    )
    list_filter = ("is_staff", "is_superuser", "is_active")
    search_fields = ("username", "email", "display_name")
    readonly_fields = ("last_login", "date_joined", "last_seen_at")
    fieldsets = (
        (None, {"fields": ("email", "username", "password")}),
        ("Profile", {"fields": ("display_name", "bio", "avatar_public_id", "status")}),
        ("Verification", {"fields": ("email_verified_at",)}),
        (
            "Permissions",
            {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")},
        ),
        ("Activity", {"fields": ("last_login", "last_seen_at", "date_joined")}),
    )
    add_fieldsets = (
        (
            None,
            {
                "classes": ("wide",),
                "fields": ("email", "username", "password1", "password2"),
            },
        ),
    )
