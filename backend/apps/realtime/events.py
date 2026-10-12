"""Publishing real-time events to Channels groups (ADR-007, docs/API.md §3).

Everything is sent from ``transaction.on_commit`` so a rolled-back write never broadcasts.

- ``realtime.event``: forwarded to clients as ``{"op": "event", "type": ..., "data": ...}``
- ``realtime.control``: instructions for the consumers themselves (re-check subscriptions,
  join a server, close the socket); never forwarded as-is
"""

import json
from typing import Any

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction


def user_group(user_id: Any) -> str:
    return f"user.{user_id}"


def server_group(server_id: Any) -> str:
    return f"server.{server_id}"


def channel_group(channel_id: Any) -> str:
    return f"channel.{channel_id}"


def _plain(data: Any) -> Any:
    """Serializer output -> msgpack-safe primitives (UUIDs, datetimes, OrderedDicts)."""
    return json.loads(json.dumps(data, cls=DjangoJSONEncoder))


def send_now(group: str, payload: dict[str, Any]) -> None:
    layer = get_channel_layer()
    if layer is not None:
        async_to_sync(layer.group_send)(group, payload)


def publish(group: str, event: str, data: Any) -> None:
    payload = {"type": "realtime.event", "event": event, "data": _plain(data)}
    transaction.on_commit(lambda: send_now(group, payload))


def control(group: str, action: str, **data: Any) -> None:
    payload = {"type": "realtime.control", "action": action, **_plain(data)}
    transaction.on_commit(lambda: send_now(group, payload))


# ---------------------------------------------------------------------------- shortcuts


def server_changed(server_id: Any, event: str, **data: Any) -> None:
    """A structural change in a server: notify viewers and let consumers re-check access."""
    publish(server_group(server_id), event, {"server_id": str(server_id), **data})
    control(server_group(server_id), "resync", server_id=str(server_id))


def membership_changed(user_id: Any, server_id: Any) -> None:
    """One user's access to a server changed (roles, joined, left, kicked)."""
    control(user_group(user_id), "resync", server_id=str(server_id))
