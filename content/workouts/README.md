# Workout content

The starter exercise library and workout templates (TAC-13), imported with `pnpm content:import`
(see [workout-service](../../services/workout-service/README.md#content-library)).

- `exercises/<movement pattern>.json`: 120 exercises covering gym, home, dumbbell-only, band and
  bodyweight training.
- `templates/<slug>.json`: 12 templates (full body 3 days, upper/lower 4 days, push/pull/legs 5–6 days,
  across every goal, gym and home) plus `safe-default-full-body`, the policy's fallback for any user.

Each file follows `workoutContentFileSchema` in `@aura/contracts` (`schemaVersion: 1`). Everything is
`IN_REVIEW` with `reviewRequired: trainer`: a qualified trainer must sign the content off before beta
(TAC-44). Media is empty until licensed videos or animations exist; `illustrationKey` points at a
placeholder per movement pattern.

To change content, edit the JSON and run the importer: unchanged items are skipped, open drafts are
edited, and published items get a new version for review. `content-dataset.test.ts` in workout-service
checks every file in CI: schema, coverage, the publish checks for every item, and that every goal ×
location × training-days combination gets a valid plan.
