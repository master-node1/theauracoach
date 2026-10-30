import {
  EQUIPMENT_CODES,
  MOVEMENT_PATTERNS,
  MUSCLE_CODES,
  type ExerciseContent,
  type TemplateContent,
} from '@aura/contracts';
import {
  DEFAULT_WORKOUT_POLICY,
  EXPERIENCE_LEVELS,
  GOAL_TYPES,
  TRAINING_LOCATIONS,
  generatePlan,
  validatePlan,
  type UserTrainingInput,
} from '@aura/domain/workouts';
import fc from 'fast-check';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { isBodyweight, toEngineExercise, toEngineTemplate } from '../src/content/engine-mapping';
import { loadContentDir, type ContentEntry } from '../src/content/importer';
import { checkExercise, checkTemplateContent } from '../src/content/publish-checks';

// The starter dataset in content/workouts/ (TAC-13): schema-valid, publishable, and able to give
// every user a valid plan. CI runs this on every change to the content files.

const CONTENT = resolve(__dirname, '../../../content/workouts');
const MIGRATIONS = resolve(__dirname, '../prisma/migrations');

let entries: ContentEntry[];
let exercises: ExerciseContent[];
let templates: TemplateContent[];

beforeAll(async () => {
  entries = await loadContentDir(CONTENT);
  exercises = entries.filter((e) => e.kind === 'exercise').map((e) => e.body as ExerciseContent);
  templates = entries.filter((e) => e.kind === 'template').map((e) => e.body as TemplateContent);
});

const live = () =>
  new Map(exercises.map((e) => [e.slug, toEngineExercise(e, e.slug, 'PUBLISHED')]));
const catalog = () => ({
  exercises: [...live().values()],
  templates: templates.map((t) => toEngineTemplate(t, t.slug, 'PUBLISHED', (s) => s)),
});

describe('starter dataset', () => {
  it('has 120 exercises and 12 templates plus the safe default, all awaiting trainer review', () => {
    expect(exercises).toHaveLength(120);
    expect(templates.map((t) => t.slug)).toContain(DEFAULT_WORKOUT_POLICY.safeDefaultTemplateSlug);
    expect(templates).toHaveLength(13);
    for (const e of entries) {
      expect({ slug: e.body.slug, status: e.status, review: e.reviewRequired }).toEqual({
        slug: e.body.slug,
        status: 'IN_REVIEW',
        review: 'trainer',
      });
    }
  });

  it('covers every movement pattern and gym, home, dumbbell-only and bodyweight training', () => {
    expect(new Set(exercises.map((e) => e.movementPattern))).toEqual(new Set(MOVEMENT_PATTERNS));
    const only = (allowed: string[]) =>
      exercises.filter((e) => e.equipment.every((c) => allowed.includes(c))).length;
    expect(only(['bodyweight'])).toBeGreaterThanOrEqual(30);
    expect(only(['dumbbell', 'bodyweight'])).toBeGreaterThanOrEqual(45);
    expect(only(['resistance_band'])).toBeGreaterThanOrEqual(10);
    expect(
      exercises.filter((e) => e.equipment.some((c) => ['barbell', 'cable', 'machine'].includes(c)))
        .length,
    ).toBeGreaterThanOrEqual(25);
    for (const level of EXPERIENCE_LEVELS) {
      expect(exercises.some((e) => e.difficulty === level)).toBe(true);
    }
    const kinds = new Set(templates.map((t) => `${t.split}:${t.location}`));
    expect(kinds).toEqual(
      new Set([
        'full_body:GYM',
        'full_body:HOME',
        'upper_lower:GYM',
        'upper_lower:HOME',
        'ppl:GYM',
      ]),
    );
    expect(new Set(templates.map((t) => t.goal))).toEqual(new Set(GOAL_TYPES));
    expect(new Set(templates.map((t) => t.daysPerWeek))).toEqual(new Set([2, 3, 4, 5, 6]));
  });

  it('gives every exercise placeholder art, instructions, cues and common mistakes but no media yet', () => {
    for (const e of exercises) {
      expect(e.illustrationKey).toBe(`placeholder/${e.movementPattern}`);
      expect(e.media).toEqual([]);
      expect(e.instructions.length).toBeGreaterThanOrEqual(3);
      expect(e.cues.length).toBeGreaterThanOrEqual(2);
      expect(e.commonMistakes.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('links regressions to easier-or-equal and progressions to harder-or-equal exercises', () => {
    const bySlug = new Map(exercises.map((e) => [e.slug, e]));
    const rank = (slug: string) => EXPERIENCE_LEVELS.indexOf(bySlug.get(slug)!.difficulty);
    for (const e of exercises) {
      const own = EXPERIENCE_LEVELS.indexOf(e.difficulty);
      if (e.regression)
        expect({ slug: e.slug, ok: rank(e.regression) <= own }).toEqual({ slug: e.slug, ok: true });
      if (e.progression)
        expect({ slug: e.slug, ok: rank(e.progression) >= own }).toEqual({
          slug: e.slug,
          ok: true,
        });
    }
    expect(isBodyweight(['bench'])).toBe(true);
    expect(isBodyweight(['dumbbell', 'bench'])).toBe(false);
  });

  it('passes the exercise publish checks', () => {
    const slugs = new Set(exercises.map((e) => e.slug));
    for (const e of exercises)
      expect({ slug: e.slug, issues: checkExercise(e, slugs) }).toEqual({
        slug: e.slug,
        issues: [],
      });
  });

  it('passes the template publish checks: valid weeks for all 20 synthetic profiles', () => {
    const library = live();
    for (const t of templates) {
      expect({
        slug: t.slug,
        issues: checkTemplateContent(t, library, DEFAULT_WORKOUT_POLICY),
      }).toEqual({
        slug: t.slug,
        issues: [],
      });
    }
  });
});

const userArb = (goal: string, location: string, days: number): fc.Arbitrary<UserTrainingInput> =>
  fc.record({
    goal: fc.constant(goal as UserTrainingInput['goal']),
    experience: fc.constantFrom(...EXPERIENCE_LEVELS),
    trainingDays: fc.shuffledSubarray([0, 1, 2, 3, 4, 5, 6], { minLength: days, maxLength: days }),
    sessionMinutes: fc.integer({ min: 15, max: 120 }),
    location: fc.constant(location as UserTrainingInput['location']),
    equipment: fc
      .subarray(EQUIPMENT_CODES.filter((c) => c !== 'bodyweight'))
      .map((codes) => codes.map((code) => ({ code }))),
    conditions: fc.uniqueArray(
      fc.record({
        code: fc.constantFrom(
          'injury_knee',
          'injury_lower_back',
          'injury_shoulder',
          'pregnancy',
          'hypertension',
        ),
        severity: fc.constantFrom('mild' as const, 'moderate' as const, 'severe' as const),
      }),
      { maxLength: 3, selector: (c) => c.code },
    ),
    intensityCap: fc.constantFrom('STANDARD' as const, 'LOW' as const),
    bodyweightKg: fc.option(fc.integer({ min: 40, max: 150 }), { nil: null }),
  });

describe('plans from the starter dataset', { timeout: 120_000 }, () => {
  it('exist and validate for every goal × location × training days (property test)', () => {
    const { exercises: library, templates: engineTemplates } = catalog();
    const byId = new Map(library.map((e) => [e.id, e]));
    for (const goal of GOAL_TYPES) {
      for (const location of TRAINING_LOCATIONS) {
        for (const days of [2, 3, 4, 5, 6]) {
          fc.assert(
            fc.property(userArb(goal, location, days), (user) => {
              const result = generatePlan(user, { exercises: library, templates: engineTemplates });
              expect(result.ok).toBe(true);
              if (!result.ok) return;
              expect(validatePlan(result.week, user, byId)).toEqual({ valid: true, issues: [] });
              expect(result.week.sessions.length).toBeGreaterThan(0);
            }),
            { numRuns: 100 },
          );
        }
      }
    }
  });
});

describe('seed migration', () => {
  const sql = readdirSync(MIGRATIONS)
    .filter((d) => !d.endsWith('.toml'))
    .map((d) => readFileSync(join(MIGRATIONS, d, 'migration.sql'), 'utf8'))
    .join('\n');
  const insertedCodes = (table: string) => {
    const block = sql.slice(sql.indexOf(`INSERT INTO "${table}"`));
    return [...block.slice(0, block.indexOf('ON CONFLICT')).matchAll(/\('([a-z_]+)', '/g)].map(
      (m) => m[1],
    );
  };

  it('seeds exactly the equipment and muscle vocabularies the contracts define', () => {
    expect(insertedCodes('Equipment')).toEqual([...EQUIPMENT_CODES]);
    expect(insertedCodes('MuscleGroup')).toEqual([...MUSCLE_CODES]);
  });

  it('seeds every policy field with the engine default', () => {
    const block = sql.slice(sql.indexOf('INSERT INTO "WorkoutPolicy"'));
    const rows = [...block.matchAll(/\('([A-Za-z]+)', '((?:[^']|'')*)'::jsonb/g)];
    const seeded = Object.fromEntries(
      rows.map((m) => [m[1], JSON.parse(m[2]!.replace(/''/g, "'"))]),
    );
    expect(seeded).toEqual(DEFAULT_WORKOUT_POLICY);
  });
});
