# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Phase 1: accounts & profiles**
  - Email + password registration, email verification (with resend), login/logout, httpOnly cookie JWTs with rotating refresh tokens and reuse detection, CSRF protection, password reset and change, email change with confirmation, and a notice to the old address.
  - Per-IP and per-account throttling on auth endpoints. Auth audit log (API and Django admin logins) with a read-only admin view and 90-day retention.
  - Profiles: display name, username, bio, status. Avatar upload with in-browser cropping, uploaded straight to Cloudinary through signed parameters. Public profile endpoint.
  - Transactional emails (HTML + text) sent by Celery. Nightly cleanup of unverified accounts, audit entries, expired tokens and orphaned uploads.
  - WebSocket cookie authentication and the authenticated `/ws/` gateway.
  - Frontend: sign-in, registration, verification, password reset, app shell, profile and account settings, route gating through `proxy.ts`, silent token refresh.
  - E2E suite for every account flow, including real Cloudinary uploads and axe (WCAG 2.2 AA) accessibility checks.

- **Phase 0 foundations**
  - Monorepo layout: `backend/`, `frontend/`, `infra/`. The original app moved to `legacy/`.
  - Backend: Python 3.14, Django 6.1.2, DRF, Channels, Celery, uv. Settings split (`base/dev/test/prod`), JSON logging with request IDs, Argon2, standard API error envelope, cursor/page pagination, custom `accounts.User` (UUIDv7, email login), health endpoints (`/api/health/live`, `/api/health/ready`), `/api/v1/meta`, OpenAPI schema + Swagger UI, a WebSocket ping consumer and a Celery ping task.
  - Frontend: Next.js 16.4.0, React 19.3, Tailwind CSS 4, shadcn/ui (Radix), TanStack Query, typed API client generated from OpenAPI, landing page with live API/WebSocket status, Vitest and Playwright.
  - Docker: multi-stage dev/prod images (non-root), Compose stack (Caddy, web, api, worker, beat, Postgres 18.6, Redis 8.10, Mailpit), Makefile shortcuts.
  - CI: backend lint/types/tests/schema-drift/audit, frontend lint/types/tests/build/audit, production image builds, Compose + Playwright E2E, gitleaks. Dependabot and pre-commit configuration.
- Project documentation for the rewrite to Django REST Framework + Next.js: README, requirements, architecture, data model, API & WebSocket protocol, architecture decision records, roadmap, development and deployment guides, contributing guide and security policy.

### Changed

- Brand colours adjusted for WCAG AA contrast: buttons use `#4e5ad8`, and text accents use a new `brand` token.
- Development email defaults to Mailpit unless `EMAIL_URL` is set in `.env`.

- Celery beat uses a static schedule instead of `django-celery-beat`, which doesn't support Django 6.1 yet (ADR-021).
- Email is configured through Django 6.1's `MAILERS` setting, built from `EMAIL_URL`. The `EMAIL_*` settings are deprecated.

### Fixed

- CI on `main`: restored `djangorestframework-stubs` 3.18 after a Dependabot mypy bump downgraded it to 1.4.0, whose mypy plugin crashes.
- The dev `web` service has a health check, so `docker compose up --wait` succeeds (E2E in CI).

## [0.0.0] - 2022

### Added

- Original "StudyBuddy" Django/Jinja application: topics, rooms, messages, participants, activity feed, user profiles, a polls app, rooms PDF export and login/logout audit signals. This code moves to `legacy/` in Phase 0 of the rewrite.

[Unreleased]: https://github.com/George-Kibe/django-discord-clone/compare/609ef7e...HEAD
