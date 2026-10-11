# Local stand-in for Cognito. Build from the repository root: docker build -f tools/dev-auth/Dockerfile .
FROM node:22.22-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@aura/dev-auth...
RUN pnpm --filter=@aura/dev-auth deploy --prod --legacy /out

FROM node:22.22-bookworm-slim
ENV NODE_ENV=development
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 4100
CMD ["node", "dist/server.js"]
