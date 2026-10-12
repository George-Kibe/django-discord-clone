from django.conf import settings
from django.db import models
from django.db.models import Q

from apps.core.models import UUIDModel

MIN_OPTIONS = 2
MAX_OPTIONS = 10


class Poll(UUIDModel):
    """A poll attached to a message (FR-POLL-01..04)."""

    message = models.OneToOneField(
        "messaging.Message", on_delete=models.CASCADE, related_name="poll"
    )
    question = models.CharField(max_length=300)
    allow_multiple = models.BooleanField(default=False)
    closes_at = models.DateTimeField(null=True, blank=True, db_index=True)
    closed_at = models.DateTimeField(null=True, blank=True)

    def __str__(self) -> str:
        return self.question

    @property
    def is_closed(self) -> bool:
        return self.closed_at is not None


class PollOption(models.Model):
    poll = models.ForeignKey(Poll, on_delete=models.CASCADE, related_name="options")
    text = models.CharField(max_length=100)
    position = models.PositiveSmallIntegerField()

    class Meta:
        ordering = ["position"]

    def __str__(self) -> str:
        return self.text


class PollVote(models.Model):
    poll = models.ForeignKey(Poll, on_delete=models.CASCADE, related_name="votes")
    option = models.ForeignKey(PollOption, on_delete=models.CASCADE, related_name="votes")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="poll_votes"
    )
    single_choice = models.BooleanField()  # copied from the poll, for the constraint below
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["option", "user"], name="unique_vote_per_option"),
            models.UniqueConstraint(
                fields=["poll", "user"],
                condition=Q(single_choice=True),
                name="one_vote_in_single_choice_poll",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.user_id} → {self.option_id}"
