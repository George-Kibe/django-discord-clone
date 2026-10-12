from django.contrib import admin

from .models import Poll, PollOption


class PollOptionInline(admin.TabularInline):  # type: ignore[type-arg]
    model = PollOption
    extra = 0


@admin.register(Poll)
class PollAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ("question", "allow_multiple", "closes_at", "closed_at")
    inlines = (PollOptionInline,)
    raw_id_fields = ("message",)
