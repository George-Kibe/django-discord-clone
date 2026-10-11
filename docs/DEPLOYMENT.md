# Deployment & Operations

Production runs on **one VPS** with Docker Compose. Images are built by GitHub Actions and pulled from GHCR (ADR-013).

---

## 1. Production topology

```
Internet ─▶ :80/:443 caddy ─▶ web (Next.js, :3000)
                          └─▶ api (Uvicorn, :8000) ─▶ db (Postgres 18) · redis (Redis 8)
                               worker, beat (Celery) ─┘
                               backup (cron: pg_dump → S3-compatible storage)
```

- Only Caddy publishes ports. Everything else sits on an internal Docker network.
- Persistent volumes: `pgdata`, `redisdata`, `caddy_data` (certificates), `caddy_config`.
- Host layout: `/srv/app/` holds `compose.yaml`, `compose.prod.yaml`, `.env`, `infra/Caddyfile`.

## 2. Server provisioning (one-time)

Target: Ubuntu 24.04 LTS (or Debian 13), 2 vCPU / 4 GB RAM / 40 GB+ SSD.

1. **DNS:** `A`/`AAAA` records for `DOMAIN` → VPS IP.
2. **Users & SSH**
   ```bash
   adduser deploy && usermod -aG docker deploy      # after the Docker install
   # copy your key + the CI deploy key into /home/deploy/.ssh/authorized_keys
   # /etc/ssh/sshd_config: PasswordAuthentication no, PermitRootLogin no
   ```
3. **Firewall & hardening:** `ufw allow OpenSSH && ufw allow 80,443/tcp && ufw enable`; install `fail2ban` and `unattended-upgrades`.
4. **Docker:** install Docker Engine + the Compose plugin from Docker's official apt repo. Set the default log driver to `local` with rotation in `/etc/docker/daemon.json`:
   ```json
   { "log-driver": "local", "log-opts": { "max-size": "20m", "max-file": "5" } }
   ```
5. **Swap:** add 2 GB swap (protects against OOM during deploys).
6. **App directory:** `mkdir -p /srv/app && chown deploy: /srv/app`. Create `/srv/app/.env` (mode `600`) from `.env.example` with production values (see §5).
7. **GHCR access:** `docker login ghcr.io` as `deploy`, using a fine-grained token with `read:packages` (or make the packages public).
8. **First deploy:** run the deploy workflow manually (`workflow_dispatch`), then `docker compose exec api python manage.py createsuperuser`.

## 3. CI/CD pipelines (GitHub Actions)

| Workflow | Trigger | Jobs |
|---|---|---|
| `ci.yml` | PRs, pushes to `main` | **backend:** `uv sync --locked` → Ruff → mypy → `makemigrations --check` → pytest + coverage (Postgres 18 + Redis services) · **frontend:** `pnpm install --frozen-lockfile` → ESLint → Prettier check → `tsc` → Vitest → `next build` · **contract:** schema + types drift check · **security:** gitleaks, `pip-audit`, `pnpm audit --prod` |
| `e2e.yml` | PRs to `main` (labelled `e2e`), pushes to `main` | Build the dev stack with Compose → Playwright → upload the report/traces as artifacts |
| `build.yml` | Push to `main`, tags `v*` | Build the `api` and `web` prod images (Buildx, GHA cache) → Trivy scan (fail on HIGH/CRITICAL with a fix available) → push `ghcr.io/george-kibe/discord-clone-{api,web}:{sha,vX.Y.Z,main}` |
| `deploy.yml` | `build.yml` succeeds on `main` / tag; `workflow_dispatch` | Environment `production` → SSH to the VPS → deploy script (below) → smoke test → notify |
| Dependabot | weekly | `uv`, `npm` (pnpm), `docker`, `github-actions` ecosystems |

Path filters skip backend jobs for frontend-only changes, and the other way round.

### Required GitHub secrets / variables (`production` environment)

| Name | Type | Purpose |
|---|---|---|
| `DEPLOY_HOST` | variable | VPS hostname/IP |
| `DEPLOY_USER` | variable | `deploy` |
| `DEPLOY_SSH_KEY` | secret | Private key (ed25519) whose public key is in `authorized_keys` |
| `DEPLOY_KNOWN_HOSTS` | secret | Pinned host key (no `StrictHostKeyChecking=no`) |
| `SENTRY_AUTH_TOKEN` | secret | Upload source maps / create releases |

Application secrets (Django secret key, DB password, Cloudinary, SMTP) stay **only** in `/srv/app/.env` on the server, never in GitHub.

### Deploy script (run on the VPS by `deploy.yml`)

```bash
set -euo pipefail
cd /srv/app
export IMAGE_TAG=<git-sha>                 # passed in by the workflow
PREV_TAG=$(cat .current_tag 2>/dev/null || echo "")
docker compose -f compose.yaml -f compose.prod.yaml pull
docker compose -f compose.yaml -f compose.prod.yaml run --rm api python manage.py migrate --noinput
docker compose -f compose.yaml -f compose.prod.yaml up -d --remove-orphans
# wait for health (≤ 60 s), else roll back to PREV_TAG
./infra/scripts/wait-healthy.sh || { IMAGE_TAG=$PREV_TAG docker compose ... up -d; exit 1; }
echo "$IMAGE_TAG" > .current_tag
docker image prune -f --filter "until=168h"
```

- Static files are collected at **image build** time, not at deploy.
- Migrations must be backwards-compatible with the previous image (see DEVELOPMENT.md), so the rollback never needs a schema rollback.
- Smoke test: `curl -fsS https://$DOMAIN/api/health/ready` and `curl -fsS https://$DOMAIN/`.

## 4. Production images

| Image | Base | Notes |
|---|---|---|
| `api` | `python:3.14-slim-trixie` | Multi-stage: `uv sync --locked --no-dev` in the builder → copy the venv. Non-root `app` user. `collectstatic` at build. Entrypoint picks `api` / `worker` / `beat` by command. `HEALTHCHECK` hits `/api/health/live`. |
| `web` | `node:24-trixie-slim` (→ 26 after LTS) | `next build` with `output: "standalone"`. Runs `node server.js` as non-root `node`. `NEXT_TELEMETRY_DISABLED=1`. |
| `caddy` | `caddy:2` | Caddyfile mounted from `infra/`. |
| `db` | `postgres:18` (pinned minor) | Tuned via the `command:` args (`shared_buffers=512MB`, etc.). |
| `redis` | `redis:8.x` (pinned minor) | `--appendonly yes --maxmemory 256mb --maxmemory-policy noeviction` (noeviction protects the Celery queue). |
| `backup` | small Alpine image with `postgresql18-client` + `rclone`/`aws-cli` | Cron at 03:00 UTC. |

### Resource limits (initial, 4 GB host)

| Service | Memory limit |
|---|---|
| db | 1 GB |
| api (2 workers) | 768 MB |
| web | 512 MB |
| worker | 512 MB |
| redis | 320 MB |
| beat, caddy, backup | 128 MB each |

## 5. Production environment

Differences from development (see the full table in [DEVELOPMENT.md](DEVELOPMENT.md#environment-variables)):

- `ENVIRONMENT=production`, `DJANGO_SETTINGS_MODULE=config.settings.prod`, `DJANGO_DEBUG=false`
- Strong unique values for `DJANGO_SECRET_KEY` and `POSTGRES_PASSWORD` (`openssl rand -base64 48`)
- `DJANGO_ALLOWED_HOSTS=<domain>,api`, `DJANGO_CSRF_TRUSTED_ORIGINS=https://<domain>`
- `CLOUDINARY_FOLDER_PREFIX=prod`, the real `EMAIL_URL`, `SENTRY_DSN`
- Backup settings: `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY`, `BACKUP_S3_SECRET_KEY`, `BACKUP_ENCRYPTION_PASSPHRASE`

`config.settings.prod` enforces: `SECURE_SSL_REDIRECT`, `SECURE_HSTS_SECONDS` (start at 1 day, raise to 1 year), secure cookies, `SECURE_PROXY_SSL_HEADER` (trusting Caddy), and `manage.py check --deploy` passing at startup.

## 6. Backups & restore

- **What:** a nightly `pg_dump --format=custom`, encrypted with `age`/`gpg`, uploaded to off-site S3-compatible storage. Redis is not backed up (ephemeral). Media is already in Cloudinary.
- **Retention:** 7 daily, 4 weekly, 3 monthly (bucket lifecycle rules plus naming).
- **Monitoring:** the backup job pings a heartbeat URL (e.g. healthchecks.io) on success, so a missing ping raises an alert.

### Restore runbook

```bash
# 1. fetch + decrypt the dump
rclone copy remote:bucket/daily/app-YYYYMMDD.dump.age . && age -d -o app.dump app-YYYYMMDD.dump.age
# 2. stop writers
docker compose -f compose.yaml -f compose.prod.yaml stop api worker beat web
# 3. restore
docker compose ... exec -T db pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists < app.dump
# 4. start + verify
docker compose ... up -d && curl -fsS https://$DOMAIN/api/health/ready
```

**Drill:** quarterly, restore into a scratch database (`docker run postgres:18`) and run sanity queries. Record the date in the ops log.

## 7. Monitoring & alerting

| What | How | Alert to |
|---|---|---|
| Uptime (`/api/health/ready`, `/`) | External monitor, 1-min interval | Email |
| Application errors | Sentry (backend, Celery, Next.js) | Email (new issues, spikes) |
| Backup success | Heartbeat ping | Email on a missed ping |
| Disk > 80 %, memory pressure | Small cron script on the host → heartbeat/email | Email |
| TLS expiry | Caddy auto-renews. The uptime monitor checks certificate expiry | Email |

## 8. Routine operations

| Task | Command |
|---|---|
| View logs | `docker compose -f compose.yaml -f compose.prod.yaml logs -f --tail=200 api` |
| Django shell | `… exec api python manage.py shell` |
| Manual rollback | Re-run `deploy.yml` with `workflow_dispatch` and an older image tag |
| Rotate the secret key | Update `.env` → `up -d` (logs everyone out) |
| Postgres minor upgrade | Bump the pinned tag → deploy (volume compatible) |
| Postgres major upgrade | `pg_dump` → new volume on the new major → `pg_restore` (planned maintenance) |
| Scale workers | Change `CELERY_CONCURRENCY` / `UVICORN_WORKERS` in `.env` → `up -d` |

## 9. Incident checklist

1. Check the uptime monitor and Sentry for scope and timing.
2. `docker compose ps` for unhealthy containers, and `logs` for errors.
3. If a recent deploy is the likely cause, **roll back first**, investigate after.
4. Check host resources: `df -h`, `free -m`, `docker stats`.
5. Data issue → stop writers, take an ad-hoc `pg_dump`, then fix.
6. Write a short post-incident note (what, impact, root cause, follow-ups) in `docs/incidents/`.
