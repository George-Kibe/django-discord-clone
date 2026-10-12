# Architecture Decision Records

Lightweight ADRs. Each records a decision, its context and its consequences. ADRs are **append-only**: to change a decision, add a new ADR that supersedes the old one and update the old one's status.

**Status values:** `Proposed` · `Accepted` · `Superseded by ADR-NNN` · `Deprecated`

**Template** (copy for new entries):

```markdown
## ADR-NNN: Title
- **Status:** Proposed
- **Date:** YYYY-MM-DD
### Context
### Decision
### Consequences
```

## Index

| # | Title | Status |
|---|---|---|
| 001 | Monorepo with `backend/`, `frontend/`, `infra/` | Accepted |
| 002 | Django 6.1.2 now, upgrade to 6.2 LTS | Accepted |
| 003 | Version policy: LTS where it exists, pinned everywhere | Accepted |
| 004 | Decoupled DRF API + Next.js App Router frontend | Accepted |
| 005 | Single origin behind Caddy | Accepted |
| 006 | JWT in httpOnly cookies (SimpleJWT) | Accepted (refined by ADR-022) |
| 007 | Django Channels: REST for writes, WebSocket for push | Accepted (refined by ADR-024) |
| 008 | Celery + Redis for background work | Accepted (amended by ADR-021) |
| 009 | PostgreSQL 18 without PostGIS | Accepted |
| 010 | Cloudinary with signed direct uploads | Accepted |
| 011 | UUIDv7 primary keys | Accepted |
| 012 | Discord-style domain model with permission bitfields | Accepted |
| 013 | Single VPS, Docker Compose, GHCR, SSH deploy | Accepted |
| 014 | Tooling: uv, pnpm, Ruff, mypy, pytest, ESLint, Prettier, Vitest, Playwright | Accepted |
| 015 | PostgreSQL full-text search | Accepted |
| 016 | Uvicorn as the ASGI server | Accepted |
| 017 | OpenAPI-first contract with generated TypeScript types | Accepted |
| 018 | Keep legacy code in `legacy/` until parity | Accepted |
| 019 | Conventional Commits, SemVer, Keep a Changelog | Accepted |
| 020 | shadcn/ui + TanStack Query on the frontend | Accepted |
| 021 | Celery beat with a static schedule (no django-celery-beat) | Accepted |
| 022 | Signed-in app fetches user data client-side; `session` hint cookie | Accepted |
| 023 | Backups: age public-key encryption + rclone to any S3 | Accepted |
| 024 | Gateway: automatic subscriptions, close-on-expiry, patch hot data | Accepted |
| 025 | Messaging: conversation targets, mention tokens, coalesced DM notifications | Accepted |

---

## ADR-001: Monorepo with `backend/`, `frontend/`, `infra/`
- **Status:** Accepted
- **Date:** 2026-10-11

### Context
One developer maintains both apps. API changes and frontend changes usually ship together.

### Decision
One repository: `backend/` (Django), `frontend/` (Next.js), `infra/` (Caddy, backup scripts), `docs/`, and Compose files at the root. CI uses path filters so each app's pipeline runs only when needed.

### Consequences
- Atomic PRs across API and UI. One issue tracker, one changelog.
- Docker images are built separately per app (`ghcr.io/george-kibe/discord-clone-api`, `…-web`).
- Workflow path filters must be maintained.

## ADR-002: Django 6.1.2 now, upgrade to 6.2 LTS
- **Status:** Accepted
- **Date:** 2026-10-11

### Context
The project prefers LTS versions, but the owner chose Django 6.1.2. Django 6.1 (released 2026-08-05) is a **non-LTS** release: mainstream support ends April 2027 and security support ends December 2027. The current LTS, 5.2, gets security fixes until April 2028. The next LTS, **6.2**, is due April 2027 (support until April 2030). Django has also accepted DEP 20, moving to annual releases with three years of support each from 2028.

### Decision
Start on **Django 6.1.2**. Upgrade to **Django 6.2 LTS** within ~1 month of its release (a roadmap maintenance item). Fix every deprecation warning as it appears (`-W error::DeprecationWarning` in the test settings) so the upgrade stays trivial.

### Consequences
- We get the latest features, and moving to 6.2 is a small step (unlike 5.2 → 6.x).
- One planned upgrade in 2027. The 6.1 security window (Dec 2027) leaves plenty of slack.
- Third-party packages must support 6.1. Check before adding any dependency.

## ADR-003: Version policy: LTS where it exists, pinned everywhere
- **Status:** Accepted
- **Date:** 2026-10-11

### Context
The owner wants LTS versions for all software. Not every project has an LTS concept.

### Decision

| Software | Version | Policy |
|---|---|---|
| Python | 3.14.x | No LTS. Use the newest series that Django and all dependencies support (3.15 once supported). Each series gets ~5 years of support. |
| Django | 6.1.2 → 6.2 LTS | See ADR-002. |
| Node.js | 24.x (Active LTS) → **26.x** | Node 26 becomes Active LTS on 2026-10-28. Upgrade soon after. Never run an odd-numbered or "Current" release in production. |
| Next.js | 16.4.0 | Latest stable major. Patch updates promptly (security). |
| React | 19.x | The version Next.js 16.4 requires. |
| Tailwind CSS | 4.x | Latest stable major. |
| PostgreSQL | 18.x | No LTS. Every major gets 5 years (18 → Nov 2030). Track minor releases. |
| Redis | 8.x (latest GA minor) | No LTS. Track the latest GA minor (Redis 8.0 reaches EOL Dec 2026). |
| Caddy | 2.x | Latest stable. |
| Celery / DRF / Channels / etc. | Latest stable compatible with Django 6.1 | Pinned in `uv.lock`. |
| Base OS images | Debian 13 (trixie) slim | Official `python:3.14-slim-trixie` and `node:24-trixie-slim` images. |

- **Exact versions are pinned** in `uv.lock`, `pnpm-lock.yaml`, `packageManager` and Dockerfile tags (`postgres:18.x`, never `latest`).
- Dependabot opens weekly update PRs. Security patches are merged quickly. Majors get a planned upgrade with a changelog entry.

### Consequences
Reproducible builds, predictable upgrades. Some maintenance work each quarter.

## ADR-004: Decoupled DRF API + Next.js App Router frontend
- **Status:** Accepted
- **Date:** 2026-10-11

### Context
The legacy app rendered Jinja/Django templates. Real-time chat UIs need rich client-side state. The owner chose DRF and Next.js.

### Decision
Django exposes a versioned JSON API (`/api/v1`) and WebSockets. It renders no user-facing HTML (only Django admin). Next.js App Router renders all UI: Server Components for public and initial loads, Client Components for interactive chat.

### Consequences
- A clear contract (OpenAPI) and the ability to test each side independently.
- Two runtimes to build and deploy.
- Auth must work for both browser fetches and Next.js server-side fetches. Cookies forwarded over the internal network solve this (ADR-006).

## ADR-005: Single origin behind Caddy
- **Status:** Accepted
- **Date:** 2026-10-11

### Context
Cross-origin setups (`app.example.com` + `api.example.com`) need CORS, third-party-ish cookies, and more CSRF complexity.

### Decision
Caddy serves everything from one domain: `/` → Next.js; `/api/*`, `/ws/*`, `/admin/*`, `/static/*` → Django. Caddy provides automatic HTTPS.

### Consequences
- First-party `SameSite=Lax` cookies. No CORS configuration. WebSocket handshakes carry cookies automatically.
- Next.js routes must never use the `/api`, `/ws`, `/admin` or `/static` prefixes. Next.js route handlers, if any, live under `/_app-api` or similar.
- Caddy was chosen over Nginx for automatic certificate management and a simpler config. Traefik was rejected as overkill for one host.

## ADR-006: JWT in httpOnly cookies (SimpleJWT)
- **Status:** Accepted
- **Date:** 2026-10-11

### Context
We need auth that works for REST, Next.js server-side rendering and WebSockets, and that keeps tokens away from JavaScript (XSS).

### Decision
- `djangorestframework-simplejwt` with the token blacklist app. Access token lifetime 15 min, refresh 14 days, rotation on, blacklist after rotation.
- Tokens are delivered **only** as `HttpOnly; Secure; SameSite=Lax` cookies (`access` on `/`, `refresh` on `/api/v1/auth`). A custom `JWTCookieAuthentication` DRF class reads them.
- CSRF protection is enforced on cookie-authenticated unsafe requests (double-submit with the `csrftoken` cookie + `X-CSRFToken` header).
- The WebSocket uses the same access cookie through custom Channels middleware.
- Reuse of a blacklisted refresh token revokes all of that user's refresh tokens and is audited (`token_refresh_reuse`).
- Social login (django-allauth) can be added later without changing this design.

### Consequences
- Tokens are immune to XSS theft. Stateless access checks.
- Revocation is effective within ≤ 15 min (access lifetime). This is acceptable at our scale.
- Needs a CSRF bootstrap endpoint and careful cookie handling in tests.

## ADR-007: Django Channels: REST for writes, WebSocket for push
- **Status:** Accepted (refined by ADR-024: automatic subscriptions, no `reauth`)
- **Date:** 2026-10-11

### Context
Chat needs live updates. Sending writes over WebSockets duplicates validation, auth and error handling, and it complicates idempotency and testing.

### Decision
- **Django Channels** with the **Redis channel layer** (`channels-redis`).
- All writes (send/edit/delete message, react, vote, etc.) go through REST endpoints. Services publish events to channel-layer groups in `transaction.on_commit`.
- The WebSocket is used for server push plus a few ephemeral client signals: subscribe, typing, presence heartbeat, reauth.
- Presence and typing state live in Redis with TTLs, not in Postgres.
- Clients backfill over REST after reconnecting (`?after=<last_id>`).

### Consequences
- One validation and permission path. Easy to test with plain API tests.
- Slightly more latency than WS writes (one HTTP round trip), which is negligible at this scale.
- Delivery is at-most-once over the WebSocket, made reliable by REST backfill and ID-based deduplication on the client.

## ADR-008: Celery + Redis for background work
- **Status:** Accepted
- **Date:** 2026-10-11

### Decision
Celery workers (`default` and `heavy` queues) and Celery beat (static schedule, see ADR-021). Redis is the broker and result backend. Tasks must be idempotent, use `acks_late`, retry with backoff and have time limits. Use for: email, notifications fan-out, PDF exports, poll closing, cleanups, link previews.

### Consequences
Two extra containers (worker, beat). Redis gets AOF persistence in production so queued jobs survive restarts. Django 6's built-in Tasks framework was considered, but Celery is more mature for retries, scheduling and monitoring today. Revisit once the Tasks framework has production backends.

## ADR-009: PostgreSQL 18 without PostGIS
- **Status:** Accepted
- **Date:** 2026-10-11

### Context
PostGIS was an option, but no planned feature needs geospatial queries.

### Decision
Official `postgres:18` image. PostGIS can be adopted later by switching to the `postgis/postgis:18-*` image and running `CREATE EXTENSION postgis` in a migration, with no data migration.

### Consequences
Smaller image, simpler upgrades.

## ADR-010: Cloudinary with signed direct uploads
- **Status:** Accepted
- **Date:** 2026-10-11

### Decision
- Images and files are stored in Cloudinary (the owner provides the account). Credentials come only from the `CLOUDINARY_URL` environment variable.
- The browser uploads **directly** to Cloudinary using parameters the API signs (`POST /api/v1/media/sign`). The signature fixes the folder, allowed formats, max size and expiry.
- The DB stores `public_id` only. URLs are built on the fly, with transformations (`f_auto,q_auto`, sized thumbnails).
- Folder layout: `{env}/avatars/`, `{env}/server-icons/`, `{env}/attachments/{server_or_dm}/`, `{env}/exports/` (private, `raw`).
- Orphaned uploads are cleaned daily (`PendingUpload` table).
- Django static files (admin) are served by WhiteNoise, not Cloudinary.

### Consequences
No file bytes through our VPS (saves bandwidth and disk). Free-tier limits must be watched. Dev and prod use separate folders (or separate Cloudinary environments) so test data never mixes with production data.

## ADR-011: UUIDv7 primary keys
- **Status:** Accepted
- **Date:** 2026-10-11

### Decision
All domain models use `UUIDField(primary_key=True, default=uuid.uuid7)` (Python 3.14 standard library).

### Consequences
- IDs can't be enumerated, which is safe to expose in URLs.
- Time-ordered, so B-tree inserts stay efficient, and message IDs double as pagination cursors.
- 16 bytes vs 8 for bigint, which is negligible at this scale.

## ADR-012: Discord-style domain model with permission bitfields
- **Status:** Accepted
- **Date:** 2026-10-11

### Decision
Servers → categories → channels. Members hold roles, roles carry a 64-bit permission bitfield, channels have allow/deny overwrites, and there is a role hierarchy by position. Permission bits are append-only. See [DATA_MODEL.md](DATA_MODEL.md#permissions).

### Consequences
A flexible, familiar model. Permission computation must be centralised (`apps/core/permissions.py`), cached and heavily tested (property-based tests for overwrite precedence).

## ADR-013: Single VPS, Docker Compose, GHCR, SSH deploy
- **Status:** Accepted
- **Date:** 2026-10-11

### Context
Low expected traffic and a minimal budget, but the setup must be production-grade.

### Decision
- One Linux VPS (default 2 vCPU / 4 GB, Ubuntu 24.04 LTS or Debian 13) running Docker Engine + Compose.
- GitHub Actions builds multi-arch-capable images and pushes them to **GHCR**, tagged with the Git SHA and the SemVer tag.
- The deploy job SSHes to the VPS (a dedicated `deploy` user), runs `docker compose pull`, runs migrations as a one-off container, then `docker compose up -d`.
- Production deploys are gated by the GitHub `production` environment (manual approval optional). Merges to `main` deploy automatically. Release tags mark versions.
- Nightly `pg_dump` to off-site S3-compatible storage.

### Consequences
Cheap and simple. The single point of failure is accepted (NFR-REL-01). Moving to Kubernetes or a PaaS later only needs the existing images.

## ADR-014: Tooling
- **Status:** Accepted
- **Date:** 2026-10-11

### Decision

| Area | Backend | Frontend |
|---|---|---|
| Package manager | **uv** (`pyproject.toml` + `uv.lock`) | **pnpm** (`packageManager` field pinned) |
| Lint / format | **Ruff** (lint + format) | **ESLint** (flat config) + **Prettier** (+ Tailwind plugin) |
| Types | **mypy** + `django-stubs` + `djangorestframework-stubs` | TypeScript strict, `tsc --noEmit` |
| Unit / integration tests | **pytest**, pytest-django, pytest-asyncio, factory-boy | **Vitest** + Testing Library + MSW |
| E2E | — | **Playwright** against the full Compose stack |
| Git hooks | **pre-commit** (Ruff, Prettier, gitleaks, basic file hygiene). mypy, ESLint, `tsc` and tests are too slow for every commit, so they run in CI and `make check` | |

Tests coverage should always be at least 95%

### Consequences
Fast tooling. One `pre-commit` config at the repo root covers both stacks. The heavier checks run in CI.

## ADR-015: PostgreSQL full-text search
- **Status:** Accepted
- **Date:** 2026-10-11

### Decision
A generated `tsvector` column on `Message` with a GIN index, queried with `SearchQuery`/`SearchRank`. The `simple` config is used so search works across languages without stemming surprises. Elasticsearch/Meilisearch were rejected as unnecessary infrastructure for this scale.

### Consequences
No extra services. Relevance is basic but adequate. A dedicated engine can be added behind the selector later.

## ADR-016: Uvicorn as the ASGI server
- **Status:** Accepted
- **Date:** 2026-10-11

### Decision
Run Django (HTTP + WebSocket) with **Uvicorn** (`uvicorn[standard]`, uvloop + httptools + websockets), using `--workers 2` in production behind Caddy. Daphne was considered. Uvicorn is faster, widely used and well maintained. Gunicorn is unnecessary because Uvicorn now manages worker processes itself.

### Consequences
One process type for HTTP and WS. Sync DRF views run in a thread pool through `asgiref`, which is fine at this load.

## ADR-017: OpenAPI-first contract with generated TypeScript types
- **Status:** Accepted
- **Date:** 2026-10-11

### Decision
drf-spectacular generates the schema. `pnpm gen:api` runs `openapi-typescript` to produce `frontend/src/types/api.d.ts`, which is committed. CI fails if the committed schema or types drift from the backend (`manage.py spectacular --validate` + a diff check). WebSocket payloads reuse the REST serializers, so they share the same types.

### Consequences
Type-safe frontend. API changes show up in PR diffs.

## ADR-018: Keep legacy code in `legacy/` until parity
- **Status:** Accepted
- **Date:** 2026-10-11

### Decision
Move the existing apps (`base`, `polls`, `signalstest`, `studybuddy`, templates, static, `requirements.txt`, `manage.py`) into `legacy/` in Phase 0. Legacy code is never modified, run in CI or deployed. It is deleted at v1.0 (it stays in Git history).

### Consequences
Reference stays at hand without polluting the new codebase.

## ADR-019: Conventional Commits, SemVer, Keep a Changelog
- **Status:** Accepted
- **Date:** 2026-10-11

### Decision
Commit messages follow Conventional Commits (`feat(messaging): …`). Versions follow SemVer (`0.y.z` until v1.0). `CHANGELOG.md` follows *Keep a Changelog*, with entries added in each PR under `Unreleased`. Releases are Git tags `vX.Y.Z` with GitHub Releases.

## ADR-020: shadcn/ui + TanStack Query on the frontend
- **Status:** Accepted
- **Date:** 2026-10-11

### Decision
- **shadcn/ui** (copy-in components on Radix primitives) styled with Tailwind 4, so we own the code and get accessible primitives.
- **TanStack Query** for server state. WebSocket events update the cache through `queryClient.setQueryData`.
- **React Hook Form + Zod** for forms.
- No global state library at first. Zustand is added only if cross-cutting client state grows.

### Consequences
Accessible, consistent UI without a heavy component library dependency.

### merge and commit rules
When done working on a feature, test it 100%, test all previous features to ensure it does not affect the previous code then merge to main and delete the created branch(both locally and on github)

## ADR-021: Celery beat with a static schedule (no django-celery-beat)
- **Status:** Accepted (amends ADR-008)
- **Date:** 2026-10-11

### Context
ADR-008 planned to store beat schedules in the database with `django-celery-beat`. During Phase 0, its latest release (2.9.0) declared `django<6.1`, so it can't be installed with Django 6.1.2 (ADR-002). Every planned schedule is fixed (every minute, hourly, daily). None needs to be edited at runtime.

### Decision
Use Celery's built-in beat scheduler with the schedule declared in `CELERY_BEAT_SCHEDULE` (`config/settings/base.py`). Beat's local state file lives in `/tmp` inside the container. Losing it on restart only means a task runs at its next interval, which is harmless because tasks are idempotent.

### Consequences
- One less dependency and no beat tables. Schedules are reviewed in code like everything else.
- Changing a schedule needs a deploy. That's acceptable at this scale.
- Revisit if runtime-editable schedules are ever needed and `django-celery-beat` supports the Django version in use.

## ADR-022: Signed-in app fetches user data client-side; `session` hint cookie
- **Status:** Accepted (refines ADR-006)
- **Date:** 2026-10-11

### Context
ADR-006 scopes the refresh cookie to `/api/v1/auth`, so the browser only sends it to auth endpoints. A Next.js server component rendering `/channels/...` therefore never sees the refresh token. When the 15-minute access token expires, server-side rendering can't refresh it, and Server Components can't set cookies anyway. With Cache Components, session reads must also sit behind `<Suspense>`, so server rendering wouldn't speed up the first paint of the signed-in app.

### Decision
- The signed-in app (`/channels/*`, `/settings/*`) prerenders a static shell and loads user data in the browser with TanStack Query. The browser API client adds the CSRF header and does one single-flight `POST /auth/refresh` on a 401, then retries the request.
- Login and refresh also set `session=1`: a non-httpOnly, non-secret cookie with the refresh token's lifetime. `proxy.ts` uses it to gate routes. Logout and failed refreshes clear it.
- Public pages (landing, auth, discovery) remain server-rendered.

### Consequences
- Expired access tokens never surface to users. The refresh token never leaves the auth path.
- The signed-in UI shows a short loading state on a full page load. Client navigations are instant.
- The hint cookie can be forged, but that only renders an empty shell that immediately fails its API calls. Every authorization decision stays in the API.

## ADR-023: Backups: age public-key encryption + rclone to any S3
- **Status:** Accepted
- **Date:** 2026-10-11

### Context
NFR-REL-03/04 need nightly off-site backups and tested restores. The storage provider isn't chosen yet. A passphrase stored next to the backups on the server would let anyone who compromises the server read every backup.

### Decision
- A `backup` container (`postgres:18.6` + `age` + `rclone`) runs `pg_dump --format=custom | age -r <public key>` daily and uploads the result with rclone to any S3-compatible bucket, configured through `RCLONE_S3_*` variables.
- Encryption uses an **age public key**. The private key stays offline (password manager) and is mounted only during a restore.
- Retention (7 daily, 4 weekly, 3 monthly) is enforced by the job itself. Success and failure are reported to a heartbeat URL.
- `infra/scripts/rehearse-production.sh` performs a backup and restore drill against a local S3 server on every infra change.

### Consequences
- The provider can be swapped by changing environment variables. A compromised server can't decrypt old backups.
- Losing the private key means losing the backups, so it must be stored redundantly.

## ADR-024: Gateway: automatic subscriptions, close-on-expiry, patch hot data
- **Status:** Accepted (refines ADR-007)
- **Date:** 2026-10-12

### Context
ADR-007 planned explicit `subscribe` frames for the viewed server/channel and a `reauth` frame after a REST token refresh. In practice, unread badges, presence and typing are needed for every server and channel the user can see, not only the one on screen. A WebSocket can't see cookies set after its handshake, so `reauth` couldn't read a refreshed access cookie.

### Decision
- **Automatic subscriptions.** On connect the consumer joins `user.{id}`, `server.{id}` for every membership and `channel.{id}` for every channel the user can view. Services send a `realtime.control` `resync` to the server (structural or permission changes) or to the user (joined, left, role change). The consumer recomputes that server's visible channels and emits `server.joined`, `server.access_changed` or `server.removed`. Private channel events never reach members who can't see them.
- **Close on expiry, no `reauth`.** The server closes with `4401` when the access token expires, and also on password change/reset and logout. If the closed connection was working, the client first reconnects with its current cookies, because a request in this tab may have just replaced them. If a connection is refused before `ready`, the client refreshes over REST and reconnects. If the refresh fails, the client goes to the login page.
- **Patch hot data, refetch structure.** Messages, typing, presence and read states are applied straight to the client caches. Channel, category, role, member and server events invalidate the affected queries. After a reconnect the client backfills messages with `?after=` and refetches everything else.
- **Presence.** Redis holds a per-connection key with a 70 s TTL that heartbeats refresh, a set of online users, the chosen status and a per-user version. Disconnects and the 30 s Celery sweep prune connections with an atomic Lua script. Every presence event carries the version, and clients ignore older versions, so events that arrive out of order never show a connected user as offline. Consumer cleanup runs in a `finally` block, so it also runs when a send to a vanished client raises.
- **Channel layer timeouts.** redis-py 8 defaults `socket_timeout` to 5 s, the same as channels-redis's blocking `BZPOPMIN`, which crashed idle consumers. The layer's connections use `socket_timeout=30`.

### Consequences
- Every connection is in roughly (servers + visible channels) groups. That is fine at this scale (100 connections: p95 fan-out 46 ms locally). A very large deployment would move to per-view subscriptions.
- Any permission change costs one subscription recompute per connected member of that server.
- Revoked sessions on other devices can reconnect until their access token expires (≤ 15 min), the same as REST with stateless JWTs.

## ADR-025: Messaging: conversation targets, mention tokens, coalesced DM notifications
- **Status:** Accepted
- **Date:** 2026-10-12

### Context
Phase 5 adds DMs next to channels, plus replies, mentions, reactions, pins, attachments, search and notifications. Channels and DMs need the same features, but their permission models differ (the permission engine versus implicit participant rights plus blocking). Mentions must survive renames. A busy DM must not flood the inbox.

### Decision
- **Conversation targets.** Every message operation resolves a `Target` (`apps/messaging/targets.py`): a channel with effective permissions from the engine, or a DM whose participants hold every message permission except moderation. In a 1:1 DM where either side blocked the other, sending, reacting and attaching are denied. History, sending, reactions, pins, typing and search share this one code path. `Message` has nullable `channel`/`dm` with a check constraint.
- **Mention tokens.** Content stores `<@user_id>`, `<@&role_id>` and `@everyone` (Discord's format). The composer turns `@username` / `@Role` into tokens on send and back for editing. Payloads include the resolved `mentions` and `mention_roles` for rendering. `@everyone` needs MENTION_EVERYONE; a role notifies only if it's mentionable or the author has MENTION_EVERYONE. Only members who can view the channel are counted or notified.
- **Notifications.** Mentions and replies each create an inbox entry and bump the channel's `ReadState.mention_count`. DM messages bump `DMParticipant.unread_count` (DM read state lives on the participant, not on `ReadState`). Unread DM notifications are coalesced into one entry per conversation that carries a count. Mutes suppress @everyone/@role and DM notifications; direct mentions and replies still notify. Users who blocked the author get nothing.
- **Search.** Postgres full-text search over a generated `tsvector` column (`simple` config, GIN index) with `websearch_to_tsquery`. Server search covers only channels where the user has READ_MESSAGE_HISTORY.
- **Event order and catch-up.** `message.created` is published before the badge and notification events about it. Clients also catch up on the first gateway `ready`, not only after reconnects: read states, inbox, DM list and member presence are refetched, and loaded conversations are backfilled, because events between the initial fetches and `ready` would otherwise be lost.

### Consequences
- Channels and DMs can't drift apart feature-wise. Permission checks stay in one place per kind.
- Renaming a user or role never breaks old messages. Tokens of departed users render as "@unknown-user".
- The inbox stays readable for busy DMs. Unread DM badges come from participant counters, so they're one query.
- `simple` search config means no stemming: "notes" doesn't match "note". That's acceptable for a multilingual student audience and could move to per-language configs later.
