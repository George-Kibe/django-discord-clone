"""Categories, channels, ordering and permission overwrites (FR-CH-01..03, FR-ROLE-05)."""

import re
from typing import Any

from django.db import transaction
from django.db.models import Max, Prefetch
from rest_framework import exceptions

from apps.core.permissions import Perm
from apps.realtime import events
from apps.realtime.subscriptions import compute as compute_subscriptions
from apps.servers.access import ServerAccess
from apps.servers.models import Member, Role

from .models import Category, Channel, PermissionOverwrite, ReadState


def normalize_channel_name(name: str) -> str:
    """Discord-style: lowercase, spaces -> hyphens, no other punctuation."""
    slug = re.sub(r"[^a-z0-9_\-]+", "-", name.strip().lower()).strip("-")
    slug = re.sub(r"-{2,}", "-", slug)
    if not slug:
        raise exceptions.ValidationError(
            {"name": ["Use letters, numbers, hyphens or underscores."]}
        )
    return slug[:100]


def channels_with_overwrites(server_id: Any) -> Any:
    return Channel.objects.filter(server_id=server_id).prefetch_related(
        Prefetch("overwrites", queryset=PermissionOverwrite.objects.all())
    )


def visible_channels(access: ServerAccess) -> list[tuple[Channel, Perm]]:
    """FR-CH-03: channels the member can't view are omitted entirely."""
    result = []
    for channel in channels_with_overwrites(access.server.pk):
        perms = access.channel_perms(channel)
        if perms & Perm.VIEW_CHANNEL:
            result.append((channel, perms))
    return result


def get_channel(channel_id: Any) -> Channel:
    channel = (
        Channel.objects.select_related("server")
        .prefetch_related("overwrites")
        .filter(pk=channel_id)
        .first()
    )
    if channel is None:
        raise exceptions.NotFound()
    return channel


def _category(access: ServerAccess, category_id: Any) -> Category | None:
    if category_id is None:
        return None
    category = Category.objects.filter(pk=category_id, server=access.server).first()
    if category is None:
        raise exceptions.ValidationError({"category_id": ["Unknown category."]})
    return category


# ---------------------------------------------------------------------------- categories


def create_category(access: ServerAccess, name: str) -> Category:
    access.require(Perm.MANAGE_CHANNELS)
    top = Category.objects.filter(server=access.server).aggregate(m=Max("position"))["m"]
    category = Category.objects.create(
        server=access.server, name=name, position=0 if top is None else top + 1
    )
    events.server_changed(access.server.pk, "category.created", id=str(category.pk))
    return category


def update_category(access: ServerAccess, category: Category, data: dict[str, Any]) -> Category:
    access.require(Perm.MANAGE_CHANNELS)
    for key, value in data.items():
        setattr(category, key, value)
    category.save()
    events.server_changed(access.server.pk, "category.updated", id=str(category.pk))
    return category


def delete_category(access: ServerAccess, category: Category) -> None:
    """Channels inside survive and become uncategorised."""
    access.require(Perm.MANAGE_CHANNELS)
    category_id = str(category.pk)
    category.delete()
    events.server_changed(access.server.pk, "category.deleted", id=category_id)


# ---------------------------------------------------------------------------- channels


def create_channel(access: ServerAccess, data: dict[str, Any]) -> Channel:
    access.require(Perm.MANAGE_CHANNELS)
    category = _category(access, data.pop("category_id", None))
    top = Channel.objects.filter(server=access.server, category=category).aggregate(
        m=Max("position")
    )["m"]
    channel = Channel.objects.create(
        server=access.server,
        category=category,
        name=normalize_channel_name(data.pop("name")),
        position=0 if top is None else top + 1,
        **data,
    )
    events.server_changed(access.server.pk, "channel.created", id=str(channel.pk))
    return channel


def update_channel(access: ServerAccess, channel: Channel, data: dict[str, Any]) -> Channel:
    access.require_channel(channel, Perm.MANAGE_CHANNELS)
    if "name" in data:
        data["name"] = normalize_channel_name(data["name"])
    if "category_id" in data:
        channel.category = _category(access, data.pop("category_id"))
    for key, value in data.items():
        setattr(channel, key, value)
    channel.save()
    events.server_changed(access.server.pk, "channel.updated", id=str(channel.pk))
    return channel


def delete_channel(access: ServerAccess, channel: Channel) -> None:
    access.require_channel(channel, Perm.MANAGE_CHANNELS)
    channel_id = str(channel.pk)
    channel.delete()
    events.server_changed(access.server.pk, "channel.deleted", id=channel_id)


@transaction.atomic
def reorder_channels(access: ServerAccess, items: list[dict[str, Any]]) -> None:
    """``items``: [{id, category_id, position}] for any subset of the server's channels."""
    access.require(Perm.MANAGE_CHANNELS)
    ids = [item["id"] for item in items]
    channels = {
        c.pk: c
        for c in Channel.objects.select_for_update().filter(server=access.server, pk__in=ids)
    }
    if len(channels) != len(set(ids)):
        raise exceptions.ValidationError({"channels": ["Unknown channel."]})
    categories = {c.pk: c for c in Category.objects.filter(server=access.server)}
    for item in items:
        channel = channels[item["id"]]
        category_id = item.get("category_id")
        if category_id is not None and category_id not in categories:
            raise exceptions.ValidationError({"channels": ["Unknown category."]})
        channel.category_id = category_id
        channel.position = item["position"]
    Channel.objects.bulk_update(list(channels.values()), ["category", "position"])
    events.server_changed(access.server.pk, "channel.reordered")


# ---------------------------------------------------------------------------- overwrites


@transaction.atomic
def set_overwrite(
    access: ServerAccess,
    channel: Channel,
    *,
    role_id: Any = None,
    user_id: Any = None,
    allow: int,
    deny: int,
) -> PermissionOverwrite:
    access.require_channel(channel, Perm.MANAGE_CHANNELS)
    access.require(Perm.MANAGE_ROLES)
    if (role_id is None) == (user_id is None):
        raise exceptions.ValidationError(
            {"non_field_errors": ["Give exactly one of role_id or user_id."]}
        )
    if allow & deny:
        raise exceptions.ValidationError(
            {"non_field_errors": ["A permission can't be both allowed and denied."]}
        )
    access.assert_grantable(allow | deny)
    target: dict[str, Any]
    if role_id is not None:
        role = Role.objects.filter(pk=role_id, server=access.server).first()
        if role is None:
            raise exceptions.ValidationError({"role_id": ["Unknown role."]})
        if not role.is_default and not access.can_manage_role(role):
            raise exceptions.PermissionDenied(
                "You can only manage roles below your highest role.", code="role_hierarchy"
            )
        target = {"role": role}
    else:
        member = Member.objects.filter(server=access.server, user_id=user_id).first()
        if member is None:
            raise exceptions.ValidationError({"user_id": ["Not a member of this server."]})
        target = {"member": member}
    overwrite, _ = PermissionOverwrite.objects.update_or_create(
        channel=channel, **target, defaults={"allow": allow, "deny": deny}
    )
    events.server_changed(access.server.pk, "channel.updated", id=str(channel.pk))
    return overwrite


def delete_overwrite(access: ServerAccess, channel: Channel, overwrite_id: Any) -> None:
    access.require_channel(channel, Perm.MANAGE_CHANNELS)
    access.require(Perm.MANAGE_ROLES)
    deleted, _ = PermissionOverwrite.objects.filter(pk=overwrite_id, channel=channel).delete()
    if not deleted:
        raise exceptions.NotFound()
    events.server_changed(access.server.pk, "channel.updated", id=str(channel.pk))


# ---------------------------------------------------------------------------- read states


def mark_read(user: Any, channel: Channel, message_id: Any) -> ReadState:
    """Move the read marker forward (never back) and sync the user's other tabs (FR-CH-04)."""
    state, _ = ReadState.objects.get_or_create(user=user, channel=channel)
    if state.last_read_message_id is None or message_id > state.last_read_message_id:
        state.last_read_message_id = message_id
        state.mention_count = 0
        state.save(update_fields=["last_read_message_id", "mention_count", "updated_at"])
    events.publish(
        events.user_group(user.pk),
        "read_state.updated",
        {
            "channel_id": str(channel.pk),
            "server_id": str(channel.server_id),
            "last_read_message_id": str(state.last_read_message_id),
            "mention_count": state.mention_count,
        },
    )
    return state


def read_states(user: Any) -> list[dict[str, Any]]:
    """Unread data for every channel the user can see, across all their servers."""
    visible = {cid for channels in compute_subscriptions(user).values() for cid in channels}
    states = {
        str(s.channel_id): s for s in ReadState.objects.filter(user=user, channel_id__in=visible)
    }
    rows = Channel.objects.filter(pk__in=visible).values("id", "server_id", "last_message_id")
    return [
        {
            "channel_id": str(row["id"]),
            "server_id": str(row["server_id"]),
            "last_message_id": row["last_message_id"],
            "last_read_message_id": getattr(
                states.get(str(row["id"])), "last_read_message_id", None
            ),
            "mention_count": getattr(states.get(str(row["id"])), "mention_count", 0),
        }
        for row in rows
    ]
