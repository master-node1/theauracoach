# Build from the repository root: docker build -f services/nutrition-service/Dockerfile .
FROM node:22.22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable \
  && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@aura/nutrition-service...
RUN pnpm --filter=@aura/nutrition-service deploy --prod --legacy /out

FROM base AS runtime
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3000
# The worker deployment overrides the command with: node dist/main.worker.js
# The migration job runs: node_modules/.bin/prisma migrate deploy
CMD ["node", "dist/main.http.js"]
