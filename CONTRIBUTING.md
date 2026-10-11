# Contributing

Thanks for helping. This guide covers the workflow. Local setup is in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Workflow

1. **Open or pick an issue.** Reference requirement IDs (e.g. `FR-MSG-09`) where they apply.
2. **Branch from `main`:** `<type>/<short-description>`, e.g. `feat/message-reactions`, `fix/ws-reconnect-loop`.
3. **Commit** using [Conventional Commits](https://www.conventionalcommits.org/):
   ```
   feat(messaging): add emoji reactions endpoint

   Implements FR-MSG-09. Reactions are unique per (message, user, emoji).

   Closes #42
   ```
   Types: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`. Scopes: `accounts`, `servers`, `channels`, `messaging`, `polls`, `realtime`, `frontend`, `infra`, `docs`, …
4. **Open a PR** into `main`. CI must pass. Squash-merge, with the squash commit title in Conventional Commit format.
5. `main` is protected: no direct pushes, CI required, linear history.

## Definition of done

- [ ] Tests added or updated (unit + integration, and E2E for user-facing flows)
- [ ] `make lint` and `make test` pass locally
- [ ] Migrations included and backwards-compatible with the previous release
- [ ] OpenAPI schema and frontend types regenerated if the API changed (`make gen-api`)
- [ ] `CHANGELOG.md` updated under **Unreleased** (for user-visible changes)
- [ ] Docs updated (an ADR for significant decisions, plus REQUIREMENTS/ARCHITECTURE/API as needed)
- [ ] No secrets, credentials or personal data in code, fixtures, logs or screenshots
- [ ] UI changes: responsive, keyboard accessible, dark/light themes checked. Screenshots attached to the PR

## Code style

### Backend (Python)

- Ruff for formatting and linting (config in `backend/pyproject.toml`). mypy strict-ish with django-stubs.
- Business logic goes in `services.py`, read queries in `selectors.py`. Keep views, consumers and tasks thin.
- Type hints on all public functions. Docstrings where intent isn't obvious.
- Never call Cloudinary/SMTP directly from views. Go through the service/task layer so tests can mock it.
- Publish real-time events only through `apps/realtime/publish.py`, inside `transaction.on_commit`.

### Frontend (TypeScript)

- ESLint + Prettier (with the Tailwind class-sorting plugin). TypeScript strict, no `any` without a comment explaining why.
- Feature folders under `src/features/<feature>/`. Shared primitives in `src/components/ui/`.
- Server Components by default. Add `"use client"` only where interactivity requires it.
- Use generated API types (`src/types/api.d.ts`). Never hand-write response types.

## Versioning and releases

- SemVer. `0.y.z` until v1.0 (each roadmap phase bumps the minor version).
- To release: move the `Unreleased` entries into a new version section in `CHANGELOG.md`, tag `vX.Y.Z` on `main`, and publish a GitHub Release with the changelog excerpt.

## Architecture decisions

Add an ADR to [docs/DECISIONS.md](docs/DECISIONS.md) for anything that is hard to reverse or affects multiple components (a new dependency of significance, a data model shift, an infrastructure change).
