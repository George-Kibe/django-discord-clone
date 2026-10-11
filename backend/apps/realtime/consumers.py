from typing import Any

from channels.generic.websocket import AsyncJsonWebsocketConsumer


class PingConsumer(AsyncJsonWebsocketConsumer):
    """Phase 0 connectivity check: replies to {"op": "request", "type": "ping"} with a pong.

    Replaced by the authenticated multiplexed consumer in Phase 4 (docs/API.md §3).
    """

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


class GatewayConsumer(AsyncJsonWebsocketConsumer):
    """Authenticated real-time gateway (docs/API.md §3).

    Phase 1: authenticates, sends ``ready`` and answers heartbeats. Subscriptions and event
    fan-out arrive in Phase 4.
    """

    HEARTBEAT_INTERVAL_MS = 30_000

    async def connect(self) -> None:
        user = self.scope.get("user")
        await self.accept()
        if user is None or not user.is_authenticated:
            await self.close(code=4401)
            return
        await self.send_json(
            {
                "op": "event",
                "type": "ready",
                "data": {
                    "user": {"id": str(user.pk), "username": user.username},
                    "heartbeat_interval": self.HEARTBEAT_INTERVAL_MS,
                },
            }
        )

    async def receive_json(self, content: Any, **kwargs: Any) -> None:
        if isinstance(content, dict) and content.get("type") == "presence.heartbeat":
            reply = {"op": "response", "type": "presence.heartbeat", "id": content.get("id")}
            await self.send_json(reply | {"data": {}})
        else:
            await self.close(code=4400)
