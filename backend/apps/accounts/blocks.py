"""Blocking (FR-DM-04): a block stops DMs between the pair and hides the blocked user's
messages from the blocker (collapsed in the client)."""

from typing import Any

from django.db.models import Q
from rest_framework import exceptions

from .models import BlockedUser, User


def blocked_ids(user: User) -> set[Any]:
    """Users ``user`` has blocked."""
    return set(BlockedUser.objects.filter(blocker=user).values_list("blocked_id", flat=True))


def blockers_of(author_id: Any, user_ids: Any) -> set[Any]:
    """Which of ``user_ids`` have blocked ``author_id``."""
    return set(
        BlockedUser.objects.filter(blocked_id=author_id, blocker_id__in=list(user_ids)).values_list(
            "blocker_id", flat=True
        )
    )


def either_blocked(a: Any, b: Any) -> bool:
    return BlockedUser.objects.filter(
        Q(blocker_id=a, blocked_id=b) | Q(blocker_id=b, blocked_id=a)
    ).exists()


def block(user: User, target: User) -> None:
    if target.pk == user.pk:
        raise exceptions.ValidationError({"user_id": ["You can't block yourself."]})
    BlockedUser.objects.get_or_create(blocker=user, blocked=target)


def unblock(user: User, target_id: Any) -> None:
    BlockedUser.objects.filter(blocker=user, blocked_id=target_id).delete()
