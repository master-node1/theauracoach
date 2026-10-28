/* eslint-disable no-console -- a command-line tool reports on stdout and stderr */
// pnpm content:import [--dir <path>] [--dry-run] [--publish]
//
// Imports content/workouts/ into workout_db (DATABASE_URL). --dry-run prints the diff and writes
// nothing. --publish also publishes every open version, which is how local and dev environments
// get a usable library; it is refused when NODE_ENV=production, where a reviewer publishes.
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { PrismaClient } from '../generated/prisma';
import { ContentStore } from './content-store';
import { importContent, loadContentDir } from './importer';

function repoRoot(from: string): string {
  let dir = resolve(from);
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error('Run inside the repository or pass --dir');
    dir = parent;
  }
  return dir;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      dir: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      publish: { type: 'boolean', default: false },
    },
  });
  if (values.publish && process.env.NODE_ENV === 'production') {
    console.error('--publish is for local and dev seeds; in production a reviewer publishes.');
    return 2;
  }
  const dir = values.dir ?? join(repoRoot(process.cwd()), 'content', 'workouts');
  const entries = await loadContentDir(dir);
  const prisma = new PrismaClient();
  try {
    const report = await importContent(new ContentStore(prisma), entries, {
      dryRun: values['dry-run'],
      publish: values.publish,
    });
    const counts = new Map<string, number>();
    for (const c of report.changes) {
      if (c.action !== 'unchanged')
        console.log(`${c.action.padEnd(12)} ${c.kind.padEnd(9)} ${c.slug} v${c.version}`);
      counts.set(c.action, (counts.get(c.action) ?? 0) + 1);
    }
    console.log(
      `${values['dry-run'] ? 'Dry run: ' : ''}${[...counts].map(([a, n]) => `${n} ${a}`).join(', ') || 'nothing to import'}`,
    );
    if (values.publish) console.log(`Published ${report.published.length}`);
    for (const r of report.refused) {
      console.error(`Refused ${r.kind} ${r.slug}: ${r.issues.map((i) => i.code).join('; ')}`);
    }
    return report.refused.length > 0 ? 1 : 0;
  } finally {
    await prisma.$disconnect();
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
