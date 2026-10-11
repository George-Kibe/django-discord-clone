from django.contrib import admin

from .models import PendingUpload


@admin.register(PendingUpload)
class PendingUploadAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ("public_id", "purpose", "user", "created_at")
    list_filter = ("purpose",)
    readonly_fields = ("public_id", "purpose", "user", "created_at")
