import pytest
from channels.testing import WebsocketCommunicator

from config.asgi import application

# Channels closes stale DB connections on every event, so DB access must be allowed.
pytestmark = pytest.mark.django_db

ORIGIN = [(b"origin", b"http://localhost")]


async def _connect(headers=ORIGIN):
    communicator = WebsocketCommunicator(application, "/ws/ping/", headers=headers)
    connected, _ = await communicator.connect()
    return communicator, connected


async def test_ping_pong():
    communicator, connected = await _connect()
    assert connected
    assert await communicator.receive_json_from() == {"op": "event", "type": "ready", "data": {}}

    await communicator.send_json_to({"op": "request", "type": "ping", "id": "1"})
    assert await communicator.receive_json_from() == {
        "op": "response",
        "type": "pong",
        "id": "1",
        "data": {},
    }
    await communicator.disconnect()


async def test_unknown_frame_closes_with_4400():
    communicator, _ = await _connect()
    await communicator.receive_json_from()
    await communicator.send_json_to({"op": "request", "type": "nope"})
    assert await communicator.receive_output() == {"type": "websocket.close", "code": 4400}


@pytest.mark.parametrize("origin", [b"https://evil.example.com", b"null"])
async def test_foreign_origin_is_rejected(origin):
    # AllowedHostsOriginValidator reads ALLOWED_HOSTS (see config.settings.test) at import time.
    _, connected = await _connect(headers=[(b"origin", origin)])
    assert not connected
