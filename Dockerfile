# syntax=docker/dockerfile:1
#
# Clinical Case Room container images (see docs/DEPLOYMENT.md).
#
#   docker build -t case-room .                    # web app (default target: runner)
#   docker build -t case-room-migrate --target migrate .
#
# The web image runs the Next.js standalone server as a non-root user. Database
# migrations run from the separate "migrate" image as a release step, never at
# app start. The "seed" target loads the synthetic demo data and erases the
# database first: use it only for local demos, never on a shared deployment.

ARG NODE_IMAGE=node:22-bookworm-slim

# ---- dependencies ---------------------------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1
# Prisma reads its config (and generates the client) during install; no
# database is contacted at build time, so a placeholder URL is enough.
ARG DATABASE_URL=postgresql://build:build@localhost:5432/build
COPY package.json package-lock.json .nvmrc ./
COPY scripts ./scripts
COPY apps/web/package.json apps/web/
COPY packages/ai/package.json packages/ai/
COPY packages/config/package.json packages/config/
COPY packages/types/package.json packages/types/
COPY packages/ui/package.json packages/ui/
COPY packages/database/package.json packages/database/prisma.config.ts packages/database/
COPY packages/database/prisma packages/database/prisma
RUN npm ci --no-audit --no-fund

# ---- build ----------------------------------------------------------------
FROM deps AS builder
ARG DATABASE_URL=postgresql://build:build@localhost:5432/build
COPY . .
RUN npm run db:generate && NEXT_OUTPUT=standalone npm run build

# ---- migrations (release step) --------------------------------------------
FROM deps AS migrate
USER node
WORKDIR /repo/packages/database
# DATABASE_URL is provided at run time.
CMD ["/repo/node_modules/.bin/prisma", "migrate", "deploy"]

# ---- synthetic demo data (local demos only: erases the database) ----------
FROM builder AS seed
USER node
CMD ["npm", "run", "db:seed"]

# ---- web app --------------------------------------------------------------
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    STORAGE_DIR=/data/storage
RUN mkdir -p /data/storage && chown -R node:node /data /app
COPY --from=builder --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
# Exec form: Node receives SIGTERM directly and shuts down cleanly.
CMD ["node", "apps/web/server.js"]
