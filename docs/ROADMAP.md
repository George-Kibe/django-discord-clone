# Roadmap

Delivery is split into phases. Each phase ends in a **deployable, tested increment** with a version tag. A phase is done only when its **exit criteria** are met. Requirement IDs refer to [REQUIREMENTS.md](REQUIREMENTS.md).

Status: ⬜ not started · 🟨 in progress · ✅ done

| Phase | Name | Version | Status |
|---|---|---|---|
| 0 | Foundations | v0.1.0 | ✅ |
| 1 | Accounts & profiles | v0.2.0 | ✅ |
| 2 | Production pipeline (built & rehearsed locally) | v0.3.0 | ✅ |
| 3 | Servers, channels & messages | v0.4.0 | ✅ |
| 4 | Real-time | v0.5.0 | ✅ |
| 5 | Rich messaging & DMs | v0.6.0 | ✅ |
| 6 | Community features | v0.7.0 | ✅ |
| 7 | Hardening, deployment & launch | v1.0.0 | ⬜ |

The production pipeline (Phase 2) was built early and is rehearsed against production images on every infra change (`infra/scripts/rehearse-production.sh`). The **real deployment** waits for the VPS and is the **last step** (Phase 7). Until then, everything is developed and tested locally.

---

## Phase 0: Foundations (`v0.1.0`)

**Goal:** a clean monorepo where `docker compose up` starts a working (empty) stack, with CI enforcing quality from day one.

- [x] Move the legacy app into `legacy/` (ADR-018)
- [x] Root files: `.editorconfig`, `.gitignore` (Python + Node + env), `.env.example`, `.pre-commit-config.yaml`, `.dockerignore`s
- [x] **Backend skeleton**
  - [x] `uv` project, Python 3.14, Django 6.1.2, DRF, Channels, Celery, django-environ
  - [x] Settings split `base/dev/test/prod`. JSON logging. Argon2.
  - [x] `core` app: `UUIDModel`/`TimestampedModel`, error handler (standard error shape), pagination classes
  - [x] Custom `accounts.User` model **created before the first migration**
  - [x] ASGI app with HTTP + WebSocket routing (a ping consumer)
  - [x] Celery app + a sample task. Beat with a static schedule (ADR-021)
  - [x] Health endpoints `/api/health/live`, `/api/health/ready`
  - [x] drf-spectacular schema + Swagger UI
  - [x] pytest + factory-boy setup. Ruff + mypy config
- [x] **Frontend skeleton**
  - [x] Next.js 16.4.0 (App Router, TS strict, `src/`), Tailwind CSS 4, pnpm, Node 24
  - [x] shadcn/ui init, theme tokens (dark default), base layout, landing page
  - [x] Typed API client + `pnpm gen:api`. TanStack Query provider
  - [x] ESLint, Prettier, Vitest, Playwright config
- [x] **Docker (dev)**
  - [x] Multi-stage Dockerfiles for `api` and `web` (dev + prod targets, non-root)
  - [x] `compose.yaml` + `compose.override.yaml`: caddy, web, api, worker, beat, db, redis, mailpit
  - [x] Health checks, named volumes, hot reload
  - [x] Makefile shortcuts (`make up`, `make test`, `make migrate`, …)
- [x] **CI** (`.github/workflows/ci.yml`): backend lint/type/test (Postgres + Redis services), frontend lint/type/test/build, schema-drift check, gitleaks. E2E job (Compose + Playwright), production image build check. Dependabot config
- [ ] Branch protection on `main` (CI required, PRs only). **Owner action** in GitHub settings

**Exit criteria:** fresh clone → `make up` → landing page at `http://localhost`, Swagger at `/api/docs/`, the WS ping works, a Celery task runs; CI is green on a PR.

## Phase 1: Accounts & profiles (`v0.2.0`)

**Goal:** users can register, verify, log in securely and manage their profile.

- [x] Backend: register, verify email, login/refresh/logout (cookie JWT), CSRF bootstrap, password reset/change, email change (FR-AUTH-01…08)
- [x] Throttling for auth endpoints (NFR-SEC-06)
- [x] Auth audit log + admin view (FR-AUTH-08, FR-MOD-05)
- [x] Cloudinary integration: `media/sign`, `PendingUpload`, avatar upload/remove (FR-PROF-01…02, ADR-010). FR-PROF-03: `GET /users/{id}` is done; the profile-card UI lands with member lists in Phase 3
- [x] Transactional email templates (HTML + text) through Celery
- [x] Frontend: auth pages, protected route handling, silent refresh, profile settings, avatar cropper
- [x] WebSocket cookie-auth middleware (connect rejects anonymous users)
- [x] E2E: register → verify (via Mailpit API) → login → update profile → logout, plus password reset, email/password change, silent refresh, real Cloudinary avatar and axe accessibility checks

**Exit criteria:** all FR-AUTH (M) and FR-PROF-01…03 pass their tests. Tokens are never visible to JS. Auth throttles are verified by tests.

## Phase 2: Production pipeline (`v0.3.0`) ✅

**Goal:** everything needed to run in production exists and is proven locally. The real server comes in Phase 7.

- [x] `compose.prod.yaml`, production Caddyfile (TLS, HSTS, headers, compression, HTTP/3), resource limits, Postgres/Redis tuning
- [x] VPS provisioning runbook (user, SSH hardening, UFW, fail2ban, Docker, unattended upgrades) in [DEPLOYMENT.md](DEPLOYMENT.md) and [`infra/env.production.example`](../infra/env.production.example)
- [x] Image build + push to GHCR (`build.yml`) with a Trivy gate. All three images are scan-clean and pushed from `main`
- [x] Deploy workflow (`deploy.yml`, dormant until `DEPLOY_HOST` is set) + `infra/scripts/deploy.sh`: pull, migrate, up `--wait`, smoke test, automatic rollback. `infra/scripts/dc` for operations
- [x] Encrypted nightly backups (`backup` container, age + rclone → S3) with retention and heartbeat (ADR-023)
- [x] Production rehearsal script and CI job: deploy, HTTPS, `check --deploy`, Secure cookies/CSRF, backup + restore drill, broken-release rollback
- [x] Host disk/memory/unhealthy-container alert (`infra/scripts/host-health.sh` + cron → heartbeat)
- [x] Sentry for backend, Celery and Next.js (server + browser via `/monitoring` tunnel), privacy-hardened and verified with probe requests. Off until a DSN is set
- [x] Local access: the full app at http://localhost (Caddy), plus Next.js on :3000 and Django on :8000 (E2E passes on both :3000 and Caddy)

**Exit criteria (met locally):** the rehearsal passes in CI (deploy, HTTPS, rollback, backup → restore). Images are scan-clean and published. Sentry captures errors without leaking secrets. Server-dependent criteria moved to Phase 7.

## Phase 3: Servers, channels & messages (`v0.4.0`) ✅

**Goal:** the core Discord structure works over REST (no live updates yet).

- [x] Servers CRUD, default role + `#general`, membership, leave, ownership transfer (FR-SRV-01…06, 09)
- [x] Roles & permission engine with hierarchy (FR-ROLE-01…04). Heavy unit + property tests
- [x] Invites: create/preview/accept/revoke (FR-SRV-04/05)
- [x] Categories & text channels CRUD + reordering. Visibility filtering (FR-CH-01…03)
- [x] Messages: send (with nonce), history (cursor), edit, delete, moderator delete (FR-MSG-01, 03…05, 11)
- [x] Frontend: the Discord 3-column layout (server rail, channel sidebar, chat pane, member list), server/channel settings dialogs, invite flow, message list with virtualization and infinite scroll, composer
- [x] Query-count tests on list endpoints (NFR-PERF-04/05)
- [x] Also delivered: channel permission overwrites (API + engine; UI in Phase 6), public profile card with mutual servers (FR-PROF-03), topics seeded, generated permission constants with a CI drift check, server icons
- Deferred by design: live updates (done in Phase 4), kick/ban (Phase 6), discovery page (Phase 6)

**Exit criteria:** two users can create/join a server via invite, create channels and exchange messages (on refresh). Permission tests cover the overwrite/hierarchy matrix.

## Phase 4: Real-time (`v0.5.0`) ✅

**Goal:** everything updates live.

- [x] Realtime consumer: automatic subscriptions with permission-aware resync, groups, frame rate limit, close codes ([API.md](API.md#3-websocket-protocol), ADR-024)
- [x] Event publishing from services (`on_commit`) for messages, channels, categories, members, roles, servers and profiles
- [x] Typing indicators, presence (Redis TTL + versioned events + Celery sweep), status selection (FR-MSG-06, FR-PRES-01, FR-PROF-04)
- [x] Read states, unread markers on channels and servers, mention-count badges, cross-tab sync (FR-CH-04). Mentions are counted once they exist (Phase 5, FR-MSG-08)
- [x] Frontend `RealtimeClient`: reconnect/backoff with jitter, token-expiry handling (close `4401` → refresh → reconnect, ADR-024), backfill, cache patching, optimistic send reconciliation (FR-MSG-02, 11, 12). Polling removed
- [x] Permission-change handling (groups recomputed, `server.access_changed` / `server.removed`)
- [x] E2E: two browser contexts see each other's messages, typing, presence, status and unread state live; a cut connection reconnects and backfills; an API restart mid-session loses and duplicates nothing
- [x] Also delivered: sockets close on password change/reset and logout; connection-lost banner; `realtime_loadtest` management command
- Fixed along the way: idle consumers crashed every few seconds (redis-py 8's 5 s socket timeout vs channels-redis's 5 s blocking pop); consumers that failed mid-connect left ghost presence

**Exit criteria:** fan-out p95 < 500 ms locally under a 100-connection load script (**measured: p95 46 ms, 2000/2000 deliveries**). Killing the `api` container mid-session → clients reconnect and backfill with no lost or duplicated messages (**E2E `server-restart.spec.ts`**).

## Phase 5: Rich messaging & DMs (`v0.6.0`) ✅

- [x] Replies with quoted previews, mentions (@user/@role/@everyone) with autocomplete, highlighting, mention badges and a notifications inbox (FR-MSG-07/08, FR-PRES-02)
- [x] Reactions: Unicode emoji, picker, live counts (FR-MSG-09)
- [x] Attachments via signed Cloudinary uploads: images with previews and a lightbox, files as download cards, 10 MB / 5 per message, removed with the message (FR-MSG-10)
- [x] Pins (FR-MSG-13)
- [x] 1:1 DMs, group DMs (≤ 10 people, rename, add, leave, owner transfer), blocking (FR-DM-01…04)
- [x] Browser notifications (opt-in, background tabs) and mute settings for servers, channels and DMs (FR-PRES-03/04)
- [x] Full-text search with filters: from, in channel, has attachment/image/file, before/after (FR-SRCH-01/02)
- [x] Also delivered: Settings › Notifications (desktop toggle, blocked users), people search for DMs (`/users/me/contacts`), ADR-025
- Fixed along the way: clients now catch up on the first gateway connect (events between the initial page load and `ready` were lost); the inbox no longer double-counts when a refetch races its event; actions that navigate after a request no longer get lost when their component unmounts
- Not in scope (Could): link previews (FR-MSG-14), threads (FR-MSG-15), email digests (FR-PRES-05)

**Exit criteria:** all FR-MSG/FR-DM/FR-SRCH (M + S) have passing tests and E2E coverage of the mention → notification and DM flows (**met**: 373 backend tests, 97 unit tests, E2E for mentions → inbox, replies/reactions/pins, DMs and blocking, group DMs, search, real Cloudinary attachments, plus axe checks for the new UI; 26/26 on both http://localhost and http://localhost:3000).

## Phase 6: Community features (`v0.7.0`) ✅

- [x] Topics + public servers + discovery page with search and topic filters (FR-SRV-07/08)
- [x] Polls with live results, vote changes, manual close and auto-close (FR-POLL-01…04)
- [x] PDF transcript export via Celery + inbox notification + signed links + 24 h expiry (FR-EXP-01…03, ADR-026)
- [x] Moderation: kick, ban/unban (bans block rejoining), server audit log, message reports to staff (FR-MOD-01…03); staff tools in Django admin for users, servers, reports and the audit log (FR-MOD-04/05)
- [x] Channel permission overwrites UI with a private-channel switch (FR-ROLE-05)
- [x] Account deletion + personal data export (FR-AUTH-09, NFR-PRIV-02)
- Fixed along the way: a reload during a token refresh could sign you out (rotation leeway, ADR-026); data fetched before the gateway's first `ready` could miss events (full catch-up on every connect); role names in server settings failed colour contrast
- Pre-launch audit (v0.7.1): a requirement-by-requirement check found and closed these gaps: Content-Security-Policy (NFR-SEC-07, ADR-027), light and system themes (NFR-UX-03), server mute in the UI (FR-PRES-04), icon/description/topic/public when creating a server (FR-SRV-01), category reordering (FR-CH-02), Manage Messages may export (FR-EXP-01), the 50-message page in ≤ 5 queries (NFR-PERF-05), request IDs carried into WebSockets and Celery (NFR-OBS-01). Also covered now: 360 px mobile flows (NFR-UX-01)
- Not in scope (Could): server reordering (FR-SRV-10), slow mode (FR-CH-05)

**Exit criteria:** feature parity with the legacy app (topics, rooms → servers/channels, messages, participants → members, activity feed → inbox, profiles, polls, PDF export, login audit) plus all M/S requirements implemented (**met**: 401 backend tests, 100 unit tests, 34/34 E2E on both http://localhost and http://localhost:3000, with axe checks for the new UI).

## Phase 7: Hardening, deployment & launch (`v1.0.0`)

**Deployment (last step, needs the VPS):**

- [ ] **Owner:** buy the VPS. Domain + DNS (A/AAAA, SPF/DKIM/DMARC for mail)
- [ ] **Owner:** production email provider (`EMAIL_URL`), backup bucket + age key pair, uptime monitor + heartbeat URLs
- [ ] **Owner:** Sentry projects: `SENTRY_DSN` (server `.env`) + `NEXT_PUBLIC_SENTRY_DSN` (GitHub variable)
- [ ] Provision the server (DEPLOYMENT.md §2), set the GitHub `production` environment, first deploy
- [ ] Restore drill on the real server. HTTPS grade A (SSL Labs). A merge to `main` deploys in < 10 min with no manual steps. Errors reach Sentry

**Hardening:**

- [ ] Security review: OWASP ASVS L1 checklist, CSP tightened, dependency audit clean, `manage.py check --deploy` clean
- [ ] Accessibility audit (axe + manual keyboard/screen reader pass) (NFR-UX-02)
- [ ] Performance: load test (k6/Locust) at 2× expected load, Lighthouse ≥ 90 performance/accessibility
- [ ] Coverage targets met (NFR-MNT-01)
- [ ] Docs complete: user guide, operations runbooks, incident checklist
- [x] Delete `legacy/` (ADR-018): done in v0.7.0, at feature parity
- [ ] Tag `v1.0.0`, GitHub Release

**Exit criteria:** every M and S requirement is met. Restore drill performed within the last 30 days. Zero open high/critical security findings.

---

## Scheduled maintenance

| When | Item |
|---|---|
| After 2026-10-28 | Upgrade Node.js 24 → **26 LTS** (Dockerfiles, `.nvmrc`, CI matrix) |
| Monthly | Merge Dependabot updates. Check Postgres/Redis minor releases |
| Quarterly | Backup restore drill. Review the open questions in REQUIREMENTS §7 |
| ~May 2027 | Upgrade Django 6.1 → **6.2 LTS** (ADR-002) |
| By 2027 | Re-evaluate Python 3.15 support across dependencies |
| Before Nov 2030 | Upgrade PostgreSQL 18 → next major |

## Post-v1.0 backlog (could-haves)

Social login · TOTP 2FA · threads · link previews · slow mode · custom status · email digests · server folders/reordering · custom emoji · announcement channels · voice channels (WebRTC/LiveKit) · PWA / mobile push.
