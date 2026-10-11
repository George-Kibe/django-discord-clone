# syntax=docker/dockerfile:1.7
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
COPY --chown=node:node . .
RUN pnpm build

# ---------------------------------------------------------------------------- prod
FROM node:${NODE_VERSION}-trixie-slim AS prod
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://localhost:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
