# Architecture

This document describes **how** the system is built. Requirements are in [REQUIREMENTS.md](REQUIREMENTS.md). The reasons behind each choice are in [DECISIONS.md](DECISIONS.md), referenced as `ADR-NNN`.

---

## 1. System overview

```
                         ┌───────────────────────────── VPS (Docker Compose) ─────────────────────────────┐
                         │                                                                                 │
 Browser ──HTTPS/WSS──▶  │  ┌────────┐   /            ┌──────────────┐                                     │
                         │  │ Caddy  │──────────────▶ │  web         │  Next.js (Node 24, standalone)      │
                         │  │ :443   │                │  :3000       │──┐ server-side fetch (internal)     │
                         │  │        │   /api /admin  ├──────────────┤  │                                  │
                         │  │        │   /ws /static  │  api         │◀─┘                                  │
                         │  │        │──────────────▶ │  :8000       │  Django 6.1 ASGI (Uvicorn)          │
                         │  └────────┘                │  DRF + Channels                                    │
                         │                            └──┬───────┬───┘                                     │
                         │                               │       │ channel layer / cache                   │
                         │                     SQL       │       ▼                                         │
                         │                ┌──────────────▼┐   ┌────────┐     ┌──────────┐  ┌──────────┐   │
                         │                │ db            │   │ redis  │◀────│ worker   │  │ beat     │   │
                         │                │ PostgreSQL 18 │◀──│ 8.x    │     │ Celery   │  │ Celery   │   │
                         │                └───────┬───────┘   └────────┘     └────┬─────┘  └──────────┘   │
                         │                        │ nightly pg_dump               │                        │
                         │                ┌───────▼───────┐                       │                        │
                         │                │ backup        │                       │                        │
                         │                └───────┬───────┘                       │                        │
                         └────────────────────────┼───────────────────────────────┼────────────────────────┘
                                                  ▼                               ▼
                                     Off-site object storage          Cloudinary · SMTP · Sentry
                                                                            ▲
 Browser ───────────── signed direct upload (images/files) ─────────────────┘
```

**Key properties**

- **Single origin.** Caddy serves the frontend and the backend under one domain (`/` → Next.js, `/api`, `/ws`, `/admin`, `/static` → Django). Cookies are first-party, so CORS is unnecessary and CSRF is simple (ADR-005).
- **REST for writes, WebSocket for push.** Clients create, edit and delete data over REST. The server broadcasts the resulting events over WebSockets. The database is the single source of truth (ADR-007).
- **One ASGI process** serves HTTP and WebSocket traffic for Django (ADR-016).
- **Stateless app containers.** All state lives in PostgreSQL, Redis (ephemeral) or Cloudinary, so containers can be replaced freely.

## 2. Components

### 2.1 Caddy (edge proxy)

- Terminates TLS with automatic Let's Encrypt certificates and redirects HTTP → HTTPS.
- Routes by path prefix and upgrades `/ws/*` to WebSocket.
- Sets security headers (HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`). The CSP is set by Next.js because it needs per-request nonces.
- Compresses responses (zstd/gzip) and writes access logs as JSON.
- In development it runs on `http://localhost` without TLS.

### 2.2 `web`: Next.js frontend

- **Next.js 16.4 App Router**, React 19, TypeScript in strict mode, Tailwind CSS 4.
- Built with `output: "standalone"` and run with Node 24 LTS in a slim non-root image.
- **Rendering strategy**
  - Marketing/landing, login, register and public discovery pages: Server Components, server-rendered.
  - The app shell (`/channels/...`): a server-rendered layout (it checks the session and preloads the server list) that hosts client components for the interactive chat UI.
  - Server-side data fetching calls the API over the internal Docker network (`http://api:8000`) and forwards the user's cookies.
- **Client state**
  - *Server state:* TanStack Query caches REST data. WebSocket events patch the query cache directly, so no refetch is needed.
  - *Real-time:* one `RealtimeClient` singleton manages the WebSocket connection, subscriptions, heartbeats, reconnects with exponential backoff and jitter, and backfill after reconnect.
  - *UI state:* React state/context. A small store (Zustand) is added only if it becomes necessary.
- **Forms:** React Hook Form + Zod. Zod schemas mirror the API validation.
- **UI kit:** shadcn/ui components (Radix primitives) styled with Tailwind, plus `lucide-react` icons.
- **API types:** generated from the backend OpenAPI schema with `openapi-typescript`. A thin typed `fetch` wrapper attaches the CSRF header and handles `401` responses with one silent refresh and a retry (ADR-017).
- **Middleware/proxy:** a lightweight check redirects unauthenticated users away from `/channels/*`. Real authorization always happens in the API.

Frontend source layout:

```
frontend/src/
├── app/                    # Routes (App Router)
│   ├── (marketing)/        # Landing page
│   ├── (auth)/             # login, register, verify-email, reset-password
│   ├── discover/           # Public server discovery
│   └── channels/
│       ├── @me/[dmId]/     # Direct messages
│       └── [serverId]/[channelId]/
├── components/             # Shared UI (ui/ = shadcn primitives)
├── features/               # Feature modules: auth, servers, channels, messages, dms, polls, presence…
│   └── <feature>/{api.ts, hooks.ts, components/, schemas.ts}
├── lib/                    # api client, realtime client, utils
└── types/                  # Generated OpenAPI types (api.d.ts)
```

### 2.3 `api`: Django backend

- **Python 3.14**, **Django 6.1.2** (→ 6.2 LTS, ADR-002), Django REST Framework, Django Channels.
- Served by **Uvicorn** as an ASGI app. The `ProtocolTypeRouter` sends `http` to Django and `websocket` to the Channels consumers.
- Main libraries:

| Concern | Library |
|---|---|
| REST API | `djangorestframework`, `django-filter` |
| Auth | `djangorestframework-simplejwt` (with token blacklist), custom cookie authentication class |
| OpenAPI | `drf-spectacular` |
| WebSockets | `channels`, `channels-redis` |
| Background jobs | `celery`, `django-celery-beat` (DB-backed schedules) |
| Config | `django-environ` |
| Media | `cloudinary` (Python SDK) |
| PDFs | `reportlab` (pure Python, no system dependencies) |
| Passwords | `argon2-cffi` |
| Static files | `whitenoise` (admin/DRF static files only) |
| Observability | `sentry-sdk`, `structlog` / JSON logging, `django-health-check` |
| Dev/test | `pytest`, `pytest-django`, `pytest-asyncio`, `factory-boy`, `ruff`, `mypy` + `django-stubs`, `django-debug-toolbar` |

Backend source layout (domain-oriented apps):

```
backend/
├── config/                 # Project package
│   ├── settings/{base,dev,test,prod}.py
│   ├── asgi.py             # ProtocolTypeRouter (http + websocket)
│   ├── urls.py             # /api/v1/..., /admin/, /api/schema/, /api/docs/
│   ├── routing.py          # WebSocket URL routes
│   └── celery.py
├── apps/
│   ├── core/               # Base models (UUIDv7 PK, timestamps), permissions helpers, pagination, health
│   ├── accounts/           # User, auth views, email verification, password reset, audit log
│   ├── servers/            # Server, Member, Role, Invite, Ban, Topic, discovery
│   ├── channels/           # Category, Channel, PermissionOverwrite, ReadState   (app label: "chat_channels")
│   ├── messaging/          # Message, Attachment, Reaction, Mention, DM conversations, search
│   ├── polls/              # Poll, PollOption, PollVote
│   ├── notifications/      # Notification inbox, mute settings
│   ├── exports/            # Transcript export jobs (PDF)
│   ├── media/              # Cloudinary signing endpoint, upload validation, orphan cleanup
│   └── realtime/           # Consumer, auth middleware, event publishing, presence
├── tests/                  # Cross-app / integration tests (unit tests live in each app)
├── manage.py
├── pyproject.toml
└── uv.lock
```

> The `channels` app is given the label `chat_channels` so it doesn't clash with the `channels` (Django Channels) package.

**Layering inside each app**

```
views/viewsets (HTTP)  ─┐
consumers (WS)         ─┼─▶ services.py (business logic, transactions, permission checks, event publishing)
tasks.py (Celery)      ─┘         │
                                  ▼
                             models.py / selectors.py (query construction)
```

- `services.py` holds every state change. Views, consumers and tasks stay thin.
- `selectors.py` holds read queries with the needed `select_related`/`prefetch_related` (NFR-PERF-04).
- Real-time events are published from services through `transaction.on_commit`, so a rolled-back write never broadcasts.

### 2.4 `worker` and `beat`: Celery

- The broker and result backend are Redis (separate logical DBs, see §6).
- Queues: `default` (emails, notifications), `heavy` (PDF exports, link previews) with a concurrency limit, and `beat`-scheduled maintenance tasks.
- All tasks are idempotent, with `acks_late=True`, autoretry with exponential backoff, and time limits.
- Scheduled tasks (django-celery-beat):

| Task | Schedule |
|---|---|
| Close polls past their close time | every minute |
| Delete expired exports | hourly |
| Purge expired invites and blacklisted tokens | daily |
| Delete unverified accounts older than 7 days | daily |
| Prune auth audit log entries older than 90 days | daily |
| Remove orphaned Cloudinary uploads (uploaded but never attached, > 24 h) | daily |

### 2.5 `db`: PostgreSQL 18

- The only persistent datastore. Named Docker volume, not exposed outside the Docker network.
- Full-text search uses a `tsvector` generated column with a GIN index on `Message` (ADR-015).
- `CONN_MAX_AGE` connection reuse. Django 6's native connection pooling (`psycopg[pool]`) is enabled in production.

### 2.6 `redis`: Redis 8

Ephemeral by design. Losing Redis loses presence and in-flight jobs, but never user data.

| DB | Use |
|---|---|
| 0 | Django cache (rate-limit counters, presence, typing state) |
| 1 | Channels layer (pub/sub groups) |
| 2 | Celery broker |
| 3 | Celery results |

AOF persistence is enabled in production so queued Celery jobs survive a restart.

### 2.7 External services

| Service | Purpose | Notes |
|---|---|---|
| Cloudinary | Avatars, server icons, attachments, export files | Signed direct uploads (ADR-010). Credentials only via `CLOUDINARY_URL`. |
| SMTP provider | Verification, password reset, notifications | Mailpit in development. |
| Sentry | Error tracking for frontend and backend | Optional. Disabled when the DSN is unset. |
| Uptime monitor | External health checks | e.g. UptimeRobot / Better Stack free tier. |
| Object storage | Off-site DB backups | S3-compatible (e.g. Backblaze B2). |

## 3. Key flows

### 3.1 Authentication (ADR-006)

```
Browser                         Next.js (web)                 Django (api)
  │ POST /api/v1/auth/login {email,pw} ───────────────────────▶│ verify, rate-limit, audit
  │◀──────── 200 + Set-Cookie: access (15 min), refresh (14 d, path=/api/v1/auth), csrftoken
  │ GET /channels/... ─────────────▶│ server component: forward cookies
  │                                 │ GET http://api:8000/api/v1/users/me ─▶│
  │◀──────── HTML ──────────────────│◀──────────────────────────────────────│
  │ (access token expires)          │
  │ GET /api/v1/... ──────────────────────────────────────────▶│ 401 token_expired
  │ POST /api/v1/auth/refresh (refresh cookie) ───────────────▶│ rotate + blacklist old
  │◀──────── new cookies; client retries the original request
```

- Cookies: `access` and `refresh` are `HttpOnly; Secure; SameSite=Lax`. The refresh cookie is scoped to `Path=/api/v1/auth`.
- CSRF: Django's CSRF middleware stays on for cookie-authenticated unsafe requests. The frontend reads the non-httpOnly `csrftoken` cookie and sends `X-CSRFToken`.
- Refresh tokens rotate on every use. Old ones are blacklisted. Logout blacklists the current refresh token and clears the cookies.

### 3.2 Sending a message (ADR-007)

```
Client A                    api (REST)                 Postgres     Redis channel layer       Client B
  │ optimistic render (nonce)                                                                     │
  │ POST /channels/{id}/messages {content, nonce} ─▶│                                               │
  │                           │ check SEND_MESSAGES  │                                               │
  │                           │ INSERT message ─────▶│                                               │
  │                           │ on_commit: group_send("channel.{id}", message.created) ─▶│           │
  │◀── 201 {message, nonce} ──│                                                          │──WS event▶│
  │ replace optimistic item by nonce                                                     │           │
  │◀──────────────────────────────────── WS event (deduplicated by id) ─────────────────│           │
```

- An idempotency key (`nonce`, unique per author for 24 h) prevents duplicates when a client retries.
- Mentions and notifications are created in the same transaction. Pushing them to per-user groups happens after commit.

### 3.3 WebSocket connection lifecycle

1. The client opens `wss://<host>/ws/` and the browser sends cookies automatically (same origin).
2. `AllowedHostsOriginValidator` checks `Origin`. `JWTCookieAuthMiddleware` validates the access cookie. Failure → close code `4401`.
3. On connect, the consumer joins `user.{id}`, which carries DMs, notifications and membership changes. Presence is set to online.
4. The client sends `subscribe` for the server/channel it is viewing. The server checks permissions, then joins `server.{id}` (presence, channel list changes) and `channel.{id}` (messages, typing, reactions, polls).
5. A heartbeat every 30 s refreshes the presence TTL in Redis (60 s). A missed TTL → offline broadcast.
6. Before the access token expires, the client refreshes over REST and sends a `reauth` frame. If the token expires anyway, the server closes with `4401` and the client refreshes and reconnects.
7. After a reconnect, the client calls `GET /channels/{id}/messages?after=<last_seen_id>` to backfill.

The full event catalogue is in [API.md](API.md#3-websocket-protocol).

### 3.4 Media uploads (ADR-010)

1. The client calls `POST /api/v1/media/sign` with `{purpose: "avatar" | "server_icon" | "attachment", filename, size, content_type}`.
2. The API checks permissions and limits, then returns a signed set of Cloudinary upload parameters (folder, allowed formats, max bytes, eager transformations, short expiry).
3. The browser uploads straight to Cloudinary, so large files never pass through our servers.
4. The client sends the returned `public_id` with the message/profile update. The API verifies the asset (resource lookup) before attaching it.
5. Uploads never attached within 24 h are deleted by the beat task.

### 3.5 PDF export

1. `POST /api/v1/exports {scope: channel|dm, id, from?, to?}` → `202 {export_id, status: "pending"}`.
2. A Celery `heavy` task streams messages in batches, builds the PDF with ReportLab and uploads it to Cloudinary as a private `raw` asset.
3. On completion, the user gets a notification over WebSocket (`export.ready`). The download goes through a short-lived signed URL.
4. A beat task deletes the asset and the record after 24 h.

## 4. Permissions model (summary)

Discord-style, computed on the server for every request and subscription. See [DATA_MODEL.md](DATA_MODEL.md#permissions) for the bit values.

```
base       = @everyone.permissions | union(member.roles.permissions)
if owner or base & ADMINISTRATOR: return ALL
channel    = apply overwrites in order: @everyone overwrite → role overwrites (deny then allow, unioned) → member overwrite
```

Computed permissions are cached per `(member, channel)` in Redis for 60 s. The cache is invalidated on role/overwrite/membership changes.

## 5. Environments

| | Development | CI | Production |
|---|---|---|---|
| Compose files | `compose.yaml` + `compose.override.yaml` | service containers / `compose.yaml` | `compose.yaml` + `compose.prod.yaml` |
| Code | bind-mounted, hot reload (`uvicorn --reload`, `next dev`) | checked out | baked into images from GHCR |
| Settings | `config.settings.dev` | `config.settings.test` | `config.settings.prod` |
| TLS | none (`http://localhost`) | none | Caddy + Let's Encrypt |
| Email | Mailpit | locmem | SMTP provider |
| Debug tools | debug toolbar, Swagger UI | — | Swagger UI available to staff only |

## 6. Configuration

All configuration comes from environment variables (12-factor). Development reads them from `.env`. Production reads them from `/srv/app/.env` on the server, readable only by root and the deploy user. The full list is in [DEVELOPMENT.md](DEVELOPMENT.md#environment-variables).

## 7. Security architecture

- **Transport:** HTTPS only, HSTS (preload once stable), secure cookies.
- **Authentication:** JWT in httpOnly cookies, rotation + blacklist, Argon2 hashes, email verification.
- **Authorization:** DRF permission classes plus service-level checks. Querysets are always scoped to the requesting user's memberships, so IDs from other servers return `404`, not `403`.
- **Input/output:** DRF serializers validate everything. Markdown is rendered on the client with a safe renderer (no raw HTML). Strict CSP with nonces.
- **Rate limiting:** DRF throttles (Redis-backed) per user/IP scope, plus WS event rate limits in the consumer, and Caddy request size limits.
- **Containers:** non-root users, read-only root filesystem where possible, no published ports except Caddy's 80/443, and the Docker socket is never mounted.
- **Host:** SSH key-only, UFW (22/80/443), fail2ban, unattended security upgrades.
- **Supply chain:** lockfiles (`uv.lock`, `pnpm-lock.yaml`), Dependabot, `pip-audit` / `pnpm audit`, Trivy image scanning, gitleaks secret scanning.

## 8. Observability

- **Logs:** JSON to stdout, collected by Docker's `local` log driver with rotation. Each line has `request_id`, `user_id` and `route`. Request IDs come from Caddy's `X-Request-ID` and are passed into Celery task headers.
- **Errors:** Sentry for Django, Celery and Next.js (both server and client), with release tagging from the Git SHA.
- **Health:** `/api/health/live` and `/api/health/ready`. Docker health checks for every service. External uptime checks.
- **Metrics (lightweight):** a weekly email summary from a beat task (DAU, messages, disk usage). A Prometheus/Grafana stack is not justified at this scale and is deferred.

## 9. Scaling path (if ever needed)

The design keeps future options open without paying for them now:

1. Vertical: a bigger VPS, more Uvicorn workers and Celery concurrency.
2. Move Postgres/Redis to managed services by changing environment variables only.
3. Run several `api` replicas behind Caddy. The Redis channel layer already supports multi-process fan-out.
4. Cursor pagination and UUIDv7 keys already suit large message tables. Partitioning `Message` by time is possible later.
