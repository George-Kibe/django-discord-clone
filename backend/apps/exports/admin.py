from typing import Any

from django.contrib import admin

from .models import ExportJob


@admin.register(ExportJob)
class ExportJobAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ("created_at", "requested_by", "status", "message_count", "expires_at")
    list_filter = ("status",)
    readonly_fields = [f.name for f in ExportJob._meta.fields]

    def has_add_permission(self, request: Any) -> bool:
        return False
