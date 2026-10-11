# Requirements

This document defines **what** the system must do. Design choices live in [ARCHITECTURE.md](ARCHITECTURE.md) and [DECISIONS.md](DECISIONS.md), and scheduling lives in [ROADMAP.md](ROADMAP.md).

Requirement IDs (`FR-…`, `NFR-…`) are stable. Reference them in issues, PRs and tests.

Priority: **M** = must have for v1.0, **S** = should have for v1.0, **C** = could have (post-v1.0).

---

## 1. Goals and non-goals

### Goals

1. Rebuild the legacy StudyBuddy app as a modern, Discord-style real-time chat platform.
2. Keep a clean split between the API backend (Django REST Framework) and the frontend (Next.js).
3. Be **production-ready** (secure, observable, backed up, deployed by CI/CD) while staying **cheap and simple to run** for a small user base.
4. Use LTS (or the closest supported) versions of all core software.

### Non-goals (v1.0)

- Voice/video channels, screen sharing (WebRTC)
- Native mobile apps (the web app must be responsive instead)
- Horizontal scaling across multiple hosts, multi-region deployment
- Bots / public developer API / webhooks
- End-to-end encryption
- Payments / premium tiers

## 2. Users and roles

| Actor | Description |
|---|---|
| Visitor | Not signed in. Can view the landing page, sign-up/login, and public discovery (read-only). |
| User | Signed-in account. Can create servers, join via invite or discovery, send DMs. |
| Server owner | Created the server. Has every permission and can transfer ownership. |
| Server admin / moderator | Member holding roles with elevated permissions (manage channels, kick, ban, delete messages). |
| Server member | Member with the default `@everyone` role. |
| Staff (site admin) | Django `is_staff` user. Uses Django admin for site-wide moderation and support. |

## 3. Functional requirements

### 3.1 Accounts and authentication

| ID | Requirement | P |
|---|---|---|
| FR-AUTH-01 | Users can register with email, username, display name and password. | M |
| FR-AUTH-02 | Email must be verified via an emailed link before the user can post. Unverified accounts are deleted after 7 days. | M |
| FR-AUTH-03 | Users log in with email + password. The session is kept in httpOnly cookies (access + refresh JWT). | M |
| FR-AUTH-04 | Users can log out, which revokes the refresh token. | M |
| FR-AUTH-05 | Users can request a password reset by email (single-use token, expires in 1 hour). | M |
| FR-AUTH-06 | Users can change their password and email (a changed email must be re-verified). | M |
| FR-AUTH-07 | Login attempts are rate-limited per IP and per account. | M |
| FR-AUTH-08 | Logins, logouts, failed logins (with IP and user agent), password changes and resets are written to an audit log that staff can view. | M |
| FR-AUTH-09 | Users can delete their account. Their messages remain, attributed to "Deleted User". | S |
| FR-AUTH-10 | Social login (Google/GitHub). | C |
| FR-AUTH-11 | TOTP two-factor authentication. | C |

### 3.2 Profiles

| ID | Requirement | P |
|---|---|---|
| FR-PROF-01 | Users have a username (unique), display name, bio and avatar. | M |
| FR-PROF-02 | Users can upload/replace/remove their avatar (image, ≤ 5 MB, cropped square). | M |
| FR-PROF-03 | Users can view other users' profile cards (avatar, display name, bio, mutual servers). | M |
| FR-PROF-04 | Users can set a status: online / idle / do-not-disturb / invisible. | S |
| FR-PROF-05 | Users can set a custom status text. | C |

### 3.3 Servers

| ID | Requirement | P |
|---|---|---|
| FR-SRV-01 | Users can create a server with a name, an optional icon, description and topic. | M |
| FR-SRV-02 | Creating a server sets up an `@everyone` role and a default `#general` text channel. | M |
| FR-SRV-03 | Owners and admins can edit server settings and delete the server (owner only). | M |
| FR-SRV-04 | Members can create invite links with optional expiry and max uses. Invites can be revoked. | M |
| FR-SRV-05 | Users join a server by invite link, or directly if the server is public. | M |
| FR-SRV-06 | Members can leave a server (the owner must transfer ownership first). | M |
| FR-SRV-07 | Servers can be tagged with a topic and marked public. | M |
| FR-SRV-08 | A discovery page lists public servers, searchable by name/description and filterable by topic. | M |
| FR-SRV-09 | Owners can transfer ownership to another member. | S |
| FR-SRV-10 | Users can reorder servers in their sidebar. | C |

### 3.4 Roles and permissions

| ID | Requirement | P |
|---|---|---|
| FR-ROLE-01 | Servers have roles with a name, color, position and permission set. | M |
| FR-ROLE-02 | Members can hold multiple roles. Effective permissions are the union of their roles' permissions. | M |
| FR-ROLE-03 | A role can only be managed by members whose highest role is above it (hierarchy). | M |
| FR-ROLE-04 | The permission set includes at least: View Channel, Send Messages, Manage Messages, Manage Channels, Manage Roles, Manage Server, Create Invites, Kick Members, Ban Members, Mention Everyone, Attach Files, Add Reactions, Administrator. | M |
| FR-ROLE-05 | Channels can override permissions per role/member (allow/deny), e.g. private channels. | S |

### 3.5 Channels

| ID | Requirement | P |
|---|---|---|
| FR-CH-01 | Servers contain text channels, optionally grouped under categories. | M |
| FR-CH-02 | Members with Manage Channels can create, rename, reorder, set a topic on, and delete channels and categories. | M |
| FR-CH-03 | Channels a member cannot view are hidden from them entirely. | M |
| FR-CH-04 | Unread indicators per channel, and mention counts per channel/server. | M |
| FR-CH-05 | Slow mode (per-user send cooldown) per channel. | C |

### 3.6 Messaging

| ID | Requirement | P |
|---|---|---|
| FR-MSG-01 | Members can send text messages (≤ 4000 characters, Markdown subset rendered safely). | M |
| FR-MSG-02 | New messages, edits and deletes show up for all viewers in real time (target < 500 ms on the same host). | M |
| FR-MSG-03 | Authors can edit their messages (marked "edited") and delete them. | M |
| FR-MSG-04 | Members with Manage Messages can delete others' messages. | M |
| FR-MSG-05 | Message history loads with infinite scroll (cursor pagination, 50 per page). | M |
| FR-MSG-06 | Typing indicators ("X is typing…"). | M |
| FR-MSG-07 | Replies to a specific message, shown with a quoted preview. | M |
| FR-MSG-08 | @user, @role and @everyone mentions, with highlighting and notification. | M |
| FR-MSG-09 | Emoji reactions (Unicode emoji), with live counts. | M |
| FR-MSG-10 | Attachments: images and files up to 10 MB each, max 5 per message, uploaded directly to Cloudinary. Images show inline previews. | M |
| FR-MSG-11 | A message sent while briefly offline is retried and not duplicated (client nonce / idempotency). | M |
| FR-MSG-12 | On reconnect, the client backfills messages it missed. | M |
| FR-MSG-13 | Pinned messages per channel. | S |
| FR-MSG-14 | Link previews (OpenGraph), fetched by a background task. | C |
| FR-MSG-15 | Threads. | C |

### 3.7 Direct messages

| ID | Requirement | P |
|---|---|---|
| FR-DM-01 | Users can open a 1:1 DM with any user they share a server with. | M |
| FR-DM-02 | Users can create group DMs with up to 10 participants. | S |
| FR-DM-03 | DMs support the same message features as channels (edit, delete, reactions, replies, attachments). | M |
| FR-DM-04 | Users can block another user, which stops their DMs and hides their messages. | S |

### 3.8 Presence and notifications

| ID | Requirement | P |
|---|---|---|
| FR-PRES-01 | Member lists show who is online/idle/offline, updated live. | M |
| FR-PRES-02 | In-app notifications for mentions and DMs, plus a notification inbox. | M |
| FR-PRES-03 | Browser notifications (with user permission) when the tab is in the background. | S |
| FR-PRES-04 | Per-server / per-channel mute settings. | S |
| FR-PRES-05 | Email digest of unread mentions/DMs. | C |

### 3.9 Polls

| ID | Requirement | P |
|---|---|---|
| FR-POLL-01 | Members can post a poll in a channel or DM: a question plus 2–10 options, optional multiple choice, optional close time. | M |
| FR-POLL-02 | Members vote and can change their vote until the poll closes. | M |
| FR-POLL-03 | Results update live for everyone viewing. | M |
| FR-POLL-04 | Polls close automatically at their close time (background task), or manually by the author or a moderator. | M |

### 3.10 Search

| ID | Requirement | P |
|---|---|---|
| FR-SRCH-01 | Full-text search of messages within a server or DM, respecting channel visibility. | M |
| FR-SRCH-02 | Filters: from user, in channel, has attachment, before/after date. | S |

### 3.11 Exports

| ID | Requirement | P |
|---|---|---|
| FR-EXP-01 | Members with Manage Messages (and DM participants) can export a channel/DM transcript as a PDF. | M |
| FR-EXP-02 | Exports are generated by a background job. The user is notified with a short-lived download link. | M |
| FR-EXP-03 | Export files are deleted after 24 hours. | M |

### 3.12 Moderation and administration

| ID | Requirement | P |
|---|---|---|
| FR-MOD-01 | Members with Kick Members can remove a member. Members with Ban Members can ban (which prevents rejoining) and unban. | M |
| FR-MOD-02 | A server audit log records moderation actions (kick, ban, role and channel changes, message deletion by moderators). | S |
| FR-MOD-03 | Users can report a message to site staff. | S |
| FR-MOD-04 | Staff can deactivate users and delete servers through Django admin. | M |
| FR-MOD-05 | Staff can view the authentication audit log through Django admin. | M |

## 4. Non-functional requirements

### 4.1 Capacity and performance

Expected load is **small**: up to ~500 registered users and ~100 concurrent WebSocket connections. The system is sized for one VPS (2 vCPU / 4 GB RAM) with headroom.

| ID | Requirement |
|---|---|
| NFR-PERF-01 | API p95 latency < 300 ms for reads and < 500 ms for writes under expected load. |
| NFR-PERF-02 | Real-time fan-out (message saved → delivered to other clients) p95 < 500 ms. |
| NFR-PERF-03 | First load of the app shell: LCP < 2.5 s on a mid-range mobile on 4G. |
| NFR-PERF-04 | Endpoints never do N+1 queries (enforced with query-count assertions in tests). |
| NFR-PERF-05 | A message history page (50 messages) is served in ≤ 5 SQL queries. |

### 4.2 Availability and reliability

| ID | Requirement |
|---|---|
| NFR-REL-01 | Target availability 99.5 % monthly (single host; planned maintenance windows are allowed). |
| NFR-REL-02 | Deploys cause < 30 s of disruption. WebSocket clients reconnect automatically with exponential backoff. |
| NFR-REL-03 | Automated nightly PostgreSQL backups stored off-site. Retention: 7 daily, 4 weekly, 3 monthly. |
| NFR-REL-04 | Restore is documented and tested at least once per quarter. RPO ≤ 24 h, RTO ≤ 2 h. |
| NFR-REL-05 | Background jobs are idempotent and retried with backoff. Permanent failures are logged and alerted. |
| NFR-REL-06 | Every container has a health check and a restart policy. |

### 4.3 Security

| ID | Requirement |
|---|---|
| NFR-SEC-01 | All traffic is served over HTTPS (TLS 1.2+). HSTS is enabled in production. |
| NFR-SEC-02 | Passwords are hashed with Argon2. Password validators enforce minimum strength. |
| NFR-SEC-03 | Auth tokens live only in `httpOnly`, `Secure`, `SameSite=Lax` cookies and are never readable by JavaScript. |
| NFR-SEC-04 | State-changing requests are CSRF-protected. WebSocket handshakes validate `Origin`. |
| NFR-SEC-05 | Every API endpoint and WebSocket subscription enforces object-level permissions on the server side. |
| NFR-SEC-06 | Rate limiting on auth, message sending, uploads, invites and WebSocket events. |
| NFR-SEC-07 | User content is rendered safely (no raw HTML). A Content-Security-Policy header is set. |
| NFR-SEC-08 | Secrets come only from environment variables or the server's `.env` file and are never committed. CI runs secret scanning. |
| NFR-SEC-09 | Dependencies and container images are scanned in CI, and Dependabot is enabled. |
| NFR-SEC-10 | Uploads are restricted by type and size through signed Cloudinary upload parameters. |
| NFR-SEC-11 | Containers run as non-root users. Postgres and Redis are not exposed to the public internet. |

### 4.4 Privacy

| ID | Requirement |
|---|---|
| NFR-PRIV-01 | Only the data needed to run the service is collected. IP addresses are kept only in the auth audit log (90-day retention). |
| NFR-PRIV-02 | Users can export their own data (profile + messages as JSON) and delete their account. |

### 4.5 Usability and accessibility

| ID | Requirement |
|---|---|
| NFR-UX-01 | Responsive layout from 360 px mobile to desktop. On mobile the sidebars collapse into drawers. |
| NFR-UX-02 | WCAG 2.2 AA: keyboard navigable, visible focus, sufficient contrast, ARIA live regions for new messages. |
| NFR-UX-03 | Dark theme by default, plus a light theme and a system-preference option. |
| NFR-UX-04 | Optimistic UI for sending messages, reactions and votes. |
| NFR-UX-05 | Clear loading, empty and error states on every view. |

### 4.6 Maintainability and quality

| ID | Requirement |
|---|---|
| NFR-MNT-01 | Backend test coverage ≥ 85 % (lines). Frontend unit coverage ≥ 70 % for logic modules. |
| NFR-MNT-02 | End-to-end tests (Playwright) cover the critical flows: register → verify → create server → send message → see it live in a second browser. |
| NFR-MNT-03 | Linting, formatting and type checks are enforced in CI and pre-commit (Ruff, mypy, ESLint, Prettier, `tsc`). |
| NFR-MNT-04 | The API is described by an OpenAPI 3 schema. Frontend API types are generated from it. |
| NFR-MNT-05 | Every significant decision is recorded as an ADR in [DECISIONS.md](DECISIONS.md). |
| NFR-MNT-06 | Core software uses LTS versions where an LTS line exists. Exact versions are pinned in lockfiles and image tags. |

### 4.7 Observability

| ID | Requirement |
|---|---|
| NFR-OBS-01 | Structured JSON logs to stdout from every service, with request IDs carried across the API, WebSocket and Celery. |
| NFR-OBS-02 | Error tracking for backend and frontend (Sentry, free tier). |
| NFR-OBS-03 | Health endpoints: `/api/health/live` (process up) and `/api/health/ready` (DB + Redis reachable). |
| NFR-OBS-04 | External uptime monitoring with alerting (email). |
| NFR-OBS-05 | Disk, memory and backup-job failures raise alerts. |

## 5. Constraints

- **Stack:** Django 6.1.2 + DRF, Next.js 16.4.0 + Tailwind CSS, PostgreSQL 18, Redis, Celery, Django Channels.
- **Infrastructure:** Docker for development and production. A single VPS. GitHub Actions for CI/CD.
- **Media:** Cloudinary for images and files (the account owner provides credentials).
- **Budget:** minimal. Free tiers are preferred for third-party services (Cloudinary, Sentry, uptime monitoring, email).

## 6. Legacy feature mapping

| Legacy (StudyBuddy) | New system |
|---|---|
| Topic | Server topic + discovery (FR-SRV-07/08) |
| Room | Server with a default channel (FR-SRV, FR-CH) |
| Room participants | Server members (FR-SRV-05) |
| Message | Channel message (FR-MSG) |
| Recent activity feed | Notifications inbox + unread state (FR-PRES-02, FR-CH-04) |
| User profile / update user | Profiles (FR-PROF) |
| Polls app (3 fixed options) | In-channel polls, 2–10 options, live (FR-POLL) |
| Rooms PDF export | Channel transcript PDF export (FR-EXP) |
| Login/logout/failed-login signals | Auth audit log (FR-AUTH-08) |
| `signalstest` Product/Snippet models | Dropped (experimental, unused) |

## 7. Open questions

Tracked here until resolved, then moved into an ADR.

1. Production domain name.
2. VPS provider and size (default plan: 2 vCPU / 4 GB, e.g. Hetzner CX22 or similar).
3. Transactional email provider (e.g. Resend, Brevo, Mailgun free tier).
4. Off-site backup target (e.g. Backblaze B2 or any S3-compatible bucket).
5. Use Sentry SaaS (free tier)? Or self-host GlitchTip? (Default: Sentry SaaS.)
