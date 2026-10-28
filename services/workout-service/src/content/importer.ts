import {
  workoutContentFileSchema,
  type ExerciseContent,
  type PublishIssue,
  type TemplateContent,
  type WorkoutContentKind,
} from '@aura/contracts';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { ProblemException } from '@aura/service-kit';
import { IMPORT_ACTOR, parseBody, type ContentStore } from './content-store';

// `pnpm content:import`: versioned JSON under content/workouts/ into ContentRevision, upserted by
// slug. Unchanged content is left alone, so running it twice changes nothing; content that is
// already published gets a new version rather than an edit (admin LLD §2).

export interface ContentEntry {
  kind: WorkoutContentKind;
  body: ExerciseContent | TemplateContent;
  status: 'DRAFT' | 'IN_REVIEW';
  reviewRequired: string | null;
  file: string;
}

export type ImportAction = 'create' | 'update' | 'new_version' | 'unchanged';

export interface ImportReport {
  changes: { kind: WorkoutContentKind; slug: string; action: ImportAction; version: number }[];
  published: { kind: WorkoutContentKind; slug: string; version: number }[];
  refused: { kind: WorkoutContentKind; slug: string; issues: PublishIssue[] }[];
}

async function jsonFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((e) => {
      const path = join(dir, e.name);
      if (e.isDirectory()) return jsonFiles(path);
      return Promise.resolve(e.name.endsWith('.json') ? [path] : []);
    }),
  );
  return nested.flat().sort();
}

/**
 * Reads and validates every file under `dir`. Throws one error listing every problem: schema
 * failures by file, duplicate slugs, and template slots naming exercises the dataset lacks.
 */
export async function loadContentDir(dir: string): Promise<ContentEntry[]> {
  const entries: ContentEntry[] = [];
  const problems: string[] = [];
  for (const path of await jsonFiles(dir)) {
    const file = relative(dir, path);
    const parsed = workoutContentFileSchema.safeParse(JSON.parse(await readFile(path, 'utf8')));
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        problems.push(`${file}: ${issue.path.join('.')}: ${issue.message}`);
      }
      continue;
    }
    const { status, reviewRequired } = parsed.data;
    for (const body of parsed.data.exercises) {
      entries.push({ kind: 'exercise', body, status, reviewRequired, file });
    }
    for (const body of parsed.data.templates) {
      entries.push({ kind: 'template', body, status, reviewRequired, file });
    }
  }
  const seen = new Map<string, string>();
  for (const e of entries) {
    const key = `${e.kind}:${e.body.slug}`;
    if (seen.has(key))
      problems.push(`${e.file}: duplicate ${e.kind} ${e.body.slug} (also in ${seen.get(key)})`);
    seen.set(key, e.file);
  }
  const exercises = new Set(entries.filter((e) => e.kind === 'exercise').map((e) => e.body.slug));
  for (const e of entries) {
    if (e.kind === 'exercise') {
      const body = e.body as ExerciseContent;
      for (const link of [body.regression, body.progression]) {
        if (link && !exercises.has(link))
          problems.push(`${e.file}: ${body.slug} links to unknown exercise ${link}`);
      }
    } else {
      for (const day of (e.body as TemplateContent).days) {
        for (const slot of day.exercises) {
          if (!exercises.has(slot.exercise)) {
            problems.push(`${e.file}: ${e.body.slug} uses unknown exercise ${slot.exercise}`);
          }
        }
      }
    }
  }
  if (problems.length > 0) throw new Error(`Invalid workout content:\n  ${problems.join('\n  ')}`);
  return entries;
}

const same = (kind: WorkoutContentKind, stored: unknown, body: unknown) =>
  JSON.stringify(parseBody(kind, stored)) === JSON.stringify(parseBody(kind, body));

/**
 * Applies `entries` through the content store (so every write is audited like an editor's).
 * `dryRun` only reports the diff. `publish` (local and dev seeds) then submits and publishes every
 * open version in the dataset, exercises before templates; refusals are reported, not thrown.
 */
export async function importContent(
  store: ContentStore,
  entries: ContentEntry[],
  options: { dryRun?: boolean; publish?: boolean } = {},
): Promise<ImportReport> {
  const report: ImportReport = { changes: [], published: [], refused: [] };
  for (const kind of ['exercise', 'template'] as const) {
    const latest = await store.latestBySlug(kind);
    for (const e of entries.filter((x) => x.kind === kind)) {
      const current = latest.get(e.body.slug);
      const opts = { status: e.status, reviewRequired: e.reviewRequired };
      let action: ImportAction;
      let version = current?.version ?? 1;
      if (!current) {
        action = 'create';
        if (!options.dryRun) await store.create(kind, e.body as never, IMPORT_ACTOR, opts);
      } else if (same(kind, current.body, e.body) && current.reviewRequired === e.reviewRequired) {
        action = 'unchanged';
      } else {
        const open = current.status === 'DRAFT' || current.status === 'IN_REVIEW';
        action = open ? 'update' : 'new_version';
        if (!open) version += 1;
        if (!options.dryRun)
          await store.update(kind, current.id, e.body as never, IMPORT_ACTOR, opts);
      }
      report.changes.push({ kind, slug: e.body.slug, action, version });
    }
  }
  if (options.publish && !options.dryRun) {
    for (const kind of ['exercise', 'template'] as const) {
      const slugs = new Set(entries.filter((e) => e.kind === kind).map((e) => e.body.slug));
      for (const [slug, row] of await store.latestBySlug(kind)) {
        if (!slugs.has(slug) || (row.status !== 'DRAFT' && row.status !== 'IN_REVIEW')) continue;
        try {
          if (row.status === 'DRAFT') await store.submit(kind, row.id, IMPORT_ACTOR);
          await store.publish(kind, row.id, IMPORT_ACTOR);
          report.published.push({ kind, slug, version: row.version });
        } catch (err) {
          if (!(err instanceof ProblemException)) throw err;
          const issues = (err.errors ?? []).map((x) => ({ code: x.message, path: x.path }));
          report.refused.push({
            kind,
            slug,
            issues: issues.length ? issues : [{ code: err.code }],
          });
        }
      }
    }
  }
  return report;
}
