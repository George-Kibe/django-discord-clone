# Django Discord Clone

A real-time chat platform in the style of Discord: servers, channels, roles, direct messages, presence, reactions, polls and more. It has a **Django REST Framework + Django Channels** backend and a **Next.js + Tailwind CSS** frontend, and it runs in Docker for both development and production.

> **Status:** rewrite in progress. The original Django/Jinja app ("StudyBuddy") is kept in [`legacy/`](legacy/) for reference until the new stack reaches feature parity. See [docs/ROADMAP.md](docs/ROADMAP.md) for the current phase.

---

## Features (target v1.0)

- **Accounts:** email + password sign-up, email verification, password reset, profiles with avatars
- **Servers:** create/join servers, invite links, topics, public discovery
- **Channels:** text channels grouped into categories, with per-channel permission overwrites
- **Roles & permissions:** Discord-style permission bitfields, owner/admin/moderator/member defaults
- **Real-time messaging:** live message delivery, edits, deletes, typing indicators, presence, unread badges
- **Rich messages:** replies, @mentions, reactions, image/file attachments (Cloudinary)
- **Direct messages:** 1:1 and small group DMs
- **Polls:** in-channel polls with live results
- **Search:** full-text message search (PostgreSQL)
- **Exports:** PDF channel transcripts, generated in the background
- **Security:** login audit log, rate limiting, moderation tools (kick/ban, message removal)

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16.4 (App Router, React 19), TypeScript, Tailwind CSS 4, TanStack Query |
| Backend API | Python 3.14, Django 6.1.2, Django REST Framework, SimpleJWT, drf-spectacular |
| Real-time | Django Channels (ASGI, served by Uvicorn), Redis channel layer |
| Background jobs | Celery workers + Celery beat, Redis broker |
| Database | PostgreSQL 18 |
| Cache / broker | Redis 8 |
| Media | Cloudinary (signed direct uploads) |
| Edge | Caddy (reverse proxy, automatic HTTPS) |
| Infra | Docker + Docker Compose, GitHub Actions, GHCR, single VPS |

Version policy and the reasons behind each choice are in [docs/DECISIONS.md](docs/DECISIONS.md).

## Repository layout

```
.
├── backend/            # Django project (API, WebSockets, Celery tasks)
├── frontend/           # Next.js application
├── infra/              # Caddyfile, backup scripts, deployment helpers
├── docs/               # Project documentation
├── legacy/             # Original Django/Jinja app (read-only, removed at parity)
├── .github/workflows/  # CI/CD pipelines
├── compose.yaml        # Base Docker Compose services
├── compose.override.yaml  # Development overrides (loaded automatically)
└── compose.prod.yaml   # Production overrides
```

## Quick start (development)

Prerequisites: Docker Engine with the Compose plugin, and Git. You don't need Python or Node on the host, though they help with editor tooling.

```bash
git clone https://github.com/George-Kibe/django-discord-clone.git
cd django-discord-clone
cp .env.example .env            # then fill in Cloudinary credentials etc.
docker compose up --build
```

| URL | What |
|---|---|
| http://localhost | App (through Caddy) |
| http://localhost/api/docs/ | OpenAPI / Swagger UI |
| http://localhost/admin/ | Django admin |
| http://localhost:8025 | Mailpit (catches outgoing dev email) |

Common tasks (migrations, tests, shells, seeding) are covered in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Documentation

| Document | Purpose |
|---|---|
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | Functional and non-functional requirements |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, components, data flow |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | Entities, relationships, permissions model |
| [docs/API.md](docs/API.md) | REST conventions and WebSocket event protocol |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Architecture Decision Records (ADRs) |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phases, milestones, exit criteria |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Local setup, workflows, testing, env vars |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Production setup, CI/CD, backups, runbooks |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Branching, commits, PR process, code style |
| [SECURITY.md](SECURITY.md) | Security policy and vulnerability reporting |
| [CHANGELOG.md](CHANGELOG.md) | Release history |

## License

[MIT](LICENSE) © George Kibe
