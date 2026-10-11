# Roadmap

Delivery is split into phases. Each phase ends in a **deployable, tested increment** with a version tag. A phase is done only when its **exit criteria** are met. Requirement IDs refer to [REQUIREMENTS.md](REQUIREMENTS.md).

Status: ⬜ not started · 🟨 in progress · ✅ done

| Phase | Name | Version | Status |
|---|---|---|---|
| 0 | Foundations | v0.1.0 | ✅ |
| 1 | Accounts & profiles | v0.2.0 | ✅ |
| 2 | Production pipeline (built & rehearsed locally) | v0.3.0 | ✅ |
| 3 | Servers, channels & messages | v0.4.0 | ✅ |
| 4 | Real-time | v0.5.0 | ⬜ |
| 5 | Rich messaging & DMs | v0.6.0 | ⬜ |
| 6 | Community features | v0.7.0 | ⬜ |
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
- Deferred by design: live updates (Phase 4; polling stands in), kick/ban (Phase 6), discovery page (Phase 6)

**Exit criteria:** two users can create/join a server via invite, create channels and exchange messages (on refresh). Permission tests cover the overwrite/hierarchy matrix.

## Phase 4: Real-time (`v0.5.0`)

**Goal:** everything updates live.

- [ ] Realtime consumer: subscribe/unsubscribe, groups, rate limits, close codes ([API.md](API.md#3-websocket-protocol))
- [ ] Event publishing from services (`on_commit`) for messages, channels, members, roles, server
- [ ] Typing indicators, presence (Redis TTL), status selection (FR-MSG-06, FR-PRES-01, FR-PROF-04)
- [ ] Read states, unread badges, mention counts, cross-tab sync (FR-CH-04)
- [ ] Frontend `RealtimeClient`: reconnect/backoff, reauth, backfill, cache patching, optimistic send reconciliation (FR-MSG-02, 11, 12)
- [ ] Permission-change handling (remove from groups, `server.removed`)
- [ ] E2E: two browser contexts see each other's messages, typing and presence live

**Exit criteria:** fan-out p95 < 500 ms locally under a 100-connection load script. Killing the `api` container mid-session → clients reconnect and backfill with no lost or duplicated messages.

## Phase 5: Rich messaging & DMs (`v0.6.0`)

- [ ] Replies, mentions (@user/@role/@everyone) + notifications inbox (FR-MSG-07/08, FR-PRES-02)
- [ ] Reactions (FR-MSG-09)
- [ ] Attachments via Cloudinary with image previews/lightbox (FR-MSG-10)
- [ ] Pins (FR-MSG-13)
- [ ] 1:1 DMs, group DMs, blocking (FR-DM-01…04)
- [ ] Browser notifications, mute settings (FR-PRES-03/04)
- [ ] Full-text search with filters (FR-SRCH-01/02)

**Exit criteria:** all FR-MSG/FR-DM/FR-SRCH (M + S) have passing tests and E2E coverage of the mention → notification and DM flows.

## Phase 6: Community features (`v0.7.0`)

- [ ] Topics + public servers + discovery page (FR-SRV-07/08)
- [ ] Polls with live results and auto-close (FR-POLL-01…04)
- [ ] PDF transcript export via Celery + notification + expiry (FR-EXP-01…03)
- [ ] Moderation: kick, ban/unban, server audit log, message reports (FR-MOD-01…03)
- [ ] Channel permission overwrites UI (private channels) (FR-ROLE-05)
- [ ] Account deletion + personal data export (FR-AUTH-09, NFR-PRIV-02)

**Exit criteria:** feature parity with the legacy app plus all M/S requirements implemented.

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
- [ ] Delete `legacy/` (ADR-018)
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
