# Data Model

This is the logical data model for the PostgreSQL database. Field lists show the important columns. Implementation details (indexes, constraints) are noted where they matter for correctness or performance.

## Conventions

- **Primary keys:** `UUID` version 7 (time-ordered), generated in Python with `uuid.uuid7()` (Python 3.14+) (ADR-011). Exceptions: join tables that Django manages implicitly.
- **Timestamps:** every model has `created_at` (`auto_now_add`) and `updated_at` (`auto_now`), stored in UTC (`USE_TZ=True`).
- **Soft delete:** only where history matters (`Message.deleted_at`). Everything else is hard-deleted.
- **Naming:** singular model names, snake_case columns. App labels are shown as prefixes below.
- **Integrity:** foreign keys with explicit `on_delete`, plus `UniqueConstraint`/`CheckConstraint` in the database, not only in Python.

## Entity-relationship overview

```
accounts.User ─┬─< servers.Member >── servers.Server ──< chat_channels.Category
               │        │  └─< MemberRole >── servers.Role ─┘        │
               │        │                                     chat_channels.Channel ──< PermissionOverwrite
               │        │                                            │
               │        └────────────< chat_channels.ReadState >─────┤
               │                                                     │
               ├─< messaging.Message >───────────────────────────────┘   (or → DMConversation)
               │        ├─< Attachment
               │        ├─< Reaction >── User
               │        ├─< Mention
               │        └── polls.Poll ──< PollOption ──< PollVote >── User
               │
               ├─< messaging.DMParticipant >── messaging.DMConversation
               ├─< notifications.Notification
               ├─< accounts.AuthAuditEvent
               └─< exports.ExportJob

servers.Server ──< Invite, Ban, ServerAuditEvent;  servers.Server >── servers.Topic
```

## accounts

### User (custom `AbstractUser`, `AUTH_USER_MODEL = "accounts.User"`)

| Field | Type | Notes |
|---|---|---|
| id | uuid7 | PK |
| email | varchar(254) | `unique`, always stored lowercased (manager + `save()`), `USERNAME_FIELD` |
| username | varchar(32) | `unique`, always stored lowercased, `^[a-z0-9_.]{2,32}$` |
| display_name | varchar(64) | |
| bio | text(500) | blank |
| avatar_public_id | varchar | Cloudinary public ID, nullable |
| status | enum | `online`/`idle`/`dnd`/`invisible`, user-chosen (presence is derived live) |
| email_verified_at | timestamptz | null = unverified |
| is_active, is_staff, is_superuser | bool | Django defaults |
| last_seen_at | timestamptz | updated (throttled) on WS disconnect |

### AuthAuditEvent

`id (bigint), user (FK, nullable), email_attempted, event (registered|email_verified|login|logout|login_failed|password_changed|password_reset|email_changed|token_refresh_reuse), ip, user_agent, created_at`. Indexed on `(user, created_at)` and `(ip, created_at)`. Rows older than 90 days are pruned.

### BlockedUser

`blocker (FK User), blocked (FK User), created_at`. Unique `(blocker, blocked)`.

Email verification and password reset tokens are stateless signed tokens (Django `PasswordResetTokenGenerator`-style), so they need no table.

## servers

### Topic

`id, name (unique), slug (unique)`. Seeded with defaults (Programming, Gaming, Study, Music, Art…), and staff manage them in admin.

### Server

| Field | Type | Notes |
|---|---|---|
| id | uuid7 | PK |
| name | varchar(100) | |
| description | text(1000) | blank |
| icon_public_id | varchar | nullable |
| owner | FK User | `PROTECT` (ownership must be transferred first) |
| topic | FK Topic | nullable, `SET_NULL` |
| is_public | bool | listed on discovery, joinable without an invite |
| member_count | int | denormalized, maintained by services |

### Member

`id, server (FK, CASCADE), user (FK, CASCADE), nickname (nullable), joined_at`. Unique `(server, user)`. M2M `roles` through `MemberRole`.

### Role

| Field | Type | Notes |
|---|---|---|
| id | uuid7 | |
| server | FK | CASCADE |
| name | varchar(100) | |
| color | int | RGB, 0 = default |
| position | int | hierarchy, higher = more senior. `@everyone` is always 0 |
| permissions | bigint | bitfield, see [Permissions](#permissions) |
| is_default | bool | true only for `@everyone`, one per server (partial unique constraint) |
| mentionable, hoist | bool | |

### Invite

`code (varchar(10), PK, 8 random base62 characters), server, channel (nullable), inviter (FK User), max_uses (nullable = unlimited), uses, expires_at (nullable = never), revoked_at (nullable)`. Accepting an invite you're already covered by doesn't consume a use.

### Ban

`server, user, moderator (FK User, SET_NULL), reason, created_at`. Unique `(server, user)`.

### ServerAuditEvent

`server, actor, action (enum: server.update, member.kick/ban/unban/update, role.create/update/delete, channel.create/update/delete, overwrite.update, message.delete, invite.create/revoke), target_type, target_id, target_label (name at the time), changes (jsonb, e.g. `{field: {from, to}}` or a reason), created_at`. Indexed `(server, -id)`.

## chat_channels

### Category

`id, server, name, position`.

### Channel

| Field | Type | Notes |
|---|---|---|
| id | uuid7 | |
| server | FK | CASCADE |
| category | FK Category | nullable, `SET_NULL` |
| type | enum | `text` (more types reserved: `announcement`) |
| name | varchar(100) | lowercase-hyphenated |
| topic | varchar(1024) | blank |
| position | int | |
| slowmode_seconds | int | 0 = off |
| last_message_id | uuid | denormalized, used for unread checks |

### PermissionOverwrite

`channel, target_type (role|member), role (nullable FK), member (nullable FK), allow (bigint), deny (bigint)`. A check constraint enforces that exactly one target is set. Unique per `(channel, role)` and `(channel, member)`.

### ReadState

`user, channel, last_read_message_id, mention_count, updated_at`. Unique `(user, channel)`. DM read state lives on `DMParticipant` (ADR-025).

## messaging

### DMConversation

`id, is_group (bool), name (nullable, groups only), owner (nullable, groups only), last_message_id`.

### DMParticipant

`conversation, user, joined_at, closed (bool, hidden from the sidebar), last_read_message_id, unread_count`. Unique `(conversation, user)`. For 1:1 DMs a `dm_key` (sorted user IDs) on the conversation has a unique constraint so a pair can never get duplicate conversations.

### Message

| Field | Type | Notes |
|---|---|---|
| id | uuid7 | PK, also the pagination cursor (time-ordered) |
| channel | FK Channel | nullable |
| dm | FK DMConversation | nullable. Check constraint: exactly one of `channel`/`dm` |
| author | FK User | `SET_NULL`, nullable (shown as "Deleted User") |
| type | enum | `default`, `reply`, `system` (`poll` arrives in Phase 6) |
| content | text | ≤ 4000 chars. May be empty when the message has attachments. Mentions are tokens: `<@user_id>`, `<@&role_id>`, `@everyone` |
| reply_to | FK self | nullable, `SET_NULL` |
| nonce | varchar(64) | client idempotency key. Unique `(author, nonce)` where not null |
| edited_at | timestamptz | nullable |
| deleted_at | timestamptz | soft delete. Content is cleared and the message is rendered as "message deleted" |
| pinned_at | timestamptz | nullable |
| mention_everyone | bool | |
| search_vector | tsvector | `GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED`, GIN index |

Indexes: `(channel, id DESC)`, `(dm, id DESC)` (history pagination); `(author, id)`.

### Attachment

`id, message (FK, CASCADE), public_id (unique), resource_type (image|raw), filename (original, sanitised), content_type, size_bytes, width, height`. Max 5 per message, enforced in the service layer. Raw files keep their extension in `public_id`.

### Reaction

`message, user, emoji (varchar(32), Unicode), created_at`. Unique `(message, user, emoji)`. Counts are aggregated per `(message, emoji)` in selectors, in first-use order. Max 20 different emoji per message.

### Mention

`message, user (nullable), role (nullable)`. Exactly one is set. Rebuilt when a message is edited. Used to build notifications and mention counts.

### PendingUpload

`id, user, public_id, purpose, created_at`. Every signed upload is recorded here and the row is removed once the asset is attached. Rows older than 24 h are cleaned up (asset deleted from Cloudinary).

## polls

### Poll

`id, message (OneToOne, CASCADE), question (varchar(300)), allow_multiple (bool), closes_at (nullable), closed_at (nullable)`.

### PollOption

`id (bigint), poll, text (varchar(100)), position`. 2–10 per poll, unique (case-insensitive) within a poll.

### PollVote

`poll, option, user, single_choice (bool, copied from the poll), created_at`. Unique `(option, user)`. A partial `UniqueConstraint(poll, user, condition=Q(single_choice=True))` guarantees one vote per user in single-choice polls.

## notifications

### Notification

`id, user, type (mention|reply|dm; export_ready and others later), message (nullable FK), actor (nullable FK User), data (jsonb: where it happened, a content preview, `count` for DMs), read_at (nullable), created_at`. Indexed `(user, read_at, id DESC)`. Unread DM notifications are coalesced: one per conversation.

### MuteSetting

`user, server (nullable), channel (nullable), dm (nullable), muted_until (nullable = until unmuted)`. Exactly one target; unique per user and target.

## exports

### ExportJob

`id, requested_by, channel (nullable), dm (nullable), date_from, date_to, status (pending|running|done|failed|expired), file_name (on the `exports` volume), message_count, error (text), created_at, completed_at, expires_at`. Exactly one of `channel`/`dm`.

### MessageReport (messaging)

`message, reporter (SET_NULL), reason, content_snapshot, status (open|resolved|dismissed), created_at, resolved_at`. One open report per message and reporter. Reviewed in Django admin.

## Permissions

Permissions are stored as a 64-bit integer bitfield (`Role.permissions`, `PermissionOverwrite.allow/deny`). Bits are append-only. They are never renumbered, because stored values depend on them.

| Bit | Name | Value |
|---|---|---|
| 0 | `ADMINISTRATOR` | `1 << 0` |
| 1 | `VIEW_CHANNEL` | `1 << 1` |
| 2 | `MANAGE_CHANNELS` | `1 << 2` |
| 3 | `MANAGE_ROLES` | `1 << 3` |
| 4 | `MANAGE_SERVER` | `1 << 4` |
| 5 | `CREATE_INVITE` | `1 << 5` |
| 6 | `KICK_MEMBERS` | `1 << 6` |
| 7 | `BAN_MEMBERS` | `1 << 7` |
| 8 | `SEND_MESSAGES` | `1 << 8` |
| 9 | `MANAGE_MESSAGES` | `1 << 9` |
| 10 | `ATTACH_FILES` | `1 << 10` |
| 11 | `ADD_REACTIONS` | `1 << 11` |
| 12 | `MENTION_EVERYONE` | `1 << 12` |
| 13 | `READ_MESSAGE_HISTORY` | `1 << 13` |
| 14 | `CREATE_POLLS` | `1 << 14` |
| 15 | `EXPORT_TRANSCRIPTS` | `1 << 15` |
| 16 | `VIEW_AUDIT_LOG` | `1 << 16` |

**Default `@everyone` permissions:** VIEW_CHANNEL, SEND_MESSAGES, ATTACH_FILES, ADD_REACTIONS, READ_MESSAGE_HISTORY, CREATE_INVITE, CREATE_POLLS.

**Seeded roles on server creation:** `@everyone` (position 0), `Moderator` (+ MANAGE_MESSAGES, KICK_MEMBERS, VIEW_AUDIT_LOG, EXPORT_TRANSCRIPTS), `Admin` (ADMINISTRATOR).

**DM permissions** are implicit. Participants can do everything in their own conversation, except where blocked (FR-DM-04).

The Python source of truth is `apps/core/permissions.py` (an `IntFlag`). The frontend mirror is generated into the OpenAPI schema as an enum.

## Migration from the legacy database

The legacy app (removed in v0.7.0; see tag `v0.6.0` for its code) used SQLite with the `base_*` tables. Migrating data is **optional**, because the legacy app was never deployed with real users. If needed, a one-off management command `import_legacy` maps:

- `base.User` → `accounts.User` (passwords are kept: Django's hasher upgrades them on next login)
- `base.Topic` → `servers.Topic`
- `base.Room` → `servers.Server` (+ `#general` channel, host → owner, participants → members)
- `base.Message` → `messaging.Message` in that `#general` channel
