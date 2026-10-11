# Security Policy

## Supported versions

Only the latest release deployed from `main` gets security fixes.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report vulnerabilities privately through GitHub's **[Report a vulnerability](https://github.com/George-Kibe/django-discord-clone/security/advisories/new)** (Security → Advisories).

Please include:

- A description of the issue and its impact
- Steps to reproduce or a proof of concept
- Affected endpoints, components or versions

You can expect an acknowledgement within **72 hours** and a status update within **7 days**. Once the issue is fixed, we will credit you in the release notes (unless you prefer to stay anonymous).

## Scope

In scope: the application code in this repository and the production deployment it defines.

Out of scope: third-party services (Cloudinary, email provider, Sentry), denial-of-service and volumetric attacks, social engineering, and findings that need a compromised user device.

## Security practices

A summary of the controls in this project (details in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#7-security-architecture)):

- HTTPS only with HSTS. JWTs only in `httpOnly`/`Secure`/`SameSite` cookies. CSRF protection.
- Argon2 password hashing, email verification, rate limiting, auth audit log.
- Object-level permission checks on every API endpoint and WebSocket subscription.
- Strict Content-Security-Policy. User content rendered without raw HTML.
- Secrets only in environment variables. gitleaks secret scanning in pre-commit and CI.
- Dependabot, `pip-audit`, `pnpm audit` and Trivy image scanning in CI.
- Non-root containers. Database and Redis never exposed publicly.
