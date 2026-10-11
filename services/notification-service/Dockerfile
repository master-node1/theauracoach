# Build from the repository root: docker build -f services/notification-service/Dockerfile .
FROM node:22.22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable \
  && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@aura/notification-service...
RUN pnpm --filter=@aura/notification-service deploy --prod --legacy /out

FROM node:22.22-bookworm-slim AS runtime
# Patch OS packages, and drop npm and corepack: the runtime never installs anything,
# and npm's bundled dependencies are the image's main source of scanner findings.
RUN apt-get update && apt-get upgrade -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
     /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3000
# The worker deployment overrides the command with: node dist/main.worker.js
# The migration job runs: node_modules/.bin/prisma migrate deploy
CMD ["node", "dist/main.http.js"]
