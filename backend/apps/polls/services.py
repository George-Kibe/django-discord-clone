"""Polls (FR-POLL-01..04): created with a message, live results, auto-close."""

from datetime import timedelta
from typing import Any

from django.db import transaction
from django.db.models import Count
from django.utils import timezone
from rest_framework import exceptions

from apps.core.permissions import Perm
from apps.realtime import events

from .models import MAX_OPTIONS, MIN_OPTIONS, Poll, PollOption, PollVote

MAX_DURATION = timedelta(days=7)


def create(
    message: Any,
    *,
    question: str,
    options: list[str],
    allow_multiple: bool,
    duration_minutes: int | None = None,
) -> Poll:
    texts = [o.strip() for o in options if o.strip()]
    if not MIN_OPTIONS <= len(texts) <= MAX_OPTIONS:
        raise exceptions.ValidationError(
            {"poll": [f"A poll needs {MIN_OPTIONS} to {MAX_OPTIONS} options."]}
        )
    if len({t.lower() for t in texts}) != len(texts):
        raise exceptions.ValidationError({"poll": ["Options must be different."]})
    closes_at = None
    if duration_minutes:
        closes_at = timezone.now() + min(timedelta(minutes=duration_minutes), MAX_DURATION)
    poll = Poll.objects.create(
        message=message,
        question=question.strip(),
        allow_multiple=allow_multiple,
        closes_at=closes_at,
    )
    PollOption.objects.bulk_create(
        [PollOption(poll=poll, text=text, position=i) for i, text in enumerate(texts)]
    )
    if closes_at is not None:
        from .tasks import close_poll

        transaction.on_commit(lambda: close_poll.apply_async(args=(str(poll.pk),), eta=closes_at))
    return poll


def summaries(message_ids: list[Any], user: Any) -> dict[Any, dict[str, Any]]:
    """{message_id: poll summary} incl. the viewer's own votes (``my_votes``)."""
    polls = list(Poll.objects.filter(message_id__in=message_ids).prefetch_related("options"))
    if not polls:
        return {}
    ids = [p.pk for p in polls]
    counts = {
        row["option_id"]: row["n"]
        for row in PollVote.objects.filter(poll_id__in=ids)
        .values("option_id")
        .annotate(n=Count("id"))
    }
    voters = {
        row["poll_id"]: row["n"]
        for row in PollVote.objects.filter(poll_id__in=ids)
        .values("poll_id")
        .annotate(n=Count("user_id", distinct=True))
    }
    mine: dict[Any, list[int]] = {}
    if user is not None:
        for poll_id, option_id in PollVote.objects.filter(poll_id__in=ids, user=user).values_list(
            "poll_id", "option_id"
        ):
            mine.setdefault(poll_id, []).append(option_id)
    return {
        p.message_id: {
            "id": str(p.pk),
            "question": p.question,
            "allow_multiple": p.allow_multiple,
            "closes_at": p.closes_at,
            "closed_at": p.closed_at,
            "options": [
                {"id": o.pk, "text": o.text, "votes": counts.get(o.pk, 0)} for o in p.options.all()
            ],
            "total_voters": voters.get(p.pk, 0),
            "my_votes": mine.get(p.pk, []),
        }
        for p in polls
    }


def _publish(poll: Poll, voter: Any = None, option_ids: list[int] | None = None) -> None:
    from apps.messaging.targets import message_scope

    summary = summaries([poll.message_id], None)[poll.message_id]
    summary.pop("my_votes")
    scope, group = message_scope(poll.message)
    events.publish(
        group,
        "poll.updated",
        {
            "message_id": str(poll.message_id),
            "poll": summary,
            # Lets the voter's other tabs update their own selection.
            "voter_id": str(voter.pk) if voter is not None else None,
            "voter_option_ids": option_ids,
            **scope,
        },
    )


def _ensure_open(poll: Poll) -> None:
    if poll.closed_at is not None or (poll.closes_at and poll.closes_at <= timezone.now()):
        raise exceptions.ValidationError({"poll": ["This poll is closed."]}, code="poll_closed")


@transaction.atomic
def vote(target: Any, poll: Poll, user: Any, option_ids: list[Any]) -> None:
    """Replace the user's vote (FR-POLL-02)."""
    target.require(Perm.READ_MESSAGE_HISTORY)
    poll = Poll.objects.select_for_update().get(pk=poll.pk)
    _ensure_open(poll)
    valid = {o.pk: o for o in poll.options.all()}
    chosen = list(dict.fromkeys(option_ids))
    if not chosen or any(o not in valid for o in chosen):
        raise exceptions.ValidationError({"option_ids": ["Pick options from this poll."]})
    if not poll.allow_multiple and len(chosen) > 1:
        raise exceptions.ValidationError({"option_ids": ["This poll allows one choice."]})
    PollVote.objects.filter(poll=poll, user=user).delete()
    PollVote.objects.bulk_create(
        [
            PollVote(poll=poll, option_id=o, user=user, single_choice=not poll.allow_multiple)
            for o in chosen
        ]
    )
    _publish(poll, user, chosen)


@transaction.atomic
def withdraw(target: Any, poll: Poll, user: Any) -> None:
    target.require(Perm.READ_MESSAGE_HISTORY)
    _ensure_open(poll)
    PollVote.objects.filter(poll=poll, user=user).delete()
    _publish(poll, user, [])


def close(target: Any, poll: Poll) -> Poll:
    """FR-POLL-04: the author or someone with Manage Messages."""
    if poll.message.author_id != target.user.pk and not target.has(Perm.MANAGE_MESSAGES):
        raise exceptions.PermissionDenied(
            "Only the author or a moderator can close this poll.", code="not_author"
        )
    return close_now(poll)


def close_now(poll: Poll) -> Poll:
    updated = Poll.objects.filter(pk=poll.pk, closed_at__isnull=True).update(
        closed_at=timezone.now()
    )
    poll.refresh_from_db()
    if updated:
        _publish(poll)
    return poll
