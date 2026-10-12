from typing import Any

from django.contrib import admin, messages
from django.utils import timezone

from .models import MessageReport


@admin.register(MessageReport)
class MessageReportAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    """FR-MOD-03: reports land here for site staff."""

    list_display = ("created_at", "status", "reporter", "message_author", "reason")
    list_filter = ("status",)
    search_fields = ("reason", "content_snapshot", "reporter__username")
    readonly_fields = (
        "message",
        "reporter",
        "reason",
        "content_snapshot",
        "created_at",
        "resolved_at",
    )
    actions = ("mark_resolved", "mark_dismissed")

    @admin.display(description="Author")
    def message_author(self, report: MessageReport) -> str:
        author = report.message.author
        return author.username if author else "Deleted User"

    def _close(self, request: Any, queryset: Any, status: str) -> None:
        count = queryset.filter(status=MessageReport.Status.OPEN).update(
            status=status, resolved_at=timezone.now()
        )
        self.message_user(request, f"{count} report(s) updated.", messages.SUCCESS)

    @admin.action(description="Mark as resolved")
    def mark_resolved(self, request: Any, queryset: Any) -> None:
        self._close(request, queryset, MessageReport.Status.RESOLVED)

    @admin.action(description="Dismiss")
    def mark_dismissed(self, request: Any, queryset: Any) -> None:
        self._close(request, queryset, MessageReport.Status.DISMISSED)

    def has_add_permission(self, request: Any) -> bool:
        return False
