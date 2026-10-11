# Development Guide

Everything runs in Docker. Host installs of Python/Node are optional and only useful for editor tooling (IntelliSense, type checking in the IDE).

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Docker Engine + Compose plugin | current stable | Docker Desktop also works on macOS/Windows |
| Git | any recent | |
| *(optional)* uv | latest | `uv sync` in `backend/` for editor tooling |
| *(optional)* Node.js | 24 LTS (`.nvmrc`) | plus pnpm 12 (`npm i -g pnpm@12.11.2`). Needed on the host only for `make e2e` and editor tooling |
| *(optional)* make | | shortcuts below |

## First run

```bash
git clone https://github.com/George-Kibe/django-discord-clone.git
cd django-discord-clone
make up                       # creates .env from .env.example, builds and starts the stack
make createsuperuser          # admin account for /admin/
```

In development the `api` container applies migrations automatically on start. Fill in `CLOUDINARY_URL` in `.env` once you have the credentials. Nothing in Phase 0 needs it. Without `make`, use `cp .env.example .env && docker compose up -d --build`.

Open http://localhost.

| URL | Service |
|---|---|
| http://localhost | Next.js app (through Caddy) |
| http://localhost/api/docs/ | Swagger UI |
| http://localhost/admin/ | Django admin |
| http://localhost:8025 | Mailpit (all outgoing email lands here) |
| localhost:5432 | Postgres (published in dev only) |

## Services (development)

| Service | Image / build | Purpose | Hot reload |
|---|---|---|---|
| `caddy` | `caddy:2` | Single-origin proxy on :80 | config reload |
| `web` | `frontend/Dockerfile` (target `dev`) | `next dev` (Turbopack) | ✅ bind mount |
| `api` | `backend/Dockerfile` (target `dev`) | `uvicorn --reload` | ✅ bind mount |
| `worker` | same as api | `celery worker` (auto-restart on change via `watchfiles`) | ✅ |
| `beat` | same as api | `celery beat` | restart |
| `db` | `postgres:18` | Database | — |
| `redis` | `redis:8` | Cache, channel layer, broker | — |
| `mailpit` | `axllent/mailpit` | SMTP sink + web UI | — |

The Python virtualenv lives at `/opt/venv` inside the image, and `node_modules` and `.next` live in named volumes, so host files never clash with them. Containers run as uid 1000. If your host user has a different uid, set `HOST_UID`/`HOST_GID` in `.env` and rebuild.

After adding a frontend dependency inside the container, the `web_node_modules` volume already has it. After pulling someone else's dependency change, run `docker compose exec web pnpm install` (or `docker compose down && docker volume rm <project>_web_node_modules && make up`).

## Everyday commands

Make targets wrap the long `docker compose` commands:

| Make | Equivalent | |
|---|---|---|
| `make up` / `make down` | `docker compose up -d` / `down` | Start/stop the stack |
| `make logs s=api` | `docker compose logs -f api` | Tail logs |
| `make migrate` | `… exec api python manage.py migrate` | Apply migrations |
| `make migrations` | `… exec api python manage.py makemigrations` | Create migrations |
| `make shell` | `… exec api python manage.py shell` | Django shell |
| `make dbshell` | `… exec db psql -U $POSTGRES_USER $POSTGRES_DB` | psql |
| `make test` | backend + frontend tests | |
| `make test-be` | `… exec api pytest` | Backend tests |
| `make test-fe` | `… exec web pnpm test` | Frontend unit tests |
| `make e2e` | `pnpm --dir frontend exec playwright test` | E2E against the running stack |
| `make lint` | Ruff, mypy, ESLint, Prettier check, `tsc` | |
| `make fmt` | Ruff format + fix, Prettier write | |
| `make gen-api` | export the OpenAPI schema → `pnpm gen:api` | Regenerate frontend types |
| `make reset-db` | drop the database volume and recreate it | ⚠ destroys local data |

### Adding dependencies

```bash
# Backend
docker compose exec api uv add <package>          # runtime
docker compose exec api uv add --dev <package>    # dev only
# Frontend
docker compose exec web pnpm add <package>
docker compose exec web pnpm add -D <package>
```

Commit the lockfiles (`backend/uv.lock`, `frontend/pnpm-lock.yaml`). Check that a new Python package supports Django 6.1 before adding it (ADR-002).

## Testing

### Backend

- `pytest` with `pytest-django`, settings `config.settings.test`. It uses a real Postgres + Redis (CI provides them as services).
- Factories live in each app's `tests/factories.py` (factory-boy).
- WebSocket tests use `channels.testing.WebsocketCommunicator` with `pytest-asyncio`.
- Celery tasks run eagerly in tests (`CELERY_TASK_ALWAYS_EAGER=True`). Cloudinary and email are mocked.
- Use `django_assert_max_num_queries` on list endpoints (NFR-PERF-04).
- Deprecation warnings are errors (`-W error::DeprecationWarning`) to keep the Django 6.2 upgrade easy.
- Coverage: `pytest --cov` (CI enforces ≥ 85 %).

### Frontend

- **Vitest** + Testing Library for components and hooks. **MSW** mocks the API, and a mock WebSocket server tests the realtime client.
- **Playwright** E2E runs against the full Compose stack. It reads verification emails through the Mailpit API. Specs live in `frontend/e2e/`.

## Database & migrations

- Never edit an applied migration. Create a new one.
- Keep migrations backwards-compatible with the previous release (expand → migrate → contract), because migrations run right before the new containers start.
- Data migrations go in separate migration files from schema changes.
- CI runs `makemigrations --check --dry-run` to catch missing migrations.

## API contract workflow

1. Change serializers/views in the backend.
2. `make gen-api` regenerates `backend/schema.yaml` and `frontend/src/types/api.d.ts`.
3. Commit both. CI fails on drift (ADR-017).

## Environment variables

`.env.example` holds every variable with safe development defaults. Production values live only on the server (see [DEPLOYMENT.md](DEPLOYMENT.md)).

| Variable | Example (dev) | Used by | Notes |
|---|---|---|---|
| `ENVIRONMENT` | `development` | all | `development` / `test` / `production` |
| `DOMAIN` | `localhost` | caddy, api, web | Public hostname |
| `DJANGO_SETTINGS_MODULE` | `config.settings.dev` | api, worker, beat | |
| `DJANGO_SECRET_KEY` | `dev-insecure-change-me` | api | **Required** in production (50+ random chars) |
| `DJANGO_DEBUG` | `true` | api | Always `false` in production |
| `DJANGO_ALLOWED_HOSTS` | `localhost,api` | api | |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | `http://localhost` | api | |
| `DATABASE_URL` | `postgres://app:app@db:5432/app` | api, worker, beat | |
| `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | `app` / `app` / `app` | db | |
| `REDIS_URL` | `redis://redis:6379` | api, worker, beat | DB numbers are added in settings (§6 of ARCHITECTURE) |
| `CLOUDINARY_URL` | `cloudinary://<key>:<secret>@<cloud_name>` | api, worker | **Secret.** Ask the project owner |
| `CLOUDINARY_FOLDER_PREFIX` | `dev` | api | Keeps dev/prod assets apart |
| `EMAIL_URL` | `smtp://mailpit:1025` | api, worker | `smtp+tls://user:pass@host:587` in production |
| `DEFAULT_FROM_EMAIL` | `Discord Clone <no-reply@localhost>` | api, worker | |
| `JWT_ACCESS_MINUTES` / `JWT_REFRESH_DAYS` | `15` / `14` | api | |
| `SENTRY_DSN` | *(empty)* | api, worker | Disabled when empty |
| `NEXT_PUBLIC_SENTRY_DSN` | *(empty)* | web | |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost` | web | |
| `INTERNAL_API_URL` | `http://api:8000` | web | Server-side fetches inside the Docker network |
| `LOG_LEVEL` | `INFO` | all | |
| `UVICORN_WORKERS` | `1` | api | `2` in production |
| `CELERY_CONCURRENCY` | `2` | worker | |

> **Never commit `.env`** or paste real credentials into issues, PRs, chat or logs. `.env` is git-ignored and gitleaks runs in pre-commit and CI.

## Editor setup (recommended)

- VS Code extensions: Python, Ruff, Mypy Type Checker, ESLint, Prettier, Tailwind CSS IntelliSense, Docker, EditorConfig.
- Point the Python interpreter at `backend/.venv` (after `uv sync` on the host) or attach to the `api` container.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `web` can't reach the API during SSR | Check `INTERNAL_API_URL=http://api:8000` and that `api` is healthy (`docker compose ps`) |
| WebSocket closes with 4403 | `Origin` isn't in `DJANGO_ALLOWED_HOSTS` / you're browsing a different host than `DOMAIN` |
| CSRF failure on POST | Call `GET /api/v1/auth/csrf` first and send `X-CSRFToken`. Check `DJANGO_CSRF_TRUSTED_ORIGINS` |
| File changes not picked up (macOS/Windows) | Make sure the bind mounts are in place. Set `WATCHPACK_POLLING=true` for `web` |
| Port 80 already in use | Stop the local web server, or change the Caddy port mapping in `compose.override.yaml` |
