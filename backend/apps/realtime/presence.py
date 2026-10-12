"""Presence in Redis (FR-PRES-01, docs/ARCHITECTURE.md §3.3).

Each WebSocket connection owns a key with a TTL that heartbeats refresh. A user is online while
any of their connections is alive. Crashed tabs simply expire; ``sweep()`` (Celery beat) notices
users whose last connection vanished and reports them offline.

Keys: ``presence:online`` (set of user ids), ``presence:conns:{uid}`` (set of connection ids),
``presence:conn:{uid}:{cid}`` (TTL), ``presence:status:{uid}`` (chosen status).
"""

from collections.abc import Iterable
from typing import Any

import redis
import redis.asyncio as aioredis
from django.conf import settings

CONN_TTL = 70  # seconds; clients heartbeat every 30 s
ONLINE = "presence:online"
OFFLINE = "offline"
INVISIBLE = "invisible"


def _conns(uid: str) -> str:
    return f"presence:conns:{uid}"


def _conn(uid: str, cid: str) -> str:
    return f"presence:conn:{uid}:{cid}"


def _status(uid: str) -> str:
    return f"presence:status:{uid}"


def visible_status(status: str | None) -> str:
    """What other people see: invisible users look offline."""
    return OFFLINE if not status or status == INVISIBLE else status


_sync_client: redis.Redis | None = None


def sync_client() -> redis.Redis:
    global _sync_client
    if _sync_client is None:
        _sync_client = redis.Redis.from_url(settings.PRESENCE_REDIS_URL, decode_responses=True)
    return _sync_client


def async_client() -> aioredis.Redis:
    """One per consumer: asyncio clients are bound to the event loop that created them."""
    return aioredis.Redis.from_url(settings.PRESENCE_REDIS_URL, decode_responses=True)


# ---------------------------------------------------------------------------- async (consumer)


async def connect(client: aioredis.Redis, uid: str, cid: str, status: str) -> bool:
    """Register a connection. Returns True if the user just came online."""
    async with client.pipeline(transaction=True) as pipe:
        pipe.set(_conn(uid, cid), "1", ex=CONN_TTL)
        pipe.sadd(_conns(uid), cid)
        pipe.set(_status(uid), status)
        pipe.sadd(ONLINE, uid)
        results = await pipe.execute()
    return bool(results[3])


async def heartbeat(client: aioredis.Redis, uid: str, cid: str) -> None:
    await client.set(_conn(uid, cid), "1", ex=CONN_TTL)


async def set_status(client: aioredis.Redis, uid: str, status: str) -> None:
    await client.set(_status(uid), status)


async def _live_connections(client: aioredis.Redis, uid: str) -> int:
    cids = await client.smembers(_conns(uid))
    live = 0
    for cid in map(str, cids):
        if await client.exists(_conn(uid, cid)):
            live += 1
        else:
            await client.srem(_conns(uid), cid)
    return live


async def disconnect(client: aioredis.Redis, uid: str, cid: str) -> bool:
    """Drop a connection. Returns True if that was the user's last one (now offline)."""
    await client.delete(_conn(uid, cid))
    await client.srem(_conns(uid), cid)
    if await _live_connections(client, uid) == 0:
        return bool(await client.srem(ONLINE, uid))
    return False


# ---------------------------------------------------------------------------- sync (REST, Celery)


def get_presence(user_ids: Iterable[Any]) -> dict[str, str]:
    """Visible status for each user id ("offline" when not connected or invisible)."""
    ids = [str(u) for u in user_ids]
    if not ids:
        return {}
    client = sync_client()
    online = client.smismember(ONLINE, ids)
    statuses = client.mget([_status(u) for u in ids])
    return {
        uid: visible_status(str(status) if status else None) if is_online else OFFLINE
        for uid, is_online, status in zip(ids, online, statuses, strict=True)
    }


def set_status_sync(uid: Any, status: str) -> bool:
    """Store a new chosen status. Returns True if the user is currently online."""
    client = sync_client()
    client.set(_status(str(uid)), status)
    return bool(client.sismember(ONLINE, str(uid)))


def sweep() -> list[str]:
    """Users whose connections all expired without a clean disconnect (crash, network loss)."""
    client = sync_client()
    gone: list[str] = []
    for uid in map(str, client.smembers(ONLINE)):
        cids = {str(c) for c in client.smembers(_conns(uid))}
        alive = [cid for cid in cids if client.exists(_conn(uid, cid))]
        dead = cids - set(alive)
        if dead:
            client.srem(_conns(uid), *dead)
        if not alive and client.srem(ONLINE, uid):
            gone.append(uid)
    return gone


def flush_for_tests() -> None:  # pragma: no cover - test helper
    client = sync_client()
    keys: list[Any] = list(client.scan_iter("presence:*"))
    if keys:
        client.delete(*keys)
