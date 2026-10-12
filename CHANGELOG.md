# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.0] - 2026-10-12

Phase 4: real-time.

### Added

- Live gateway (`/ws/`): messages (create/edit/delete), typing indicators, presence and status, read states, and server/channel/category/role/member changes arrive without reloading. Subscriptions are automatic and follow permission changes, so private channels never leak (ADR-024).
- Presence: online/idle/do-not-disturb/offline dots, an Offline group in the member list, and a status picker in the account menu (invisible shows as offline). It works across multiple tabs and survives crashed tabs (Redis TTL plus a Celery sweep).
- Unread state: bold channels with a marker, unread servers in the rail, and mention-count badges. Channels are marked read automatically while you're at the bottom of a visible tab. `POST /channels/{id}/ack` and `GET /read-states`. Members carry `presence`.
- Robust client: reconnects with jittered backoff, handles token expiry and rate-limit close codes, backfills missed messages after a reconnect, and shows a "Reconnecting…" banner.
- Open sockets close on password change/reset and logout.
- `manage.py realtime_loadtest`: fan-out latency with N connections (100 connections: p95 46 ms).
- E2E coverage for live chat, typing, presence, unread state, dropped connections and an API restart mid-session.

### Changed

- Polling for new messages and member lists is gone. Everything is driven by gateway events.

### Fixed

- Development email: sign-up, resend and reset emails to real addresses are delivered through the SMTP/Gmail account in `.env` (`EMAIL_URL`, or `SENDER_EMAIL` + `EMAIL_PASSWORD`). Test-domain recipients are still captured by Mailpit. Previously everything went to Mailpit.
- WebSocket consumers no longer crash when idle: redis-py 8's default 5 s socket timeout raced the channel layer's 5 s blocking read.

## [0.4.0] - 2026-10-11

Phase 3: servers, channels & messages.

### Added

- Servers: create (default `@everyone`/Moderator/Admin roles, a category and `#general`), settings (name, description, icon, topic, public), ownership transfer, leave, join public servers, delete.
- Roles & permissions: Discord-style bitfield engine (admin bypass, overwrite precedence, `VIEW_CHANNEL` gate) with exhaustive matrix tests. Role hierarchy and "can't grant what you don't have" rules, role CRUD/reorder, member role assignment and nicknames.
- Invites: expiring, use-limited links with public preview, accept and revoke.
- Channels: categories and text channels (create, rename, topic, reorder, move, delete), per-member visibility, channel permission overwrites (API).
- Messages: send with nonce idempotency, cursor history (`before`/`after`), edit own, delete own or with Manage Messages, safe Markdown rendering. Verified email required to post.
- UI: Discord-style layout (server rail, channel sidebar, virtualised chat with infinite scroll, member list with profile cards incl. mutual servers), create/join server dialog, invite landing page, server settings (overview, roles, members, invites, ownership), mobile drawers.
- `GET /permissions`, generated frontend permission constants (CI drift check), and a window throttle supporting rates like `10/10s`.

### Fixed

- A message sent without a nonce crashed the API (caught by tests).
- A newly created role's editor could discard typed changes.
- An optimistic message's row remounted on confirmation (lost hover and focus).
- Dead `/settings` link. WCAG 2.2 target sizes for small sidebar buttons.

## [0.3.0] - 2026-10-11

Phase 2: production pipeline, built and rehearsed locally (the real deployment is the final phase).

### Added

- Development: frontend on http://localhost:3000 and backend on http://localhost:8000, in addition to Caddy on http://localhost. Next.js dev rewrites proxy `/api`, `/ws`, `/admin` and `/static`, so :3000 is a complete app (cookies, CSRF and WebSockets included).
- **Production pipeline**
  - `compose.prod.yaml` (HTTPS via Caddy, HSTS, HTTP/3, resource limits, tuned Postgres/Redis) and a production `.env` template.
  - `build.yml` (GHCR images with a Trivy gate), `deploy.yml` (SSH deploy, manual rollback by tag), and `infra/scripts/deploy.sh` with health-gated automatic rollback.
  - Encrypted nightly PostgreSQL backups (age public key + rclone to any S3) with retention, a heartbeat and a restore script.
  - `infra/scripts/rehearse-production.sh`: an end-to-end production rehearsal, also run in CI on infra changes.
  - `infra/scripts/host-health.sh`: disk, memory and unhealthy-container alerts for cron.
  - Sentry error tracking for Django, Celery and Next.js (server + browser, ad-block-safe `/monitoring` tunnel, optional source-map upload). No cookies, headers, bodies, query strings, user info or local variables are sent. Disabled until a DSN is set.

### Changed

- Roadmap: the real VPS deployment moves to the final phase (Phase 7). Phase 2 is complete as a locally rehearsed pipeline.

### Fixed

- Production images no longer ship pip (api), npm/corepack (web) or gosu (backup), which removes HIGH CVEs in their vendored dependencies.
- The `beat` container has its own health check (it inherited the API's, which always failed).
- Backup restores run as the invoking user, so a `0600` age key file is readable.

## [0.2.0] - 2026-10-11

Phase 1: accounts & profiles.

### Added

- Email + password registration, email verification (with resend), login/logout, httpOnly cookie JWTs with rotating refresh tokens and reuse detection, CSRF protection, password reset and change, email change with confirmation, and a notice to the old address.
- Per-IP and per-account throttling on auth endpoints. Auth audit log (API and Django admin logins) with a read-only admin view and 90-day retention.
- Profiles: display name, username, bio, status. Avatar upload with in-browser cropping, uploaded straight to Cloudinary through signed parameters. Public profile endpoint.
- Transactional emails (HTML + text) sent by Celery. Nightly cleanup of unverified accounts, audit entries, expired tokens and orphaned uploads.
- WebSocket cookie authentication and the authenticated `/ws/` gateway.
- Frontend: sign-in, registration, verification, password reset, app shell, profile and account settings, route gating through `proxy.ts`, silent token refresh.
- E2E suite for every account flow, including real Cloudinary uploads and axe (WCAG 2.2 AA) accessibility checks.

### Changed

- Brand colours adjusted for WCAG AA contrast: buttons use `#4e5ad8`, and text accents use a new `brand` token.
- Development email defaults to Mailpit unless `EMAIL_URL` is set in `.env`.

### Fixed

- CI on `main`: restored `djangorestframework-stubs` 3.18 after a Dependabot mypy bump downgraded it to 1.4.0, whose mypy plugin crashes.
- The dev `web` service has a health check, so `docker compose up --wait` succeeds (E2E in CI).

## [0.1.0] - 2026-10-11

Phase 0: foundations.

### Added

- Monorepo layout: `backend/`, `frontend/`, `infra/`. The original app moved to `legacy/`.
- Backend: Python 3.14, Django 6.1.2, DRF, Channels, Celery, uv. Settings split (`base/dev/test/prod`), JSON logging with request IDs, Argon2, standard API error envelope, cursor/page pagination, custom `accounts.User` (UUIDv7, email login), health endpoints (`/api/health/live`, `/api/health/ready`), `/api/v1/meta`, OpenAPI schema + Swagger UI, a WebSocket ping consumer and a Celery ping task.
- Frontend: Next.js 16.4.0, React 19.3, Tailwind CSS 4, shadcn/ui (Radix), TanStack Query, typed API client generated from OpenAPI, landing page with live API/WebSocket status, Vitest and Playwright.
- Docker: multi-stage dev/prod images (non-root), Compose stack (Caddy, web, api, worker, beat, Postgres 18.6, Redis 8.10, Mailpit), Makefile shortcuts.
- CI: backend lint/types/tests/schema-drift/audit, frontend lint/types/tests/build/audit, production image builds, Compose + Playwright E2E, gitleaks. Dependabot and pre-commit configuration.
- Project documentation for the rewrite to Django REST Framework + Next.js: README, requirements, architecture, data model, API & WebSocket protocol, architecture decision records, roadmap, development and deployment guides, contributing guide and security policy.

### Changed

- Celery beat uses a static schedule instead of `django-celery-beat`, which doesn't support Django 6.1 yet (ADR-021).
- Email is configured through Django 6.1's `MAILERS` setting, built from `EMAIL_URL`. The `EMAIL_*` settings are deprecated.

## [0.0.0] - 2022

### Added

- Original "StudyBuddy" Django/Jinja application: topics, rooms, messages, participants, activity feed, user profiles, a polls app, rooms PDF export and login/logout audit signals. This code moves to `legacy/` in Phase 0 of the rewrite.

[Unreleased]: https://github.com/George-Kibe/django-discord-clone/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/George-Kibe/django-discord-clone/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/George-Kibe/django-discord-clone/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/George-Kibe/django-discord-clone/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/George-Kibe/django-discord-clone/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/George-Kibe/django-discord-clone/releases/tag/v0.1.0
