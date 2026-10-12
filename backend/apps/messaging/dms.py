"""Direct messages (FR-DM-01..04). Messages themselves go through services.py with a DM Target."""

from typing import Any

from django.db import IntegrityError, transaction
from django.db.models import Q
from rest_framework import exceptions

from apps.accounts.blocks import either_blocked
from apps.accounts.models import User
from apps.realtime import events
from apps.servers.models import Member

from .models import MAX_GROUP_DM_SIZE, DMConversation, DMParticipant
from .targets import Target


def shares_server(a: Any, b: Any) -> bool:
    return Member.objects.filter(user_id=a, server__members__user_id=b).exists()


def contacts(user: User, query: str = "", limit: int = 25) -> list[User]:
    """People you can DM: everyone who shares a server with you (FR-DM-01)."""
    qs = (
        User.objects.filter(memberships__server__members__user=user, is_active=True)
        .exclude(pk=user.pk)
        .distinct()
    )
    if query:
        qs = qs.filter(Q(username__icontains=query) | Q(display_name__icontains=query))
    return list(qs.order_by("username")[:limit])


def _check_reachable(user: User, others: list[Any]) -> None:
    for other in others:
        if not shares_server(user.pk, other):
            raise exceptions.ValidationError(
                {"user_ids": ["You can only message people you share a server with."]},
                code="no_shared_server",
            )
        if either_blocked(user.pk, other):
            raise exceptions.PermissionDenied("You can't message this user.", code="blocked")


def _announce_new(conversation: DMConversation, user_ids: list[Any]) -> None:
    for user_id in user_ids:
        events.dm_membership_changed(user_id, conversation.pk, joined=True)
        events.to_user(user_id, "dm.created", {"dm_id": str(conversation.pk)})


def _announce_updated(conversation: DMConversation) -> None:
    for user_id in DMParticipant.objects.filter(conversation=conversation).values_list(
        "user_id", flat=True
    ):
        events.to_user(user_id, "dm.updated", {"dm_id": str(conversation.pk)})


@transaction.atomic
def open_dm(user: User, user_ids: list[Any], name: str = "") -> tuple[DMConversation, bool]:
    """One other user: the existing 1:1 conversation (reopened) or a new one. More: a group."""
    others = list(dict.fromkeys(uid for uid in user_ids if uid != user.pk))
    if not others:
        raise exceptions.ValidationError({"user_ids": ["Pick at least one other person."]})
    if not User.objects.filter(pk__in=others, is_active=True).count() == len(others):
        raise exceptions.ValidationError({"user_ids": ["Unknown user."]})
    _check_reachable(user, others)
    if len(others) == 1:
        key = ":".join(sorted([str(user.pk), str(others[0])]))
        existing = DMConversation.objects.filter(dm_key=key).first()
        if existing is not None:
            reopened = DMParticipant.objects.filter(
                conversation=existing, user=user, closed=True
            ).update(closed=False)
            if reopened:
                events.to_user(user.pk, "dm.updated", {"dm_id": str(existing.pk)})
            return existing, False
        try:
            with transaction.atomic():
                conversation = DMConversation.objects.create(dm_key=key)
        except IntegrityError:  # opened concurrently by the other side
            return DMConversation.objects.get(dm_key=key), False
    else:
        if len(others) + 1 > MAX_GROUP_DM_SIZE:
            raise exceptions.ValidationError(
                {"user_ids": [f"Group DMs have at most {MAX_GROUP_DM_SIZE} people."]}
            )
        conversation = DMConversation.objects.create(is_group=True, owner=user, name=name.strip())
    members = [user.pk, *others]
    DMParticipant.objects.bulk_create(
        [DMParticipant(conversation=conversation, user_id=uid) for uid in members]
    )
    _announce_new(conversation, members)
    return conversation, True


def conversations(user: User) -> tuple[list[DMConversation], dict[str, Any]]:
    """Open conversations, most recent activity first, plus serializer context."""
    mine = {
        p.conversation_id: p
        for p in DMParticipant.objects.filter(user=user, closed=False).select_related(
            "conversation"
        )
    }
    items = sorted(
        (p.conversation for p in mine.values()),
        key=lambda c: str(c.last_message_id or c.pk),
        reverse=True,
    )
    return items, context_for(user, items, mine)


def context_for(
    user: User, items: list[DMConversation], mine: dict[Any, DMParticipant] | None = None
) -> dict[str, Any]:
    ids = [c.pk for c in items]
    if mine is None:
        mine = {
            p.conversation_id: p
            for p in DMParticipant.objects.filter(user=user, conversation_id__in=ids)
        }
    participants: dict[Any, list[User]] = {}
    for p in (
        DMParticipant.objects.filter(conversation_id__in=ids)
        .select_related("user")
        .order_by("joined_at", "id")
    ):
        participants.setdefault(p.conversation_id, []).append(p.user)
    from apps.realtime.presence import get_presence

    everyone = {u.pk for users in participants.values() for u in users}
    return {
        "user": user,
        "me": mine,
        "participants": participants,
        "presence": get_presence(everyone),
    }


def update(target: Target, *, name: str | None = None, closed: bool | None = None) -> None:
    dm = target.dm
    if dm is None:
        raise exceptions.NotFound()
    if name is not None:
        if not dm.is_group:
            raise exceptions.ValidationError({"name": ["Only group DMs have a name."]})
        dm.name = name.strip()
        dm.save(update_fields=["name", "updated_at"])
        _announce_updated(dm)
    if closed is not None:
        DMParticipant.objects.filter(conversation=dm, user=target.user).update(closed=closed)
        events.to_user(target.user.pk, "dm.updated", {"dm_id": str(dm.pk)})


@transaction.atomic
def add_participants(target: Target, user_ids: list[Any]) -> None:
    dm = target.dm
    if dm is None or not dm.is_group:
        raise exceptions.ValidationError({"user_ids": ["Only group DMs can add people."]})
    current = set(DMParticipant.objects.filter(conversation=dm).values_list("user_id", flat=True))
    new = [uid for uid in dict.fromkeys(user_ids) if uid not in current]
    if len(current) + len(new) > MAX_GROUP_DM_SIZE:
        raise exceptions.ValidationError(
            {"user_ids": [f"Group DMs have at most {MAX_GROUP_DM_SIZE} people."]}
        )
    if not new:
        return
    _check_reachable(target.user, new)
    DMParticipant.objects.bulk_create([DMParticipant(conversation=dm, user_id=uid) for uid in new])
    _announce_new(dm, new)
    _announce_updated(dm)


@transaction.atomic
def remove_participant(target: Target, user_id: Any) -> None:
    """Leave (yourself) or, as the group owner, remove someone."""
    dm = target.dm
    if dm is None or not dm.is_group:
        raise exceptions.ValidationError({"user_id": ["You can only leave group DMs."]})
    if user_id != target.user.pk and dm.owner_id != target.user.pk:
        raise exceptions.PermissionDenied(
            "Only the group owner can remove people.", code="not_owner"
        )
    deleted, _ = DMParticipant.objects.filter(conversation=dm, user_id=user_id).delete()
    if not deleted:
        raise exceptions.NotFound()
    events.dm_membership_changed(user_id, dm.pk, joined=False)
    events.to_user(user_id, "dm.removed", {"dm_id": str(dm.pk)})
    remaining = DMParticipant.objects.filter(conversation=dm).order_by("joined_at", "id")
    if not remaining.exists():
        dm.delete()
        return
    if dm.owner_id == user_id:
        dm.owner_id = remaining.first().user_id  # type: ignore[union-attr]
        dm.save(update_fields=["owner", "updated_at"])
    _announce_updated(dm)
