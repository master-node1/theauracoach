# Build from the repository root: docker build -f apps/web/Dockerfile .
# Next.js standalone server for the web app, admin console and auth BFF (deployable `web`).
FROM node:22.22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
# Runtime settings (APP_URL, OIDC_*, SESSION_SECRET) are read lazily, so the build needs none.
RUN NEXT_OUTPUT=standalone pnpm turbo run build --filter=@aura/web...

FROM node:22.22-bookworm-slim AS runtime
# Patch OS packages, and drop npm and corepack: the runtime never installs anything.
RUN apt-get update && apt-get upgrade -y \
  && rm -rf /var/lib/apt/lists/* \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
     /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
# The root filesystem is read-only in the cluster; the chart mounts an emptyDir at
# /app/apps/web/.next/cache (infra/helm/values/web.yaml, writablePaths).
CMD ["node", "apps/web/server.js"]
