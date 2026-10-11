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
   **Cron** (as `deploy`): `*/10 * * * * /srv/app/infra/scripts/host-health.sh >/dev/null 2>&1` (see §7).
6. **App directory:** `mkdir -p /srv/app && chown deploy: /srv/app`. Copy [`infra/env.production.example`](../infra/env.production.example) to `/srv/app/.env` (mode `600`) and fill in real values (see §5).
7. **Backup key pair** (on your own machine, **not** the server): `age-keygen -o discord-clone-backup-key.txt`. Put the printed public key (`age1…`) in `BACKUP_AGE_RECIPIENT`, and store the private key file in your password manager. The server can create backups but can never read them.
8. **GHCR access:** `docker login ghcr.io` as `deploy`, using a fine-grained token with `read:packages` (or make the packages public).
9. **GitHub:** create the `production` environment with the variables and secrets below. Until `DEPLOY_HOST` is set, `deploy.yml` skips itself.
10. **First deploy:** run `deploy.yml` manually (`workflow_dispatch`, tag = the SHA of a green `main` build), then `./infra/scripts/dc exec api python manage.py createsuperuser`.

### Rehearse before the first real deploy

`./infra/scripts/rehearse-production.sh` runs the **same** deploy script against locally built production images, in a copy of the server layout with generated secrets, on `https://localhost:8443`. It checks:

- **Deploy:** first deploy, health checks and smoke tests.
- **HTTPS:** HSTS and security headers, no server banners, Swagger staff-only, `manage.py check --deploy` clean.
- **Auth:** registration and login with `Secure` cookies and CSRF enforced.
- **Backups:** an age-encrypted backup to an S3-compatible server, followed by a restore drill that compares row counts.
- **Rollback:** a deliberately broken release must be rolled back automatically.

CI runs it on every PR that touches Dockerfiles, Compose files or `infra/`. `KEEP=1` leaves the stack running for manual poking. `--down` removes it.

## 3. CI/CD pipelines (GitHub Actions)

| Workflow | Trigger | Jobs |
|---|---|---|
| `ci.yml` | PRs, pushes to `main` | **backend:** `uv sync --locked` → Ruff → mypy → `makemigrations --check` → pytest + coverage (Postgres + Redis services) → schema drift → `pip-audit` · **frontend:** ESLint → Prettier → `tsc` → Vitest → types drift → `next build` → `pnpm audit` · **images:** build the `api`, `web` and `backup` prod targets · **e2e:** Compose stack + Playwright (incl. axe) · **rehearsal:** `rehearse-production.sh` · **secrets:** gitleaks |
| `build.yml` | Push to `main`, tags `v*` | For `api`, `web` and `backup`: build → **Trivy** (fails on fixable HIGH/CRITICAL) → push `ghcr.io/george-kibe/discord-clone-<name>:<full-sha>` plus `main` or the version |
| `deploy.yml` | `build.yml` succeeded on `main`; `workflow_dispatch` (any tag, e.g. to roll back) | Environment `production` → rsync `compose*.yaml` + `infra/{caddy,scripts}` → SSH → `infra/scripts/deploy.sh` |
| Dependabot | weekly | `uv`, `npm`, `docker`, `docker-compose`, `github-actions` |

Path filters skip backend jobs for frontend-only changes, and the other way round.

### Required GitHub secrets / variables (`production` environment)

| Name | Type | Purpose |
|---|---|---|
| `DEPLOY_HOST` | variable | VPS hostname/IP. Leave unset to keep deploys disabled |
| `DEPLOY_USER` | variable | `deploy` |
| `DOMAIN` | variable | Public domain (shown as the environment URL) |
| `DEPLOY_SSH_KEY` | secret | Private key (ed25519) whose public key is in `authorized_keys` |
| `DEPLOY_KNOWN_HOSTS` | secret | Pinned host key (no `StrictHostKeyChecking=no`) |
| `SENTRY_AUTH_TOKEN` | secret | Upload source maps / create releases |

Application secrets (Django secret key, DB password, Cloudinary, SMTP) stay **only** in `/srv/app/.env` on the server, never in GitHub.

### Deploy script: [`infra/scripts/deploy.sh`](../infra/scripts/deploy.sh)

`IMAGE_TAG=<tag> ./infra/scripts/deploy.sh` (on the VPS, in `/srv/app`):

1. Pull the `api`, `web`, `worker`, `beat` and `backup` images for the tag.
2. Make sure `db` and `redis` are up. Run `migrate` with the **new** image.
3. `docker compose up -d --wait`: every container must pass its health check within 3 minutes.
4. Smoke-test `https://$DOMAIN/api/health/ready` and `https://$DOMAIN/`.
5. Record the tag in `.current_tag` and prune images older than a week.

If any step fails, it rolls back to the previous `.current_tag` and exits non-zero (failing the workflow).

- Static files are collected at **image build** time, not at deploy.
- Migrations must be backwards-compatible with the previous image (see DEVELOPMENT.md), so a rollback never needs a schema rollback.
- Run ad-hoc commands through [`infra/scripts/dc`](../infra/scripts/dc), which is `docker compose` with the production files and the deployed tag: `./infra/scripts/dc ps`, `./infra/scripts/dc logs -f api`.

## 4. Production images

| Image | Base | Notes |
|---|---|---|
| `api` | `python:3.14-slim-trixie` | Multi-stage: `uv sync --locked --no-dev` in the builder → copy the venv. Non-root `app` user. `collectstatic` at build. Entrypoint picks `api` / `worker` / `beat` by command. `HEALTHCHECK` hits `/api/health/live`. |
| `web` | `node:24-trixie-slim` (→ 26 after LTS) | `next build` with `output: "standalone"`. Runs `node server.js` as non-root `node`. `NEXT_TELEMETRY_DISABLED=1`. |
| `caddy` | `caddy:2` | Caddyfile mounted from `infra/`. |
| `db` | `postgres:18` (pinned minor) | Tuned via the `command:` args (`shared_buffers=512MB`, etc.). |
| `redis` | `redis:8.x` (pinned minor) | `--appendonly yes --maxmemory 256mb --maxmemory-policy noeviction` (noeviction protects the Celery queue). |
| `backup` | `postgres:18.6` (matching `pg_dump`) + `age` + `rclone` 1.75 | Daily at `BACKUP_TIME_UTC`. Runs as `postgres`. |

All images run as non-root users and drop tooling they don't use at runtime: pip from `api`, npm/corepack from `web`, `gosu` from `backup`. That also removes those tools' vendored dependencies, which Trivy flagged. Images are rebuilt on every deploy, so OS patches flow in through the pinned base tags (Dependabot keeps them current).

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
- `DJANGO_ALLOWED_HOSTS=<domain>,api,localhost` (`api` for server-side rendering, `localhost` for container health checks), `DJANGO_CSRF_TRUSTED_ORIGINS=https://<domain>`
- `CLOUDINARY_FOLDER_PREFIX=prod`, the real `EMAIL_URL`, `SENTRY_DSN`
- Backups: `BACKUP_AGE_RECIPIENT`, `BACKUP_REMOTE` (e.g. `:s3:bucket/discord-clone`), `RCLONE_S3_*` (provider, endpoint, region, keys), optional `BACKUP_HEARTBEAT_URL` and `BACKUP_TIME_UTC`
- HSTS: Caddy sends `HSTS_VALUE` (default 1 day) on frontend responses, and Django sends `DJANGO_SECURE_HSTS_SECONDS` on API responses. Raise both to a year once HTTPS is stable.

The full template is [`infra/env.production.example`](../infra/env.production.example).

`config.settings.prod` enforces: `SECURE_SSL_REDIRECT`, `SECURE_HSTS_SECONDS` (start at 1 day, raise to 1 year), secure cookies, `SECURE_PROXY_SSL_HEADER` (trusting Caddy), and `manage.py check --deploy` passing at startup.

## 6. Backups & restore

- **What:** a nightly `pg_dump --format=custom`, encrypted with **age** to a public key (the private key is never on the server), uploaded with **rclone** to any S3-compatible bucket (Backblaze B2, Cloudflare R2, AWS S3…). Redis is not backed up (ephemeral). Media is already in Cloudinary.
- **Where:** `<remote>/daily/`, plus `weekly/` on Sundays and `monthly/` on the 1st.
- **Retention:** 7 daily, 4 weekly, 3 monthly. Old objects are deleted by the backup job itself, so no bucket lifecycle rules are needed.
- **Monitoring:** after each run the job pings `BACKUP_HEARTBEAT_URL` (e.g. healthchecks.io), or `<url>/fail` on errors, so a missed or failed backup raises an alert.
- **Ad hoc:** `./infra/scripts/dc run --rm backup run-once`.

### Restore runbook

```bash
cd /srv/app
# List what's available
./infra/scripts/dc run --rm backup restore.sh list
# Restore drill: newest backup into a scratch database (safe while the site runs)
./infra/scripts/dc run --rm -v ~/discord-clone-backup-key.txt:/key.txt:ro -e BACKUP_AGE_IDENTITY=/key.txt \
  backup restore.sh latest restore_drill
./infra/scripts/dc exec db psql -U app -d restore_drill -c 'select count(*) from accounts_user'
./infra/scripts/dc exec db dropdb -U app restore_drill

# Real restore into the live database: stop the writers first
./infra/scripts/dc stop api worker beat web
./infra/scripts/dc run --rm -v ~/discord-clone-backup-key.txt:/key.txt:ro -e BACKUP_AGE_IDENTITY=/key.txt \
  backup restore.sh latest            # or daily/app-<timestamp>.dump.age
./infra/scripts/dc up -d --wait && curl -fsS https://$DOMAIN/api/health/ready
rm ~/discord-clone-backup-key.txt     # don't leave the private key on the server
```

**Drill:** quarterly, run the restore drill above and record the date in the ops log. The rehearsal script performs the same drill on every infra change.

## 7. Monitoring & alerting

| What | How | Alert to |
|---|---|---|
| Uptime (`/api/health/ready`, `/`) | External monitor, 1-min interval | Email |
| Application errors | Sentry (backend, Celery, Next.js) | Email (new issues, spikes) |
| Backup success | Heartbeat ping | Email on a missed ping |
| Disk > 80 %, memory > 90 %, unhealthy containers | [`infra/scripts/host-health.sh`](../infra/scripts/host-health.sh) every 10 min from cron → `HOST_HEARTBEAT_URL` (`/fail` on problems) | Email |
| TLS expiry | Caddy auto-renews. The uptime monitor checks certificate expiry | Email |

## 8. Routine operations

| Task | Command |
|---|---|
| View logs | `./infra/scripts/dc logs -f --tail=200 api` |
| Django shell | `./infra/scripts/dc exec api python manage.py shell` |
| Backup now | `./infra/scripts/dc run --rm backup run-once` |
| Manual rollback | Re-run `deploy.yml` with `workflow_dispatch` and an older image tag |
| Rotate the secret key | Update `.env` → `./infra/scripts/dc up -d` (logs everyone out) |
| Postgres minor upgrade | Bump the pinned tag → deploy (volume compatible) |
| Postgres major upgrade | `pg_dump` → new volume on the new major → `pg_restore` (planned maintenance) |
| Scale workers | Change `CELERY_CONCURRENCY` / `UVICORN_WORKERS` in `.env` → `./infra/scripts/dc up -d` |

## 9. Incident checklist

1. Check the uptime monitor and Sentry for scope and timing.
2. `./infra/scripts/dc ps` for unhealthy containers, and `./infra/scripts/dc logs` for errors.
3. If a recent deploy is the likely cause, **roll back first**, investigate after.
4. Check host resources: `df -h`, `free -m`, `docker stats`.
5. Data issue → stop writers, take an ad-hoc `pg_dump`, then fix.
6. Write a short post-incident note (what, impact, root cause, follow-ups) in `docs/incidents/`.
