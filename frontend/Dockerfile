# syntax=docker/dockerfile:1.10
ARG NODE_VERSION=24
ARG PNPM_VERSION=12.11.2

# ---------------------------------------------------------------------------- base
FROM node:${NODE_VERSION}-trixie-slim AS base
ARG PNPM_VERSION
ENV NEXT_TELEMETRY_DISABLED=1 \
    PNPM_HOME=/home/node/.local/share/pnpm \
    PATH=/home/node/.local/share/pnpm:$PATH
RUN npm install -g pnpm@${PNPM_VERSION} && npm cache clean --force \
 && mkdir -p /app && chown node:node /app
WORKDIR /app
USER node

# ---------------------------------------------------------------------------- deps
FROM base AS deps
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,target=/home/node/.local/share/pnpm/store,uid=1000,gid=1000 \
    pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------- dev
# Source is bind-mounted; node_modules lives in a named volume seeded from this layer.
FROM deps AS dev
# Pre-create .next so its named volume is seeded with node ownership (not root).
RUN mkdir -p /app/.next
EXPOSE 3000
CMD ["pnpm", "dev", "--hostname", "0.0.0.0", "--port", "3000"]

# ---------------------------------------------------------------------------- builder
FROM deps AS builder
# Public values are inlined into the browser bundle; the Sentry token is a build secret.
ARG NEXT_PUBLIC_SENTRY_DSN=""
ARG NEXT_PUBLIC_ENVIRONMENT=production
ARG SENTRY_ORG=""
ARG SENTRY_PROJECT=""
ARG GIT_SHA=""
ENV NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN} \
    NEXT_PUBLIC_ENVIRONMENT=${NEXT_PUBLIC_ENVIRONMENT} \
    SENTRY_ORG=${SENTRY_ORG} \
    SENTRY_PROJECT=${SENTRY_PROJECT} \
    SENTRY_RELEASE=${GIT_SHA}
COPY --chown=node:node . .
RUN --mount=type=secret,id=sentry_auth_token,env=SENTRY_AUTH_TOKEN,uid=1000 pnpm build

# ---------------------------------------------------------------------------- prod
FROM node:${NODE_VERSION}-trixie-slim AS prod
ARG GIT_SHA=""
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    GIT_SHA=${GIT_SHA}
# The standalone server only needs `node`: drop npm/corepack (and their vendored deps).
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
WORKDIR /app
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://localhost:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
