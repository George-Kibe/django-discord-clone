"""Live delivery over the gateway (Phase 4): events, typing, presence, resync, close codes."""

from datetime import timedelta
from typing import Any

import pytest
from asgiref.sync import async_to_sync
from channels.db import database_sync_to_async
from channels.layers import get_channel_layer
from channels.testing import WebsocketCommunicator
from django.urls import reverse
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from apps.accounts.models import User
from apps.chat_channels.models import Channel
from apps.core.permissions import Perm
from apps.realtime import presence
from apps.realtime.tasks import sweep_presence
from apps.servers.models import Role
from config.asgi import application
from conftest import PASSWORD

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture(autouse=True)
def _clean_realtime_state():
    presence.flush_for_tests()
    async_to_sync(get_channel_layer().flush)()
    yield
    presence.flush_for_tests()


class Socket:
    def __init__(self, communicator: WebsocketCommunicator) -> None:
        self.c = communicator

    async def event(self, kind: str, timeout: float = 2, **match: Any) -> dict[str, Any]:
        """The next event of ``kind`` whose data contains ``match``, skipping others."""
        while True:
            frame = await self.c.receive_json_from(timeout=timeout)
            data = frame.get("data") or {}
            if frame.get("type") == kind and all(data.get(k) == v for k, v in match.items()):
                return data

    async def events(self, timeout: float = 0.4) -> list[dict[str, Any]]:
        """Everything that arrives until the socket is quiet for ``timeout``.

        (``receive_*`` timeouts would cancel the consumer; ``receive_nothing`` doesn't.)"""
        frames = []
        while not await self.c.receive_nothing(timeout=timeout):
            frames.append(await self.c.receive_json_from())
        return frames

    async def kinds(self, timeout: float = 0.4, **match: Any) -> list[str]:
        return [
            f["type"]
            for f in await self.events(timeout)
            if all((f.get("data") or {}).get(k) == v for k, v in match.items())
        ]

    async def request(self, kind: str, data: dict[str, Any] | None = None, id: str = "1") -> None:
        await self.c.send_json_to({"op": "request", "type": kind, "id": id, "data": data or {}})

    async def closed_with(self) -> int:
        while True:
            output = await self.c.receive_output(timeout=2)
            if output["type"] == "websocket.close":
                return int(output["code"])

    async def close(self) -> None:
        await self.c.disconnect(timeout=3)


async def open_socket(user: User, token: AccessToken | None = None) -> Socket:
    if token is None:
        token = await database_sync_to_async(AccessToken.for_user)(user)
    communicator = WebsocketCommunicator(
        application,
        "/ws/",
        headers=[(b"origin", b"http://localhost"), (b"cookie", f"access={token}".encode())],
    )
    connected, _ = await communicator.connect()
    assert connected
    socket = Socket(communicator)
    await socket.event("ready")
    return socket


def rest(user: User, method: str, url: str, data: Any = None) -> Any:
    client = APIClient()
    client.force_authenticate(user)
    response = getattr(client, method)(url, data, format="json")
    assert response.status_code < 300, response.content
    return response.json() if response.content else None


arest = database_sync_to_async(rest)


def general(server) -> Channel:
    return Channel.objects.get(server=server, name="general")


@pytest.fixture
def setup(user, make_user, server, join):
    """``user`` owns ``server``; ``member`` joined it; ``outsider`` didn't."""
    member = make_user()
    join(server, member)
    return {
        "owner": user,
        "member": member,
        "outsider": make_user(),
        "server": server,
        "channel": general(server),
    }


# ---------------------------------------------------------------------------- messages


async def test_ready_lists_servers(setup):
    socket = await open_socket(setup["member"])
    await socket.close()
    communicator = WebsocketCommunicator(
        application,
        "/ws/",
        headers=[
            (b"origin", b"http://localhost"),
            (b"cookie", f"access={AccessToken.for_user(setup['owner'])}".encode()),
        ],
    )
    await communicator.connect()
    ready = await communicator.receive_json_from()
    assert ready["type"] == "ready" and ready["seq"] == 1
    assert ready["data"]["server_ids"] == [str(setup["server"].pk)]
    await communicator.disconnect()


async def test_message_lifecycle_reaches_members_only(setup):
    member = await open_socket(setup["member"])
    outsider = await open_socket(setup["outsider"])
    url = reverse("channel-messages", args=[setup["channel"].pk])

    sent = await arest(setup["owner"], "post", url, {"content": "hello", "nonce": "n1"})
    created = await member.event("message.created")
    assert created["id"] == sent["id"] and created["nonce"] == "n1"
    assert created["channel_id"] == str(setup["channel"].pk)
    assert created["server_id"] == str(setup["server"].pk)

    await arest(setup["owner"], "patch", reverse("message", args=[sent["id"]]), {"content": "hi"})
    assert (await member.event("message.updated"))["content"] == "hi"

    await arest(setup["owner"], "delete", reverse("message", args=[sent["id"]]))
    assert (await member.event("message.deleted"))["id"] == sent["id"]

    assert await outsider.kinds() == []
    await member.close()
    await outsider.close()


async def test_private_channel_events_skip_members_without_view(setup):
    channel = setup["channel"]
    everyone = await database_sync_to_async(Role.objects.get)(
        server=setup["server"], is_default=True
    )
    member = await open_socket(setup["member"])
    await arest(
        setup["owner"],
        "put",
        reverse("channel-overwrites", args=[channel.pk]),
        {"role_id": str(everyone.pk), "allow": 0, "deny": int(Perm.VIEW_CHANNEL)},
    )
    # Structural change: viewers refetch, and the consumer drops the channel's group.
    assert (await member.event("channel.updated"))["id"] == str(channel.pk)
    assert (await member.event("server.access_changed"))["server_id"] == str(setup["server"].pk)

    url = reverse("channel-messages", args=[channel.pk])
    await arest(setup["owner"], "post", url, {"content": "secret"})
    assert "message.created" not in await member.kinds()
    await member.close()


# ---------------------------------------------------------------------------- membership


async def test_join_and_leave_update_subscriptions(setup, make_user):
    newcomer = await database_sync_to_async(make_user)()
    socket = await open_socket(newcomer)
    server_id = str(setup["server"].pk)
    await database_sync_to_async(setup["server"].__class__.objects.filter(pk=server_id).update)(
        is_public=True
    )

    await arest(newcomer, "post", reverse("server-join", args=[server_id]))
    assert (await socket.event("server.joined"))["server_id"] == server_id
    await arest(
        setup["owner"],
        "post",
        reverse("channel-messages", args=[setup["channel"].pk]),
        {"content": "welcome"},
    )
    assert (await socket.event("message.created"))["content"] == "welcome"

    await arest(newcomer, "post", reverse("server-leave", args=[server_id]))
    assert (await socket.event("server.removed"))["server_id"] == server_id
    await arest(
        setup["owner"],
        "post",
        reverse("channel-messages", args=[setup["channel"].pk]),
        {"content": "gone"},
    )
    assert "message.created" not in await socket.kinds()
    await socket.close()


async def test_creating_a_server_subscribes_the_owners_sockets(user):
    socket = await open_socket(user)
    from apps.servers.services import create_server

    server = await database_sync_to_async(create_server)(owner=user, name="Fresh")
    assert (await socket.event("server.joined"))["server_id"] == str(server.pk)
    channel = await database_sync_to_async(general)(server)
    await arest(user, "post", reverse("channel-messages", args=[channel.pk]), {"content": "hi"})
    assert (await socket.event("message.created"))["content"] == "hi"
    await socket.request("typing.start", {"channel_id": str(channel.pk)})
    assert "error" not in [f["op"] for f in await socket.events()]
    await socket.close()


async def test_member_sees_others_join_and_leave(setup, make_user, join):
    socket = await open_socket(setup["member"])
    newcomer = await database_sync_to_async(make_user)()
    await database_sync_to_async(join)(setup["server"], newcomer)
    joined = await socket.event("member.joined")
    assert joined == {"server_id": str(setup["server"].pk), "user_id": str(newcomer.pk)}
    await socket.close()


async def test_server_delete_removes_it_everywhere(setup):
    socket = await open_socket(setup["member"])
    server_id = str(setup["server"].pk)
    await arest(setup["owner"], "delete", reverse("server-detail", args=[server_id]))
    assert (await socket.event("server.deleted"))["server_id"] == server_id
    assert (await socket.event("server.removed"))["server_id"] == server_id
    await socket.close()


# ---------------------------------------------------------------------------- typing


async def test_typing_is_broadcast_with_cooldown(setup):
    owner = await open_socket(setup["owner"])
    member = await open_socket(setup["member"])
    channel_id = str(setup["channel"].pk)

    await member.request("typing.start", {"channel_id": channel_id})
    typing = await owner.event("typing.started")
    assert typing == {
        "channel_id": channel_id,
        "dm_id": None,
        "user_id": str(setup["member"].pk),
        "username": setup["member"].username,
        "display_name": setup["member"].display_name,
        "expires_in": 8,
    }
    await member.request("typing.start", {"channel_id": channel_id})  # within the cooldown
    assert "typing.started" not in await owner.kinds()
    await owner.close()
    await member.close()


async def test_typing_requires_send_messages(setup):
    everyone = await database_sync_to_async(Role.objects.get)(
        server=setup["server"], is_default=True
    )
    await arest(
        setup["owner"],
        "patch",
        reverse("server-role", args=[setup["server"].pk, everyone.pk]),
        {"permissions": int(everyone.permissions) & ~int(Perm.SEND_MESSAGES)},
    )
    member = await open_socket(setup["member"])
    await member.events()  # own presence echo
    await member.request("typing.start", {"channel_id": str(setup["channel"].pk)}, id="t1")
    frame = await member.c.receive_json_from(timeout=2)
    assert frame == {
        "op": "error",
        "type": "typing.start",
        "id": "t1",
        "data": {"code": "forbidden"},
    }
    # A channel the user can't see at all is rejected the same way.
    await member.request("typing.start", {"channel_id": "not-a-channel"}, id="t2")
    assert (await member.c.receive_json_from(timeout=2))["data"] == {"code": "forbidden"}
    await member.close()


# ---------------------------------------------------------------------------- presence


async def members_presence(viewer: User, server) -> dict[str, str]:
    page = await arest(viewer, "get", reverse("server-members", args=[server.pk]))
    return {m["user"]["id"]: m["presence"] for m in page["results"]}


async def test_presence_online_status_and_offline(setup):
    owner = await open_socket(setup["owner"])
    member_id = str(setup["member"].pk)
    assert (await members_presence(setup["owner"], setup["server"]))[member_id] == "offline"

    member = await open_socket(setup["member"])
    online = await owner.event("presence.updated", user_id=member_id)
    assert online == {
        "user_id": member_id,
        "status": "online",
        "version": online["version"],
        "server_id": str(setup["server"].pk),
    }
    versions = [online["version"]]
    assert (await members_presence(setup["owner"], setup["server"]))[member_id] == "online"

    await member.request("presence.set", {"status": "dnd"})
    dnd = await owner.event("presence.updated", user_id=member_id)
    assert dnd["status"] == "dnd"
    versions.append(dnd["version"])
    await member.request("presence.set", {"status": "invisible"})
    assert (await owner.event("presence.updated", user_id=member_id))["status"] == "offline"
    assert (await members_presence(setup["owner"], setup["server"]))[member_id] == "offline"
    await database_sync_to_async(setup["member"].refresh_from_db)()
    assert setup["member"].status == "invisible"  # remembered for the next session

    await member.request("presence.set", {"status": "online"})
    assert (await owner.event("presence.updated", user_id=member_id))["status"] == "online"
    await member.close()
    offline = await owner.event("presence.updated", user_id=member_id)
    assert offline["status"] == "offline"
    versions.append(offline["version"])
    assert versions == sorted(versions) and len(set(versions)) == 3  # strictly increasing
    await owner.close()


async def test_second_tab_keeps_user_online(setup):
    member_id = str(setup["member"].pk)
    owner = await open_socket(setup["owner"])
    first = await open_socket(setup["member"])
    await owner.event("presence.updated", user_id=member_id)
    second = await open_socket(setup["member"])
    await first.close()
    assert "presence.updated" not in await owner.kinds(user_id=member_id)
    await second.close()
    assert (await owner.event("presence.updated", user_id=member_id))["status"] == "offline"
    await owner.close()


async def test_rest_status_change_broadcasts_presence(setup):
    member_id = str(setup["member"].pk)
    owner = await open_socket(setup["owner"])
    member = await open_socket(setup["member"])
    await owner.event("presence.updated", user_id=member_id)
    await arest(setup["member"], "patch", reverse("users-me"), {"status": "idle"})
    assert (await owner.event("user.updated"))["user_id"] == member_id
    assert (await owner.event("presence.updated", user_id=member_id))["status"] == "idle"
    await owner.close()
    await member.close()


def test_sweep_reports_crashed_connections(setup):
    client = presence.sync_client()
    uid = str(setup["member"].pk)
    client.sadd(presence.ONLINE, uid)
    client.sadd(f"presence:conns:{uid}", "dead-connection")  # its TTL key already expired
    assert sweep_presence() == 1
    assert presence.get_presence([uid]) == {uid: "offline"}
    assert sweep_presence() == 0


async def test_reload_race_never_leaves_a_connected_user_offline(setup):
    """Old tab's cleanup and the reloaded tab's connect interleave; the atomic prune keeps the
    user online, or the versions let clients discard the stale "offline"."""
    uid = str(setup["member"].pk)
    client = presence.async_client()
    try:
        assert await presence.connect(client, uid, "old", "online")
        # The new tab registers before the old tab's cleanup runs.
        assert await presence.connect(client, uid, "new", "online") == 0
        assert await presence.disconnect(client, uid, "old") == 0
        assert presence.get_presence([uid]) == {uid: "online"}
        # Cleanup first, then the new tab: offline, then online with a higher version.
        went_offline = await presence.disconnect(client, uid, "new")
        came_online = await presence.connect(client, uid, "newer", "online")
        assert 0 < went_offline < came_online
        assert presence.get_presence([uid]) == {uid: "online"}
    finally:
        await client.aclose()


# ---------------------------------------------------------------------------- protocol & auth


async def test_flooding_closes_with_4429(setup):
    socket = await open_socket(setup["member"])
    for _ in range(61):
        await socket.request("presence.heartbeat")
    assert await socket.closed_with() == 4429


@pytest.mark.parametrize(
    "frame",
    [
        [1, 2],
        {"op": "request"},
        {"type": "presence.set", "data": {"status": "busy"}},
        {"type": "typing.start", "data": {}},
    ],
)
async def test_malformed_frames_close_with_4400(setup, frame):
    socket = await open_socket(setup["member"])
    await socket.c.send_json_to(frame)
    assert await socket.closed_with() == 4400


async def test_socket_closes_when_access_token_expires(setup):
    token = await database_sync_to_async(AccessToken.for_user)(setup["member"])
    token.set_exp(lifetime=timedelta(seconds=1))
    socket = await open_socket(setup["member"], token)
    assert await socket.closed_with() == 4401


async def test_password_change_closes_sockets(setup):
    socket = await open_socket(setup["member"])
    await arest(
        setup["member"],
        "post",
        reverse("auth-password-change"),
        {"current_password": PASSWORD, "new_password": "another-long-passphrase"},
    )
    assert await socket.closed_with() == 4401


async def test_ack_syncs_the_users_other_tabs(setup):
    socket = await open_socket(setup["member"])
    channel = setup["channel"]
    sent = await arest(
        setup["owner"], "post", reverse("channel-messages", args=[channel.pk]), {"content": "x"}
    )
    await arest(
        setup["member"],
        "post",
        reverse("channel-ack", args=[channel.pk]),
        {"message_id": sent["id"]},
    )
    state = await socket.event("read_state.updated")
    assert state == {
        "channel_id": str(channel.pk),
        "dm_id": None,
        "server_id": str(setup["server"].pk),
        "last_read_message_id": sent["id"],
        "mention_count": 0,
    }
    await socket.close()


async def test_logout_closes_sockets(setup):
    socket = await open_socket(setup["member"])
    token = await database_sync_to_async(AccessToken.for_user)(setup["member"])
    client = APIClient(enforce_csrf_checks=False)
    client.cookies["access"] = str(token)
    response = await database_sync_to_async(client.post)(reverse("auth-logout"))
    assert response.status_code == 204
    assert await socket.closed_with() == 4401


async def test_cleanup_runs_even_if_the_client_vanishes_mid_connect(setup):
    """A tab closed right after the handshake: sending ``ready`` fails, but presence and groups
    are still cleaned up (no ghost "online")."""
    uid = str(setup["member"].pk)
    token = await database_sync_to_async(AccessToken.for_user)(setup["member"])
    communicator = WebsocketCommunicator(
        application,
        "/ws/",
        headers=[(b"origin", b"http://localhost"), (b"cookie", f"access={token}".encode())],
    )
    original = communicator.output_queue.put

    async def vanish(message):  # the client is gone by the time we send "ready"
        if message.get("type") == "websocket.send":
            raise OSError("client disconnected")
        await original(message)

    communicator.output_queue.put = vanish
    await communicator.connect()
    with pytest.raises(OSError):
        await communicator.wait(timeout=2)
    assert presence.get_presence([uid]) == {uid: "offline"}


# ---------------------------------------------------------------------------- Phase 5


async def test_dm_messages_typing_and_new_conversations_are_live(setup):
    owner = await open_socket(setup["owner"])
    member = await open_socket(setup["member"])
    conversation = await arest(
        setup["owner"], "post", reverse("dms"), {"user_ids": [str(setup["member"].pk)]}
    )
    dm_id = conversation["id"]
    assert (await member.event("dm.created"))["dm_id"] == dm_id  # and its socket joined the group

    await member.request("typing.start", {"dm_id": dm_id})
    typing = await owner.event("typing.started")
    assert typing["dm_id"] == dm_id and typing["channel_id"] is None

    await arest(setup["owner"], "post", reverse("dm-messages", args=[dm_id]), {"content": "psst"})
    created = await member.event("message.created")
    assert created["dm_id"] == dm_id and created["content"] == "psst"
    unread = await member.event("read_state.updated", dm_id=dm_id)
    assert unread["mention_count"] == 1
    notification = await member.event("notification.created")
    assert notification["type"] == "dm" and notification["data"]["count"] == 1

    outsider = await open_socket(setup["outsider"])
    await outsider.request("typing.start", {"dm_id": dm_id}, id="x")
    assert (await outsider.c.receive_json_from(timeout=2))["data"] == {"code": "forbidden"}
    for socket in (owner, member, outsider):
        await socket.close()


async def test_reactions_pins_and_mentions_are_live(setup):
    member = await open_socket(setup["member"])
    channel = setup["channel"]
    message = await arest(
        setup["owner"],
        "post",
        reverse("channel-messages", args=[channel.pk]),
        {"content": f"<@{setup['member'].pk}> look"},
    )
    counted = await member.event("read_state.updated", channel_id=str(channel.pk))
    assert counted["mention_count"] == 1
    mention = await member.event("notification.created")
    assert mention["type"] == "mention" and mention["message_id"] == message["id"]

    await arest(setup["owner"], "put", reverse("message-reaction", args=[message["id"], "🔥"]))
    added = await member.event("reaction.added")
    assert added == {
        "message_id": message["id"],
        "emoji": "🔥",
        "user_id": str(setup["owner"].pk),
        "count": 1,
        "channel_id": str(channel.pk),
        "dm_id": None,
        "server_id": str(setup["server"].pk),
    }
    await arest(setup["owner"], "put", reverse("message-pin", args=[message["id"]]))
    assert (await member.event("message.updated"))["pinned_at"]
    assert (await member.event("pins.updated"))["channel_id"] == str(channel.pk)
    await member.close()
