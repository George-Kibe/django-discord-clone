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


def event_data(uid: Any, status: str, version: int, server_id: Any) -> dict[str, Any]:
    """Payload of a presence.updated event."""
    return {
        "user_id": str(uid),
        "status": status,
        "version": version,
        "server_id": str(server_id),
    }


_sync_client: redis.Redis | None = None


def sync_client() -> redis.Redis:
    global _sync_client
    if _sync_client is None:
        _sync_client = redis.Redis.from_url(settings.PRESENCE_REDIS_URL, decode_responses=True)
    return _sync_client


def async_client() -> aioredis.Redis:
    """One per consumer: asyncio clients are bound to the event loop that created them."""
    return aioredis.Redis.from_url(settings.PRESENCE_REDIS_URL, decode_responses=True)


# Every online/offline/status transition bumps a per-user version that travels with the
# presence.updated event, so clients can drop events that arrive out of order (e.g. an old tab's
# "offline" overtaking a reloaded tab's "online").

_PRUNE = """
local uid, cid = ARGV[1], ARGV[2]
local conns = 'presence:conns:' .. uid
if cid ~= '' then
  redis.call('DEL', 'presence:conn:' .. uid .. ':' .. cid)
  redis.call('SREM', conns, cid)
end
local live = 0
for _, c in ipairs(redis.call('SMEMBERS', conns)) do
  if redis.call('EXISTS', 'presence:conn:' .. uid .. ':' .. c) == 1 then
    live = live + 1
  else
    redis.call('SREM', conns, c)
  end
end
if live == 0 and redis.call('SREM', 'presence:online', uid) == 1 then
  return redis.call('INCR', 'presence:version:' .. uid)
end
return 0
"""
"""Atomically drop a connection (if given) and expired ones. Returns the new version if the user
just went offline, else 0. Atomic so a concurrent connect can't be marked offline."""


def _version(uid: str) -> str:
    return f"presence:version:{uid}"


# ---------------------------------------------------------------------------- async (consumer)


async def connect(client: aioredis.Redis, uid: str, cid: str, status: str) -> int:
    """Register a connection. Returns the new version if the user just came online, else 0."""
    async with client.pipeline(transaction=True) as pipe:
        pipe.set(_conn(uid, cid), "1", ex=CONN_TTL)
        pipe.sadd(_conns(uid), cid)
        pipe.set(_status(uid), status)
        pipe.sadd(ONLINE, uid)
        pipe.incr(_version(uid))
        results = await pipe.execute()
    return int(results[4]) if results[3] else 0


async def heartbeat(client: aioredis.Redis, uid: str, cid: str) -> None:
    await client.set(_conn(uid, cid), "1", ex=CONN_TTL)


async def set_status(client: aioredis.Redis, uid: str, status: str) -> int:
    """Store a new chosen status. Returns the new version."""
    async with client.pipeline(transaction=True) as pipe:
        pipe.set(_status(uid), status)
        pipe.incr(_version(uid))
        results = await pipe.execute()
    return int(results[1])


async def disconnect(client: aioredis.Redis, uid: str, cid: str) -> int:
    """Drop a connection. Returns the new version if that was the user's last one, else 0."""
    return int(await client.eval(_PRUNE, 0, uid, cid))


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


def set_status_sync(uid: Any, status: str) -> int:
    """Store a new chosen status. Returns the new version if the user is online, else 0."""
    client = sync_client()
    with client.pipeline(transaction=True) as pipe:
        pipe.set(_status(str(uid)), status)
        pipe.sismember(ONLINE, str(uid))
        pipe.incr(_version(str(uid)))
        results = pipe.execute()
    return int(results[2]) if results[1] else 0


def sweep() -> list[tuple[str, int]]:
    """Users whose connections all expired without a clean disconnect (crash, network loss),
    with their new presence version."""
    client = sync_client()
    gone: list[tuple[str, int]] = []
    for uid in map(str, client.smembers(ONLINE)):
        version = int(client.eval(_PRUNE, 0, uid, ""))
        if version:
            gone.append((uid, version))
    return gone


def flush_for_tests() -> None:  # pragma: no cover - test helper
    client = sync_client()
    keys: list[Any] = list(client.scan_iter("presence:*"))
    if keys:
        client.delete(*keys)
