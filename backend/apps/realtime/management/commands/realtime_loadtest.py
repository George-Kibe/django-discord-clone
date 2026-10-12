"""Fan-out load test (Phase 4 exit criterion: p95 < 500 ms with 100 connections).

Creates throwaway users in one server, opens a gateway connection per user, posts messages
through the normal service layer and measures how long each delivery takes. Everything it
creates is deleted afterwards. Development only: it writes to the configured database.

    docker compose exec api python manage.py realtime_loadtest --connections 100 --messages 20
"""

import asyncio
import contextlib
import json
import statistics
import time
import uuid
from typing import Any

import websockets
from asgiref.sync import sync_to_async
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError, CommandParser
from rest_framework_simplejwt.tokens import AccessToken

from apps.accounts.models import User
from apps.chat_channels.models import Channel
from apps.messaging.services import send_message
from apps.messaging.targets import channel_target
from apps.servers.models import Server
from apps.servers.services import add_member, create_server


class Command(BaseCommand):
    help = "Measure WebSocket fan-out latency with many connections (development only)."

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("--connections", type=int, default=100)
        parser.add_argument("--messages", type=int, default=20)
        parser.add_argument("--interval", type=float, default=0.25, help="Seconds between sends.")
        parser.add_argument("--url", default="ws://localhost:8000/ws/")
        parser.add_argument("--origin", default="http://localhost")
        parser.add_argument("--p95-budget-ms", type=float, default=500.0)

    def handle(self, *args: Any, **options: Any) -> None:
        if not settings.DEBUG:
            raise CommandError("Refusing to run with DEBUG off (it writes to the database).")
        tag = f"loadtest-{uuid.uuid4().hex[:8]}"
        users, server, channel = self._setup(tag, options["connections"])
        try:
            latencies = asyncio.run(self._run(users, channel, options))
        finally:
            Server.objects.filter(pk=server.pk).delete()
            User.objects.filter(username__startswith=tag).delete()

        expected = options["connections"] * options["messages"]
        if not latencies:
            raise CommandError("No messages were delivered.")
        ordered = sorted(latencies)
        p50 = statistics.median(ordered)
        p95 = ordered[max(0, int(len(ordered) * 0.95) - 1)]
        self.stdout.write(
            f"connections={options['connections']} messages={options['messages']} "
            f"deliveries={len(latencies)}/{expected} "
            f"p50={p50:.1f}ms p95={p95:.1f}ms max={ordered[-1]:.1f}ms"
        )
        if len(latencies) < expected:
            raise CommandError(f"Lost {expected - len(latencies)} deliveries.")
        if p95 > options["p95_budget_ms"]:
            raise CommandError(
                f"p95 {p95:.1f} ms is over the {options['p95_budget_ms']} ms budget."
            )
        self.stdout.write(self.style.SUCCESS("Fan-out within budget."))

    def _setup(self, tag: str, count: int) -> tuple[list[User], Server, Channel]:
        verified = {"email_verified_at": "2026-01-01T00:00:00Z"}
        users = [
            User.objects.create_user(
                email=f"{tag}-{i}@example.com", username=f"{tag}-{i}", password=None, **verified
            )
            for i in range(count)
        ]
        server = create_server(owner=users[0], name=tag)
        for user in users[1:]:
            add_member(server, user)
        return users, server, Channel.objects.get(server=server, name="general")

    async def _run(
        self, users: list[User], channel: Channel, options: dict[str, Any]
    ) -> list[float]:
        sent_at: dict[str, float] = {}
        latencies: list[float] = []
        remaining = {"n": len(users) * options["messages"]}
        done = asyncio.Event()

        async def listen(socket: Any) -> None:
            async for raw in socket:
                received = time.perf_counter()
                data = json.loads(raw)
                if data.get("type") != "message.created":
                    continue
                started = sent_at.get(data["data"]["nonce"])
                if started is None:
                    continue
                latencies.append((received - started) * 1000)
                remaining["n"] -= 1
                if remaining["n"] == 0:
                    done.set()

        sockets = []
        for user in users:
            token = await sync_to_async(lambda u=user: str(AccessToken.for_user(u)))()
            socket = await websockets.connect(
                options["url"],
                additional_headers={"Cookie": f"access={token}", "Origin": options["origin"]},
                max_queue=None,
            )
            await socket.recv()  # ready
            sockets.append(socket)
        listeners = [asyncio.create_task(listen(s)) for s in sockets]
        self.stdout.write(f"{len(sockets)} connections open; sending {options['messages']}…")

        author = users[0]
        target = await sync_to_async(channel_target)(author, channel)
        for i in range(options["messages"]):
            nonce = f"lt-{i}"
            sent_at[nonce] = time.perf_counter()
            await sync_to_async(send_message)(
                target, author=author, content=f"load {i}", nonce=nonce
            )
            await asyncio.sleep(options["interval"])
        with contextlib.suppress(TimeoutError):  # lost deliveries are reported by the caller
            await asyncio.wait_for(done.wait(), timeout=15)
        for task in listeners:
            task.cancel()
        await asyncio.gather(*(s.close() for s in sockets), return_exceptions=True)
        return latencies
