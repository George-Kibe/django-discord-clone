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
