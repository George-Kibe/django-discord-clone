"""User-level real-time notifications triggered from account changes."""

from typing import Any

from apps.servers.models import Member

from . import events, presence


def _server_ids(user_id: Any) -> list[Any]:
    return list(Member.objects.filter(user_id=user_id).values_list("server_id", flat=True))


def user_updated(user_id: Any) -> None:
    """Name/avatar changed: member lists refresh wherever the user appears."""
    for server_id in _server_ids(user_id):
        events.publish(
            events.server_group(server_id),
            "user.updated",
            {"user_id": str(user_id), "server_id": str(server_id)},
        )


def status_changed(user_id: Any, status: str) -> None:
    """Chosen status changed over REST (the gateway handles presence.set itself)."""
    if not presence.set_status_sync(user_id, status):
        return  # offline: nothing to show until they connect
    for server_id in _server_ids(user_id):
        events.publish(
            events.server_group(server_id),
            "presence.updated",
            {
                "user_id": str(user_id),
                "status": presence.visible_status(status),
                "server_id": str(server_id),
            },
        )


def revoke_sockets(user_id: Any) -> None:
    """Close every open gateway connection (password change/reset). Clients that still hold a
    valid refresh token reconnect; revoked sessions can't."""
    events.control(events.user_group(user_id), "close", code=4401)
