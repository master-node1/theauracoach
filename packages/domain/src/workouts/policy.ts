import type { ExperienceLevel, Severity } from './types';

// Engine policy values. workout-service loads them from `WorkoutPolicy` rows (changes are audited);
// the defaults below are the workouts LLD values and the test fixture.

export interface ContraindicationRule {
  /** The rule applies from this severity up. */
  minSeverity: Severity;
  tags: string[];
}

/** Condition code → excluded exercise tags (`CoachingPolicy.contraindication_map`). */
export type ContraindicationMap = Record<string, ContraindicationRule>;

export interface VolumeBounds {
  min: number;
  max: number;
}

export interface WorkoutPolicy {
  contraindicationMap: ContraindicationMap;
  /** Weekly hard sets per major (primary) muscle. */
  weeklySetsPerMuscle: Record<ExperienceLevel, VolumeBounds>;
  minutesPerSet: number;
  warmupMinutes: number;
  /** A session may run this many minutes over `sessionMinutes`. */
  sessionOverrunMinutes: number;
  /** Tags excluded whenever `intensityCap = LOW`. */
  lowCapExcludedTags: string[];
  lowCapMaxRpe: number;
  lowCapMinReps: number;
  /** Default load steps by equipment code; the user's `incrementKg` overrides them. */
  loadIncrementsKg: Record<string, number>;
  /** Used when the selected template's plan fails validation. */
  safeDefaultTemplateSlug: string;
  /** Intermediate and advanced users deload every Nth week. */
  scheduledDeloadEvery: number;
  /** Deload keeps this share of the week's sets (0.5–0.6). */
  deloadVolumeShare: number;
  deloadRpeDrop: number;
  regressLoadFactor: number;
  maxAddedSets: number;
  beginnerHeavyHingeSessionsPerWeek: number;
  painReportWindowDays: number;
  missedWeeksBeforeFewerDays: number;
}

export const DEFAULT_CONTRAINDICATION_MAP: ContraindicationMap = {
  injury_knee: {
    minSeverity: 'moderate',
    tags: ['knee_high_load', 'plyometric', 'deep_knee_flexion_loaded'],
  },
  injury_lower_back: { minSeverity: 'mild', tags: ['spinal_flexion_loaded', 'axial_load_heavy'] },
  injury_shoulder: { minSeverity: 'mild', tags: ['overhead_loaded', 'behind_neck'] },
  pregnancy: {
    minSeverity: 'mild',
    tags: ['supine_after_t1', 'high_impact', 'valsalva_heavy', 'contact'],
  },
  hypertension: { minSeverity: 'mild', tags: ['valsalva_heavy', 'isometric_max'] },
};

export const DEFAULT_WORKOUT_POLICY: WorkoutPolicy = {
  contraindicationMap: DEFAULT_CONTRAINDICATION_MAP,
  weeklySetsPerMuscle: {
    BEGINNER: { min: 8, max: 10 },
    INTERMEDIATE: { min: 10, max: 14 },
    ADVANCED: { min: 12, max: 18 },
  },
  minutesPerSet: 2.5,
  warmupMinutes: 8,
  sessionOverrunMinutes: 10,
  lowCapExcludedTags: ['plyometric'],
  lowCapMaxRpe: 6,
  lowCapMinReps: 6,
  loadIncrementsKg: { barbell: 2.5, dumbbell: 2, machine: 5, cable: 5 },
  safeDefaultTemplateSlug: 'safe-default-full-body',
  scheduledDeloadEvery: 6,
  deloadVolumeShare: 0.55,
  deloadRpeDrop: 2,
  regressLoadFactor: 0.9,
  maxAddedSets: 2,
  beginnerHeavyHingeSessionsPerWeek: 2,
  painReportWindowDays: 14,
  missedWeeksBeforeFewerDays: 3,
};
