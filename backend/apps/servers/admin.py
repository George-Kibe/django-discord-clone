from typing import Any

from django.contrib import admin

from .models import Ban, Server, ServerAuditEvent, Topic


@admin.register(Topic)
class TopicAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ("name", "slug")
    prepopulated_fields = {"slug": ("name",)}


@admin.register(Server)
class ServerAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    """Staff can delete servers here (FR-MOD-04)."""

    list_display = ("name", "owner", "is_public", "topic", "member_count", "created_at")
    list_filter = ("is_public", "topic")
    search_fields = ("name", "description", "owner__username", "owner__email")
    readonly_fields = ("member_count", "created_at", "updated_at")
    raw_id_fields = ("owner",)


@admin.register(Ban)
class BanAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ("server", "user", "moderator", "reason", "created_at")
    search_fields = ("server__name", "user__username")
    raw_id_fields = ("server", "user", "moderator")


@admin.register(ServerAuditEvent)
class ServerAuditEventAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ("created_at", "server", "action", "actor", "target_label")
    list_filter = ("action",)
    search_fields = ("server__name", "actor__username", "target_label")
    readonly_fields = [f.name for f in ServerAuditEvent._meta.fields]

    def has_add_permission(self, request: Any) -> bool:
        return False

    def has_change_permission(self, request: Any, obj: Any = None) -> bool:
        return False
