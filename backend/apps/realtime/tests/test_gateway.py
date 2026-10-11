"""Authenticated WebSocket gateway: cookie auth (Phase 1)."""

import pytest
from channels.db import database_sync_to_async
from channels.testing import WebsocketCommunicator

from apps.accounts.tests.factories import UserFactory
from apps.accounts.tokens import issue_tokens
from config.asgi import application

pytestmark = pytest.mark.django_db(transaction=True)


def headers(cookie: str | None = None):
    result = [(b"origin", b"http://localhost")]
    if cookie is not None:
        result.append((b"cookie", cookie.encode()))
    return result


async def connect(cookie=None):
    communicator = WebsocketCommunicator(application, "/ws/", headers=headers(cookie))
    connected, _ = await communicator.connect()
    assert connected  # accepted, then closed with an app-level code if unauthenticated
    return communicator


@database_sync_to_async
def make_user_and_token():
    user = UserFactory.create()
    return user, str(issue_tokens(user).access_token)


async def test_authenticated_connection_receives_ready():
    user, access = await make_user_and_token()
    communicator = await connect(f"access={access}; other=1")
    ready = await communicator.receive_json_from()
    assert ready["type"] == "ready"
    assert ready["data"]["user"] == {"id": str(user.id), "username": user.username}
    assert ready["data"]["heartbeat_interval"] == 30_000

    await communicator.send_json_to({"op": "request", "type": "presence.heartbeat", "id": "7"})
    assert await communicator.receive_json_from() == {
        "op": "response",
        "type": "presence.heartbeat",
        "id": "7",
        "data": {},
    }
    await communicator.disconnect()


@pytest.mark.parametrize("cookie", [None, "", "access=garbage", "refresh=something"])
async def test_unauthenticated_connections_close_with_4401(cookie):
    communicator = await connect(cookie)
    assert await communicator.receive_output() == {"type": "websocket.close", "code": 4401}


async def test_unknown_frame_closes_with_4400():
    _, access = await make_user_and_token()
    communicator = await connect(f"access={access}")
    await communicator.receive_json_from()
    await communicator.send_json_to({"type": "nope"})
    assert await communicator.receive_output() == {"type": "websocket.close", "code": 4400}
