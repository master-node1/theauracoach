// Engine types for the workout domain (workouts LLD §3–5). They mirror the workout-service
// Prisma models but carry only what the engines read, so services map rows into them.

export const EXPERIENCE_LEVELS = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] as const;
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];

export const GOAL_TYPES = [
  'FAT_LOSS',
  'MUSCLE_GAIN',
  'STRENGTH',
  'ENDURANCE',
  'GENERAL_FITNESS',
] as const;
export type GoalType = (typeof GOAL_TYPES)[number];

export const TRAINING_LOCATIONS = ['GYM', 'HOME', 'OUTDOOR'] as const;
export type TrainingLocation = (typeof TRAINING_LOCATIONS)[number];

export type IntensityCap = 'STANDARD' | 'LOW';
export type ContentStatus = 'DRAFT' | 'IN_REVIEW' | 'PUBLISHED' | 'ARCHIVED';
export type SessionStatus =
  'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'PARTIAL' | 'MISSED' | 'SKIPPED';
export type WeekKind = 'NORMAL' | 'DELOAD';

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
export type Mechanics = 'compound' | 'isolation';

/** Equipment code every user has; exercises needing only this are bodyweight. */
export const BODYWEIGHT = 'bodyweight';

export interface Exercise {
  id: string;
  slug: string;
  status: ContentStatus;
  movementPattern: MovementPattern;
  mechanics: Mechanics;
  difficulty: ExperienceLevel;
  isBodyweight: boolean;
  /** Equipment codes the exercise needs (all of them). Empty or `bodyweight` for none. */
  equipment: string[];
  primaryMuscles: string[];
  secondaryMuscles: string[];
  /** Contraindication tags, e.g. `knee_high_load`, `plyometric`. */
  contraindications: string[];
  regressionId?: string | null;
  progressionId?: string | null;
  defaultRestSec: number;
}

export interface TemplateDay {
  dayIndex: number;
  name: string;
  focus: string;
}

export interface TemplateSlot {
  dayIndex: number;
  order: number;
  /** The trainer's default exercise; its pattern and primary muscles define the slot. */
  exerciseId: string;
  sets: number;
  repMin: number;
  repMax: number;
  targetRpe: number;
  restSec: number;
}

export type Split = 'full_body' | 'upper_lower' | 'ppl' | 'upper_lower_conditioning';

export interface WorkoutTemplate {
  id: string;
  slug: string;
  status: ContentStatus;
  goal: GoalType;
  experience: ExperienceLevel;
  daysPerWeek: number;
  location: TrainingLocation;
  split: Split;
  days: TemplateDay[];
  slots: TemplateSlot[];
}

export type Severity = 'mild' | 'moderate' | 'severe';

export interface HealthCondition {
  code: string;
  severity: Severity;
}

export interface UserEquipment {
  code: string;
  /** Heaviest load available, e.g. an adjustable dumbbell's max. */
  maxLoadKg?: number | null;
  /** Smallest load step; dumbbells default to 2 kg. */
  incrementKg?: number | null;
}

export interface UserTrainingInput {
  goal: GoalType;
  experience: ExperienceLevel;
  /** Day-of-week indexes 0–6 as stored on the profile; n and n+1 (and 6, 0) are consecutive days. */
  trainingDays: number[];
  sessionMinutes: number;
  location: TrainingLocation;
  equipment: UserEquipment[];
  conditions: HealthCondition[];
  intensityCap: IntensityCap;
  /** Optional, only used for the "start light" dumbbell hint. */
  bodyweightKg?: number | null;
  /** Past completion rate per exercise id (0–1), used to rank candidates. */
  completionRates?: Record<string, number>;
}

export interface PlannedExercise {
  order: number;
  exerciseId: string;
  sets: number;
  repMin: number;
  repMax: number;
  /** Rep target inside the range for double progression; defaults to `repMin`. */
  targetReps?: number;
  /** Prescribed load; null until the user's first logged session establishes it. */
  targetLoadKg: number | null;
  /** Suggested dumbbell load labelled "start light"; never a prescription. */
  loadHintKg?: number | null;
  targetRpe: number;
  restSec: number;
  /** Sets before any max-load set additions, so additions stay within +2. */
  baseSets?: number;
  substitutedFromId?: string | null;
}

export interface PlannedSession {
  dayOfWeek: number;
  name: string;
  focus: string;
  exercises: PlannedExercise[];
}

export interface PlanWeek {
  /** 0-based week number inside the plan. */
  weekIndex: number;
  kind: WeekKind;
  templateId: string | null;
  sessions: PlannedSession[];
  rationale: RationaleEntry[];
}

export interface LoggedSet {
  exerciseId: string;
  setNumber: number;
  reps: number | null;
  loadKg: number | null;
  rpe: number | null;
  isWarmup?: boolean;
  painReported?: boolean;
  /** Optional row id, echoed back by PR detection. */
  id?: string;
}

export interface SessionLog {
  dayOfWeek: number;
  /** ISO date (YYYY-MM-DD) the session was scheduled for. */
  date: string;
  status: SessionStatus;
  /** Session RPE 1–10. */
  perceivedDifficulty?: number | null;
  /** 1–5. */
  soreness?: number | null;
  sets: LoggedSet[];
}

/** Explanation codes the UI and coach render (documented in the workouts LLD §4). */
export const RATIONALE_CODES = [
  // Plan generation
  'TEMPLATE_SELECTED',
  'TEMPLATE_FALLBACK_LOCATION',
  'TEMPLATE_FALLBACK_GENERAL',
  'PLAN_VALIDATION_FALLBACK',
  'EXERCISE_RESOLVED',
  'SLOT_DROPPED',
  'VOLUME_FITTED_TO_TIME',
  'VOLUME_CAPPED',
  'INTENSITY_CAP_LOW',
  'HINGE_FREQUENCY_LIMITED',
  'SCHEDULE_BACK_TO_BACK',
  'START_LIGHT',
  // Weekly progression
  'PROGRESS_LOAD',
  'PROGRESS_ADD_SET',
  'PROGRESS_EXERCISE',
  'HOLD_REPS',
  'HOLD_INCOMPLETE',
  'HOLD_NOT_PERFORMED',
  'HOLD_MAX_REACHED',
  'HOLD_MISSED',
  'HOLD_RECOVERY',
  'REGRESS_LOAD',
  'PAIN_REGRESSION',
  'PAIN_LOAD_REDUCED',
  'DELOAD_FATIGUE',
  'DELOAD_SCHEDULED',
  'RESUME_AFTER_DELOAD',
  'MISSED_RESCHEDULED',
] as const;
export type RationaleCode = (typeof RATIONALE_CODES)[number];

export interface RationaleEntry {
  code: RationaleCode;
  exerciseId?: string;
  dayOfWeek?: number;
  /** Small machine-readable facts for the explanation, e.g. `{ fromKg: 20, toKg: 22.5 }`. */
  detail?: Record<string, string | number | boolean | null>;
}

/** Proposals the user decides on (ADR-004: engines propose, users accept). */
export const RECOMMENDATION_KINDS = ['PROFESSIONAL_ADVICE', 'REDUCE_TRAINING_DAYS'] as const;
export type RecommendationKind = (typeof RECOMMENDATION_KINDS)[number];

export interface WorkoutRecommendation {
  kind: RecommendationKind;
  exerciseId?: string;
  detail?: Record<string, string | number | boolean | null>;
}
