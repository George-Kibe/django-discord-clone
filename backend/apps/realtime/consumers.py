import asyncio
import time
import uuid
from collections import deque
from typing import Any

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from apps.accounts.models import User
from apps.core.permissions import Perm

from . import presence, subscriptions
from .events import channel_group, dm_group, server_group, user_group


class PingConsumer(AsyncJsonWebsocketConsumer):
    """Public connectivity check: replies to {"op": "request", "type": "ping"} with a pong."""

    async def connect(self) -> None:
        await self.accept()
        await self.send_json({"op": "event", "type": "ready", "data": {}})

    async def receive_json(self, content: Any, **kwargs: Any) -> None:
        if isinstance(content, dict) and content.get("type") == "ping":
            await self.send_json(
                {"op": "response", "type": "pong", "id": content.get("id"), "data": {}}
            )
        else:
            await self.close(code=4400)


@database_sync_to_async
def _subscriptions(user: User) -> subscriptions.Subscriptions:
    return subscriptions.compute(user)


@database_sync_to_async
def _server_subscriptions(user: User, server_id: str) -> dict[str, int] | None:
    return subscriptions.compute_server(user, server_id)


@database_sync_to_async
def _dm_ids(user: User) -> list[str]:
    from apps.messaging.models import DMParticipant

    return [
        str(dm_id)
        for dm_id in DMParticipant.objects.filter(user=user).values_list(
            "conversation_id", flat=True
        )
    ]


@database_sync_to_async
def _save_status(user: User, status: str) -> None:
    User.objects.filter(pk=user.pk).update(status=status)


class GatewayConsumer(AsyncJsonWebsocketConsumer):
    """Authenticated real-time gateway (docs/API.md §3, ADR-024).

    Subscriptions are automatic: the user's group, every server they belong to and every channel
    they can view. ``realtime.control`` messages keep them in sync with permission changes.
    """

    HEARTBEAT_INTERVAL_MS = 30_000
    TYPING_COOLDOWN = 2.0  # seconds between typing.start broadcasts per channel
    TYPING_TTL = 8
    FRAME_LIMIT = 60  # frames per FRAME_WINDOW before closing with 4429
    FRAME_WINDOW = 10.0
    STATUSES = {"online", "idle", "dnd", "invisible"}

    user: User
    conn_id: str
    seq: int
    subs: subscriptions.Subscriptions

    async def connect(self) -> None:
        user = self.scope.get("user")
        await self.accept()
        if user is None or not user.is_authenticated:
            await self.close(code=4401)
            return
        self.user = user
        self.uid = str(user.pk)
        self.conn_id = uuid.uuid4().hex
        self.expiry_task: asyncio.Task[None] | None = None
        self.seq = 0
        self.subs = {}
        self.dms: set[str] = set()
        self.frames: deque[float] = deque()
        self.last_typing: dict[str, float] = {}
        self.redis = presence.async_client()
        self.status = user.status

        await self.channel_layer.group_add(user_group(self.uid), self.channel_name)
        for server_id, channels in (await _subscriptions(user)).items():
            await self._apply_server(server_id, channels)
        for dm_id in await _dm_ids(user):
            await self._join_dm(dm_id)

        version = await presence.connect(self.redis, self.uid, self.conn_id, self.status)
        if version:
            await self._broadcast_presence(presence.visible_status(self.status), version)

        expires_at = self.scope.get("access_expires_at")
        if expires_at is not None:
            self.expiry_task = asyncio.create_task(self._close_at(expires_at))
        await self._event(
            "ready",
            {
                "user": {"id": self.uid, "username": user.username},
                "session_id": self.conn_id,
                "heartbeat_interval": self.HEARTBEAT_INTERVAL_MS,
                "server_ids": sorted(self.subs),
            },
        )

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        """Clean up however the consumer ends: a send to a socket the client already closed
        raises, and then ``disconnect()`` is never called (ghost presence until the TTL)."""
        try:
            await super().__call__(scope, receive, send)
        finally:
            await asyncio.shield(self._cleanup())

    async def disconnect(self, code: int) -> None:
        await self._cleanup()

    async def _cleanup(self) -> None:
        if not hasattr(self, "conn_id") or getattr(self, "cleaned_up", False):
            return  # rejected before authentication, or already done
        self.cleaned_up = True
        if self.expiry_task:
            self.expiry_task.cancel()
        server_ids = list(self.subs)
        for server_id in server_ids:
            await self._drop_server(server_id)
        for dm_id in list(self.dms):
            await self._leave_dm(dm_id)
        await self.channel_layer.group_discard(user_group(self.uid), self.channel_name)
        try:
            version = await presence.disconnect(self.redis, self.uid, self.conn_id)
            if version:
                await self._broadcast_presence(presence.OFFLINE, version, server_ids=server_ids)
        finally:
            await self.redis.aclose()

    # ------------------------------------------------------------------ client requests

    async def receive_json(self, content: Any, **kwargs: Any) -> None:
        now = time.monotonic()
        self.frames.append(now)
        while self.frames and self.frames[0] < now - self.FRAME_WINDOW:
            self.frames.popleft()
        if len(self.frames) > self.FRAME_LIMIT:
            await self.close(code=4429, reason=str(int(self.FRAME_WINDOW)))
            return
        if not isinstance(content, dict) or not isinstance(content.get("type"), str):
            await self.close(code=4400)
            return

        kind, data, request_id = content["type"], content.get("data") or {}, content.get("id")
        if kind == "presence.heartbeat":
            await presence.heartbeat(self.redis, self.uid, self.conn_id)
            await self._respond(kind, request_id, {})
        elif kind == "presence.set" and data.get("status") in self.STATUSES:
            await self._set_status(data["status"])
            await self._respond(kind, request_id, {"status": data["status"]})
        elif kind == "typing.start" and isinstance(data.get("channel_id"), str):
            await self._typing(data["channel_id"], request_id)
        elif kind == "typing.start" and isinstance(data.get("dm_id"), str):
            await self._typing_dm(data["dm_id"], request_id)
        else:
            await self.close(code=4400)

    async def _typing(self, channel_id: str, request_id: Any) -> None:
        perms = next((c[channel_id] for c in self.subs.values() if channel_id in c), 0)
        if not perms & Perm.SEND_MESSAGES:
            await self._error("typing.start", request_id, "forbidden")
            return
        now = time.monotonic()
        if now - self.last_typing.get(channel_id, 0) < self.TYPING_COOLDOWN:
            return  # silently drop bursts
        self.last_typing[channel_id] = now
        await self.channel_layer.group_send(
            channel_group(channel_id),
            {
                "type": "realtime.event",
                "event": "typing.started",
                "data": {
                    "channel_id": channel_id,
                    "dm_id": None,
                    "user_id": self.uid,
                    "username": self.user.username,
                    "display_name": self.user.display_name,
                    "expires_in": self.TYPING_TTL,
                },
            },
        )

    async def _typing_dm(self, dm_id: str, request_id: Any) -> None:
        if dm_id not in self.dms:
            await self._error("typing.start", request_id, "forbidden")
            return
        now = time.monotonic()
        if now - self.last_typing.get(dm_id, 0) < self.TYPING_COOLDOWN:
            return
        self.last_typing[dm_id] = now
        await self.channel_layer.group_send(
            dm_group(dm_id),
            {
                "type": "realtime.event",
                "event": "typing.started",
                "data": {
                    "channel_id": None,
                    "dm_id": dm_id,
                    "user_id": self.uid,
                    "username": self.user.username,
                    "display_name": self.user.display_name,
                    "expires_in": self.TYPING_TTL,
                },
            },
        )

    async def _set_status(self, status: str) -> None:
        previous = presence.visible_status(self.status)
        self.status = status
        self.user.status = status
        await _save_status(self.user, status)
        version = await presence.set_status(self.redis, self.uid, status)
        if presence.visible_status(status) != previous:
            await self._broadcast_presence(presence.visible_status(status), version)

    # ------------------------------------------------------------------ group messages

    async def realtime_event(self, message: dict[str, Any]) -> None:
        await self._event(message["event"], message["data"])

    async def realtime_control(self, message: dict[str, Any]) -> None:
        action = message.get("action")
        if action == "resync":
            await self._resync(message["server_id"])
        elif action == "dm_join":
            await self._join_dm(message["dm_id"])
        elif action == "dm_leave":
            await self._leave_dm(message["dm_id"])
        elif action == "close":
            await self.close(code=int(message.get("code", 4401)))

    async def _resync(self, server_id: str) -> None:
        channels = await _server_subscriptions(self.user, server_id)
        was_member = server_id in self.subs
        if channels is None:
            if was_member:
                await self._drop_server(server_id)
                await self._event("server.removed", {"server_id": server_id})
            return
        await self._apply_server(server_id, channels)
        await self._event(
            "server.joined" if not was_member else "server.access_changed",
            {"server_id": server_id},
        )

    # ------------------------------------------------------------------ helpers

    async def _apply_server(self, server_id: str, channels: dict[str, int]) -> None:
        old = self.subs.get(server_id, {})
        if server_id not in self.subs:
            await self.channel_layer.group_add(server_group(server_id), self.channel_name)
        for channel_id in old.keys() - channels.keys():
            await self.channel_layer.group_discard(channel_group(channel_id), self.channel_name)
        for channel_id in channels.keys() - old.keys():
            await self.channel_layer.group_add(channel_group(channel_id), self.channel_name)
        self.subs[server_id] = channels

    async def _join_dm(self, dm_id: str) -> None:
        if dm_id not in self.dms:
            self.dms.add(dm_id)
            await self.channel_layer.group_add(dm_group(dm_id), self.channel_name)

    async def _leave_dm(self, dm_id: str) -> None:
        if dm_id in self.dms:
            self.dms.discard(dm_id)
            await self.channel_layer.group_discard(dm_group(dm_id), self.channel_name)

    async def _drop_server(self, server_id: str) -> None:
        for channel_id in self.subs.pop(server_id, {}):
            await self.channel_layer.group_discard(channel_group(channel_id), self.channel_name)
        await self.channel_layer.group_discard(server_group(server_id), self.channel_name)

    async def _broadcast_presence(
        self, status: str, version: int, server_ids: list[str] | None = None
    ) -> None:
        for server_id in server_ids if server_ids is not None else list(self.subs):
            await self.channel_layer.group_send(
                server_group(server_id),
                {
                    "type": "realtime.event",
                    "event": "presence.updated",
                    "data": presence.event_data(self.uid, status, version, server_id),
                },
            )

    async def _close_at(self, expires_at: int) -> None:
        """The access token expired: the client refreshes over REST and reconnects (ADR-024)."""
        await asyncio.sleep(max(0.0, expires_at - time.time()))
        await self.close(code=4401)

    async def _event(self, kind: str, data: Any) -> None:
        self.seq += 1
        await self.send_json({"op": "event", "type": kind, "data": data, "seq": self.seq})

    async def _respond(self, kind: str, request_id: Any, data: Any) -> None:
        await self.send_json({"op": "response", "type": kind, "id": request_id, "data": data})

    async def _error(self, kind: str, request_id: Any, code: str) -> None:
        await self.send_json(
            {"op": "error", "type": kind, "id": request_id, "data": {"code": code}}
        )
