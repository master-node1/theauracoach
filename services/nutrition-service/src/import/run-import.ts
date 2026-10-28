import type { PrismaClient } from '../generated/prisma';
import { CatalogueWriter, formatPlan, type ImportInput, type ImportPlan } from '../catalogue/catalogue-writer';
import { curatedRecords, loadCuratedContent } from '../catalogue/content';
import { fdcRecords, readFdcDirectory } from './fdc';
import { readIfctFile } from './ifct';

export type ImportSource = 'curated' | 'fdc' | 'ifct';

export interface ImportOptions {
  source: ImportSource;
  /** fdc: the unpacked download directory. ifct: the CSV file. curated: the content directory. */
  path?: string;
  dryRun: boolean;
  verbose?: boolean;
}

export interface ImportOutcome {
  plan: ImportPlan;
  skipped: { ref: string; reason: string }[];
  report: string;
}

export function importInput(options: ImportOptions): { input: ImportInput; skipped: ImportOutcome['skipped'] } {
  switch (options.source) {
    case 'curated': {
      const records = curatedRecords(loadCuratedContent(options.path));
      return {
        input: {
          foods: records.foods,
          recipes: records.recipes,
          composites: [...records.composites.entries()].map(([recipeSlug, c]) => ({
            food: c.food,
            link: { recipeSlug, composite: c.composite },
          })),
          newStatus: 'IN_REVIEW',
        },
        skipped: [],
      };
    }
    case 'fdc': {
      if (!options.path) throw new Error('fdc needs --dir <unpacked FoodData Central download>');
      const { records, skipped } = fdcRecords(readFdcDirectory(options.path));
      return { input: { foods: records, newStatus: 'PUBLISHED' }, skipped };
    }
    case 'ifct': {
      if (!options.path) throw new Error('ifct needs --file <IFCT 2017 CSV supplied by the owner>');
      const { records, skipped } = readIfctFile(options.path);
      return { input: { foods: records, newStatus: 'PUBLISHED' }, skipped };
    }
  }
}

/** `pnpm nutrition:import <source>`: plan, print the diff, and apply unless it is a dry run. */
export async function runImport(db: PrismaClient, options: ImportOptions): Promise<ImportOutcome> {
  const { input, skipped } = importInput(options);
  const writer = new CatalogueWriter(db);
  const plan = options.dryRun ? await writer.plan(input) : await writer.apply(input);
  const lines = [
    `${options.dryRun ? 'Dry run (nothing written)' : 'Imported'}: ${options.source}`,
    formatPlan(plan, options.verbose),
  ];
  if (skipped.length > 0) {
    lines.push(`${skipped.length} rows skipped:`);
    for (const s of skipped.slice(0, 20)) lines.push(`  - ${s.ref}: ${s.reason}`);
  }
  return { plan, skipped, report: lines.join('\n') };
}
