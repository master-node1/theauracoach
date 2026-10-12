# Engineering rules (humans and AI agents)

These apply to every change in this repository. The design they come from is in [docs/](docs/README.md).

## Work
- Every piece of work has a Jira ticket in project **TAC**; the branch and PR title start with its key, e.g. `TAC-1-phase-4-foundation`.
- Build in reviewed increments. Do not claim a feature is complete unless it is implemented, tested and verified against its acceptance criteria.
- Inspect existing code before changing it; do not overwrite working functionality without a stated reason.
- Report results as Build / Tests / Lint: PASS, FAIL or NOT RUN, with the command used.

## Architecture
- Apps live in `apps/web` (Next.js, web and admin) and `apps/mobile` (Expo). They reach the API only through the gateway: the web app through its BFF (`/api/auth/*`, `/api/v1/*`), mobile directly with a bearer token. Share code with them through `packages/api-client` and `packages/ui-tokens`.
- Services live in `services/<name>-service` and never import each other's code (ESLint enforces it). They talk only through `/internal/v1` HTTP via `InternalClient` or through events ([ADR-009](docs/architecture/ADR/ADR-009-service-communication.md)).
- Each service owns its database. No cross-database queries or foreign keys; copy what you need through events.
- State changes that others care about write an event to the outbox in the same transaction (`writeOutbox`). Event payloads are defined in `packages/contracts` and versioned.
- Deterministic engines (`packages/domain`, from Phase 5) own every number shown to users. The AI explains and proposes; it never writes plans or targets directly ([ADR-004](docs/architecture/ADR/ADR-004-deterministic-engines-ai-proposes.md)).
- New services come from `pnpm new-service` so they share the same layout, health checks and auth.

## Security and privacy
- Never commit secrets, credentials or real personal data. Values in `docker-compose.yml`, `.env.example` and tests are local placeholders. Deployed values come from AWS Secrets Manager.
- Every route is authenticated unless marked `@Public()`. Internal routes use `@InternalOnly(...)` with an explicit caller list.
- Errors are RFC 9457 problem documents; never return stack traces or internal messages.
- Do not log request bodies, emails, health notes or tokens (see `REDACT_PATHS` in `service-kit`).
- Tokens never reach browser JavaScript or plain storage: the web app keeps them in encrypted HttpOnly `__Host-` cookies, the mobile app only in `expo-secure-store`.

## Quality gates (CI)
- `pnpm format:check`, and `turbo run build typecheck lint test test:int --affected` must pass.
- Changed services must build their Docker image with no fixable critical vulnerabilities, and the compose smoke test must pass.
- Changes that affect the web app must pass its Playwright smoke against the compose stack; the mobile app must pass `expo export`.
- Schema changes ship as Prisma migrations; destructive changes ship one release after the code stops using the old shape.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
