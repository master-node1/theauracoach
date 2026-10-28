import { z } from 'zod';
import { EXPERIENCE_LEVELS, TRAINING_LOCATIONS } from './me';

/**
 * Workout content: exercises and templates as editors write them (admin API bodies and the
 * versioned JSON files in `content/workouts/`), the admin revision views, and the library read API
 * (workouts LLD §7, admin LLD §2). The code lists are the controlled vocabularies the engines and
 * the reference tables use; workout-service seeds `Equipment` and `MuscleGroup` from them.
 */

export const EQUIPMENT_CODES = [
  'bodyweight',
  'dumbbell',
  'barbell',
  'kettlebell',
  'bench',
  'pull_up_bar',
  'dip_station',
  'resistance_band',
  'cable',
  'machine',
  'cardio_machine',
  'jump_rope',
  'plyo_box',
] as const;
export type EquipmentCode = (typeof EQUIPMENT_CODES)[number];

/** Equipment that adds external load; an exercise using none of it counts as bodyweight. */
export const LOAD_EQUIPMENT: readonly EquipmentCode[] = [
  'dumbbell',
  'barbell',
  'kettlebell',
  'resistance_band',
  'cable',
  'machine',
];

export const MUSCLE_CODES = [
  'quadriceps',
  'glutes',
  'hamstrings',
  'adductors',
  'calves',
  'hip_flexors',
  'lower_back',
  'core',
  'obliques',
  'chest',
  'front_delts',
  'side_delts',
  'rear_delts',
  'triceps',
  'biceps',
  'forearms',
  'lats',
  'upper_back',
  'traps',
  'cardiovascular',
] as const;
export type MuscleCode = (typeof MUSCLE_CODES)[number];

export const MOVEMENT_PATTERNS = [
  'squat',
  'hinge',
  'push_h',
  'push_v',
  'pull_h',
  'pull_v',
  'lunge',
  'carry',
  'core',
  'cardio',
] as const;
export type MovementPattern = (typeof MOVEMENT_PATTERNS)[number];

/** Tags the engine's contraindication map excludes by condition (workouts LLD §3). */
export const CONTRAINDICATION_TAGS = [
  'knee_high_load',
  'plyometric',
  'deep_knee_flexion_loaded',
  'spinal_flexion_loaded',
  'axial_load_heavy',
  'overhead_loaded',
  'behind_neck',
  'supine_after_t1',
  'high_impact',
  'valsalva_heavy',
  'contact',
  'isometric_max',
] as const;
export type ContraindicationTag = (typeof CONTRAINDICATION_TAGS)[number];

export const WORKOUT_GOALS = [
  'FAT_LOSS',
  'MUSCLE_GAIN',
  'STRENGTH',
  'ENDURANCE',
  'GENERAL_FITNESS',
] as const;
export const WORKOUT_SPLITS = [
  'full_body',
  'upper_lower',
  'ppl',
  'upper_lower_conditioning',
] as const;
/** `time` exercises (planks, cardio) prescribe seconds in repMin/repMax. */
export const EXERCISE_TRACKING = ['reps', 'time'] as const;
export const MEDIA_KINDS = ['VIDEO', 'IMAGE', 'ANIMATION'] as const;
export const CONTENT_STATUSES = ['DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED'] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];
/** Who must sign content off before beta (needs-owner checklist, TAC-44). */
export const REVIEW_REQUIRED = ['trainer'] as const;

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{2,79}$/, 'Must be a lower-case-slug of 3–80');
const text = (max: number) => z.string().trim().min(1).max(max);

export const exerciseMediaSchema = z.strictObject({
  kind: z.enum(MEDIA_KINDS),
  storageKey: text(200),
  captionsKey: text(200).nullable().default(null),
  altText: z.string().trim().max(200).default(''),
  durationSec: z.number().int().min(1).max(600).nullable().default(null),
});
export type ExerciseMedia = z.infer<typeof exerciseMediaSchema>;

/**
 * An exercise as an editor writes it. Drafts may be incomplete; the publish checks (admin LLD §2)
 * require a primary muscle, equipment, instructions, reviewed contraindications and accessible media.
 */
export const exerciseContentSchema = z.strictObject({
  slug,
  name: text(80),
  movementPattern: z.enum(MOVEMENT_PATTERNS),
  mechanics: z.enum(['compound', 'isolation']),
  difficulty: z.enum(EXPERIENCE_LEVELS),
  tracking: z.enum(EXERCISE_TRACKING).default('reps'),
  primaryMuscles: z.array(z.enum(MUSCLE_CODES)).max(6).default([]),
  secondaryMuscles: z.array(z.enum(MUSCLE_CODES)).max(8).default([]),
  /** Every item is needed; `bodyweight` alone for none. */
  equipment: z.array(z.enum(EQUIPMENT_CODES)).max(4).default([]),
  instructions: z.array(text(300)).max(12).default([]),
  cues: z.array(text(120)).max(8).default([]),
  commonMistakes: z.array(text(200)).max(8).default([]),
  contraindications: z.array(z.enum(CONTRAINDICATION_TAGS)).max(12).default([]),
  /** A reviewer confirmed the tags are complete (an empty list is a decision, not an omission). */
  contraindicationsReviewed: z.boolean().default(false),
  regression: slug.nullable().default(null),
  progression: slug.nullable().default(null),
  defaultRestSec: z.number().int().min(15).max(600).default(90),
  /** Smallest sensible load step for this exercise, overriding the equipment default. */
  loadIncrementKg: z.number().positive().max(10).nullable().default(null),
  metValue: z.number().positive().max(25).nullable().default(null),
  /** Placeholder illustration until licensed media exists (TAC-44). */
  illustrationKey: text(120).nullable().default(null),
  media: z.array(exerciseMediaSchema).max(6).default([]),
});
export type ExerciseContentInput = z.input<typeof exerciseContentSchema>;
export type ExerciseContent = z.infer<typeof exerciseContentSchema>;

export const templateSlotSchema = z
  .strictObject({
    exercise: slug,
    sets: z.number().int().min(1).max(8),
    repMin: z.number().int().min(1).max(600),
    repMax: z.number().int().min(1).max(600),
    targetRpe: z.number().min(4).max(10).multipleOf(0.5),
    restSec: z.number().int().min(0).max(600),
  })
  .refine((s) => s.repMin <= s.repMax, {
    message: 'repMin must not exceed repMax',
    path: ['repMax'],
  });

export const templateDaySchema = z.strictObject({
  name: text(40),
  focus: text(40),
  exercises: z.array(templateSlotSchema).min(1).max(10),
});

/**
 * A workout template. `days` are the distinct sessions; the engine cycles them over the user's
 * training days, so a 3-day push/pull/legs rotation can serve `daysPerWeek: 6`.
 */
export const templateContentSchema = z
  .strictObject({
    slug,
    name: text(80),
    goal: z.enum(WORKOUT_GOALS),
    experience: z.enum(EXPERIENCE_LEVELS),
    location: z.enum(TRAINING_LOCATIONS),
    split: z.enum(WORKOUT_SPLITS),
    daysPerWeek: z.number().int().min(2).max(6),
    days: z.array(templateDaySchema).min(1).max(6),
  })
  .refine((t) => t.days.length <= t.daysPerWeek, {
    message: 'A template cannot define more days than daysPerWeek',
    path: ['days'],
  });
export type TemplateContentInput = z.input<typeof templateContentSchema>;
export type TemplateContent = z.infer<typeof templateContentSchema>;

/** One versioned file under `content/workouts/` (read by `pnpm content:import`). */
export const workoutContentFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  /** Status new versions get; `DRAFT` or `IN_REVIEW`. Publishing is a reviewer's step. */
  status: z.enum(['DRAFT', 'IN_REVIEW']),
  reviewRequired: z.enum(REVIEW_REQUIRED).nullable(),
  exercises: z.array(exerciseContentSchema).default([]),
  templates: z.array(templateContentSchema).default([]),
});
export type WorkoutContentFile = z.infer<typeof workoutContentFileSchema>;

export const CONTENT_KINDS = ['exercise', 'template'] as const;
export type WorkoutContentKind = (typeof CONTENT_KINDS)[number];

/** One version of an exercise or template in the admin API. */
export interface ContentRevision<TBody> {
  id: string;
  kind: WorkoutContentKind;
  slug: string;
  version: number;
  status: ContentStatus;
  /** True for the published version the library serves now. */
  live: boolean;
  reviewRequired: string | null;
  body: TBody;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  publishedAt: string | null;
  archivedAt: string | null;
}
export type ExerciseRevision = ContentRevision<ExerciseContent>;
export type TemplateRevision = ContentRevision<TemplateContent>;

export interface ContentRevisionPage<TBody> {
  items: ContentRevision<TBody>[];
  nextCursor: string | null;
}

export const contentRevisionQuerySchema = z.strictObject({
  status: z.enum(CONTENT_STATUSES).optional(),
  q: z.string().trim().max(80).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ContentRevisionQuery = z.infer<typeof contentRevisionQuerySchema>;

/** Why a publish was refused: one entry per failed check. */
export interface PublishIssue {
  code: string;
  path?: string;
  detail?: Record<string, string | number | boolean | null>;
}

// Library read API (GET /v1/exercises, /v1/exercises/{slug}).

export const exerciseQuerySchema = z.strictObject({
  q: z.string().trim().min(1).max(80).optional(),
  muscle: z.enum(MUSCLE_CODES).optional(),
  equipment: z.enum(EQUIPMENT_CODES).optional(),
  pattern: z.enum(MOVEMENT_PATTERNS).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ExerciseQuery = z.infer<typeof exerciseQuerySchema>;

export interface ExerciseSummary {
  id: string;
  slug: string;
  name: string;
  movementPattern: MovementPattern;
  difficulty: (typeof EXPERIENCE_LEVELS)[number];
  tracking: (typeof EXERCISE_TRACKING)[number];
  primaryMuscles: MuscleCode[];
  equipment: EquipmentCode[];
  illustrationKey: string | null;
  thumbnailUrl: string | null;
}

export interface ExerciseDetail extends ExerciseSummary {
  version: number;
  mechanics: 'compound' | 'isolation';
  secondaryMuscles: MuscleCode[];
  instructions: string[];
  cues: string[];
  commonMistakes: string[];
  contraindications: ContraindicationTag[];
  defaultRestSec: number;
  regression: ExerciseSummary | null;
  progression: ExerciseSummary | null;
  media: {
    kind: (typeof MEDIA_KINDS)[number];
    url: string;
    captionsUrl: string | null;
    altText: string;
    durationSec: number | null;
  }[];
}

export interface ExercisePage {
  items: ExerciseSummary[];
  nextCursor: string | null;
}
