import { PrismaClient } from '../generated/prisma';
import { runImport, type ImportSource } from './run-import';

const USAGE = `Usage: pnpm nutrition:import <curated|fdc|ifct> [--dir <path>] [--file <path>] [--dry-run] [--verbose]

  curated   content/nutrition (ingredients, cooked forms, recipes), imported IN_REVIEW
  fdc       USDA FoodData Central Foundation + SR Legacy, CSV or JSON download: --dir <folder>
  ifct      IFCT 2017 CSV supplied by the owner: --file <csv>

Needs DATABASE_URL. --dry-run prints the diff without writing. Re-running is safe.`;

async function main(argv: string[]): Promise<number> {
  const [source, ...rest] = argv;
  if (!source || !['curated', 'fdc', 'ifct'].includes(source) || rest.includes('--help')) {
    process.stderr.write(`${USAGE}\n`);
    return source ? 2 : 1;
  }
  const flag = (name: string) => {
    const i = rest.indexOf(name);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  if (!process.env.DATABASE_URL) {
    process.stderr.write('DATABASE_URL is not set\n');
    return 1;
  }
  const db = new PrismaClient();
  try {
    const outcome = await runImport(db, {
      source: source as ImportSource,
      path: flag('--dir') ?? flag('--file'),
      dryRun: rest.includes('--dry-run'),
      verbose: rest.includes('--verbose'),
    });
    process.stdout.write(`${outcome.report}\n`);
    return 0;
  } finally {
    await db.$disconnect();
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : err}\n`);
    process.exit(1);
  },
);
