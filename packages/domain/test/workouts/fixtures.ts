import type {
  Exercise,
  ExperienceLevel,
  GoalType,
  Split,
  TrainingLocation,
  UserTrainingInput,
  WorkoutCatalog,
  WorkoutTemplate,
} from '../../src/workouts';

// A small exercise library and template set covering every pattern, equipment level and
// contraindication tag in the LLD defaults. Ids equal slugs to keep assertions readable.

type ExerciseSpec = [
  slug: string,
  pattern: Exercise['movementPattern'],
  mechanics: Exercise['mechanics'],
  difficulty: ExperienceLevel,
  equipment: string[],
  primary: string[],
  secondary: string[],
  tags: string[],
  links?: { regression?: string; progression?: string },
];

const SPECS: ExerciseSpec[] = [
  [
    'barbell-back-squat',
    'squat',
    'compound',
    'INTERMEDIATE',
    ['barbell'],
    ['quadriceps', 'glutes'],
    ['hamstrings', 'core'],
    ['knee_high_load', 'axial_load_heavy', 'deep_knee_flexion_loaded', 'valsalva_heavy'],
    { regression: 'goblet-squat' },
  ],
  [
    'goblet-squat',
    'squat',
    'compound',
    'BEGINNER',
    ['dumbbell'],
    ['quadriceps', 'glutes'],
    ['core'],
    [],
    { regression: 'bodyweight-squat', progression: 'barbell-back-squat' },
  ],
  [
    'bodyweight-squat',
    'squat',
    'compound',
    'BEGINNER',
    [],
    ['quadriceps', 'glutes'],
    [],
    [],
    { progression: 'goblet-squat' },
  ],
  [
    'leg-press',
    'squat',
    'compound',
    'BEGINNER',
    ['machine'],
    ['quadriceps', 'glutes'],
    [],
    ['knee_high_load'],
  ],
  [
    'jump-squat',
    'squat',
    'compound',
    'INTERMEDIATE',
    [],
    ['quadriceps', 'glutes'],
    ['calves'],
    ['plyometric', 'high_impact', 'knee_high_load'],
  ],
  [
    'leg-extension',
    'squat',
    'isolation',
    'BEGINNER',
    ['machine'],
    ['quadriceps'],
    [],
    ['knee_high_load'],
  ],
  [
    'dumbbell-split-squat',
    'lunge',
    'compound',
    'BEGINNER',
    ['dumbbell'],
    ['quadriceps', 'glutes'],
    [],
    ['deep_knee_flexion_loaded'],
  ],
  ['reverse-lunge', 'lunge', 'compound', 'BEGINNER', [], ['quadriceps', 'glutes'], [], []],
  [
    'barbell-deadlift',
    'hinge',
    'compound',
    'INTERMEDIATE',
    ['barbell'],
    ['hamstrings', 'glutes', 'lower_back'],
    [],
    ['axial_load_heavy', 'spinal_flexion_loaded', 'valsalva_heavy'],
    { regression: 'dumbbell-rdl' },
  ],
  [
    'barbell-rdl',
    'hinge',
    'compound',
    'BEGINNER',
    ['barbell'],
    ['hamstrings', 'glutes'],
    ['lower_back'],
    ['axial_load_heavy'],
  ],
  [
    'dumbbell-rdl',
    'hinge',
    'compound',
    'BEGINNER',
    ['dumbbell'],
    ['hamstrings', 'glutes'],
    [],
    [],
    { regression: 'glute-bridge' },
  ],
  [
    'glute-bridge',
    'hinge',
    'compound',
    'BEGINNER',
    [],
    ['glutes'],
    ['hamstrings'],
    ['supine_after_t1'],
  ],
  ['leg-curl', 'hinge', 'isolation', 'BEGINNER', ['machine'], ['hamstrings'], [], []],
  [
    'barbell-bench-press',
    'push_h',
    'compound',
    'INTERMEDIATE',
    ['barbell', 'bench'],
    ['chest', 'triceps'],
    ['front_delts'],
    ['valsalva_heavy', 'supine_after_t1'],
  ],
  [
    'dumbbell-bench-press',
    'push_h',
    'compound',
    'BEGINNER',
    ['dumbbell', 'bench'],
    ['chest', 'triceps'],
    ['front_delts'],
    ['supine_after_t1'],
  ],
  [
    'machine-chest-press',
    'push_h',
    'compound',
    'BEGINNER',
    ['machine'],
    ['chest', 'triceps'],
    ['front_delts'],
    [],
  ],
  [
    'push-up',
    'push_h',
    'compound',
    'BEGINNER',
    [],
    ['chest', 'triceps'],
    ['core'],
    [],
    { regression: 'incline-push-up' },
  ],
  [
    'incline-push-up',
    'push_h',
    'compound',
    'BEGINNER',
    [],
    ['chest', 'triceps'],
    [],
    [],
    { progression: 'push-up' },
  ],
  ['cable-fly', 'push_h', 'isolation', 'BEGINNER', ['cable'], ['chest'], [], []],
  ['triceps-pushdown', 'push_h', 'isolation', 'BEGINNER', ['cable'], ['triceps'], [], []],
  [
    'barbell-overhead-press',
    'push_v',
    'compound',
    'INTERMEDIATE',
    ['barbell'],
    ['front_delts', 'triceps'],
    [],
    ['overhead_loaded', 'valsalva_heavy', 'axial_load_heavy'],
  ],
  [
    'dumbbell-shoulder-press',
    'push_v',
    'compound',
    'BEGINNER',
    ['dumbbell'],
    ['front_delts', 'triceps'],
    [],
    ['overhead_loaded'],
  ],
  ['pike-push-up', 'push_v', 'compound', 'BEGINNER', [], ['front_delts', 'triceps'], [], []],
  [
    'band-lateral-raise',
    'push_v',
    'isolation',
    'BEGINNER',
    ['resistance_band'],
    ['side_delts'],
    [],
    [],
  ],
  [
    'barbell-row',
    'pull_h',
    'compound',
    'INTERMEDIATE',
    ['barbell'],
    ['lats', 'upper_back'],
    ['biceps'],
    ['spinal_flexion_loaded'],
  ],
  [
    'dumbbell-row',
    'pull_h',
    'compound',
    'BEGINNER',
    ['dumbbell', 'bench'],
    ['lats', 'upper_back'],
    ['biceps'],
    [],
  ],
  [
    'seated-cable-row',
    'pull_h',
    'compound',
    'BEGINNER',
    ['cable'],
    ['lats', 'upper_back'],
    ['biceps'],
    [],
  ],
  [
    'band-row',
    'pull_h',
    'compound',
    'BEGINNER',
    ['resistance_band'],
    ['lats', 'upper_back'],
    ['biceps'],
    [],
  ],
  ['doorway-row', 'pull_h', 'compound', 'BEGINNER', [], ['upper_back', 'lats'], ['biceps'], []],
  ['dumbbell-curl', 'pull_h', 'isolation', 'BEGINNER', ['dumbbell'], ['biceps'], [], []],
  [
    'pull-up',
    'pull_v',
    'compound',
    'INTERMEDIATE',
    ['pull_up_bar'],
    ['lats'],
    ['biceps', 'upper_back'],
    [],
    { regression: 'lat-pulldown' },
  ],
  [
    'lat-pulldown',
    'pull_v',
    'compound',
    'BEGINNER',
    ['cable'],
    ['lats'],
    ['biceps'],
    [],
    { progression: 'pull-up' },
  ],
  [
    'band-pulldown',
    'pull_v',
    'compound',
    'BEGINNER',
    ['resistance_band'],
    ['lats'],
    ['biceps'],
    [],
  ],
  ['plank', 'core', 'isolation', 'BEGINNER', [], ['core'], [], []],
  ['dead-bug', 'core', 'isolation', 'BEGINNER', [], ['core'], [], ['supine_after_t1']],
  ['hanging-leg-raise', 'core', 'isolation', 'INTERMEDIATE', ['pull_up_bar'], ['core'], [], []],
  [
    'farmer-carry',
    'carry',
    'compound',
    'BEGINNER',
    ['dumbbell'],
    ['forearms', 'core'],
    ['upper_back'],
    [],
  ],
];

export function exercise(spec: ExerciseSpec): Exercise {
  const [
    slug,
    movementPattern,
    mechanics,
    difficulty,
    equipment,
    primaryMuscles,
    secondaryMuscles,
    contraindications,
    links,
  ] = spec;
  return {
    id: slug,
    slug,
    status: 'PUBLISHED',
    movementPattern,
    mechanics,
    difficulty,
    isBodyweight: equipment.length === 0,
    equipment,
    primaryMuscles,
    secondaryMuscles,
    contraindications,
    regressionId: links?.regression ?? null,
    progressionId: links?.progression ?? null,
    defaultRestSec: mechanics === 'compound' ? 120 : 60,
  };
}

export const EXERCISES: Exercise[] = [
  ...SPECS.map(exercise),
  {
    ...exercise(['draft-press', 'push_h', 'compound', 'BEGINNER', [], ['chest'], [], []]),
    status: 'DRAFT',
  },
];
export const EXERCISE_MAP: ReadonlyMap<string, Exercise> = new Map(EXERCISES.map((e) => [e.id, e]));
export const ex = (id: string): Exercise => EXERCISE_MAP.get(id)!;

type SlotSpec = [exerciseId: string, sets: number, repMin: number, repMax: number, rpe: number];

export function template(
  slug: string,
  meta: { goal: GoalType; experience: ExperienceLevel; location: TrainingLocation; split: Split },
  days: [name: string, focus: string, slots: SlotSpec[]][],
): WorkoutTemplate {
  return {
    id: slug,
    slug,
    status: 'PUBLISHED',
    ...meta,
    daysPerWeek: days.length,
    days: days.map(([name, focus], dayIndex) => ({ dayIndex, name, focus })),
    slots: days.flatMap(([, , slots], dayIndex) =>
      slots.map(([exerciseId, sets, repMin, repMax, targetRpe], i) => ({
        dayIndex,
        order: i + 1,
        exerciseId,
        sets,
        repMin,
        repMax,
        targetRpe,
        restSec: 90,
      })),
    ),
  };
}

const gymFullBody: SlotSpec[] = [
  ['barbell-back-squat', 3, 8, 12, 7],
  ['barbell-rdl', 3, 8, 12, 7],
  ['dumbbell-bench-press', 3, 8, 12, 7],
  ['seated-cable-row', 3, 8, 12, 7],
  ['plank', 2, 30, 45, 6],
];
const upper: SlotSpec[] = [
  ['barbell-bench-press', 4, 6, 10, 8],
  ['barbell-row', 4, 6, 10, 8],
  ['dumbbell-shoulder-press', 3, 8, 12, 8],
  ['lat-pulldown', 3, 8, 12, 8],
  ['dumbbell-curl', 2, 10, 15, 8],
  ['triceps-pushdown', 2, 10, 15, 8],
];
const lower: SlotSpec[] = [
  ['barbell-back-squat', 4, 6, 10, 8],
  ['barbell-deadlift', 3, 5, 8, 8],
  ['dumbbell-split-squat', 3, 8, 12, 8],
  ['leg-curl', 3, 10, 15, 8],
  ['hanging-leg-raise', 2, 10, 15, 7],
];
const push: SlotSpec[] = [
  ['barbell-bench-press', 5, 3, 6, 8],
  ['barbell-overhead-press', 4, 3, 6, 8],
  ['cable-fly', 3, 10, 15, 8],
  ['triceps-pushdown', 3, 10, 15, 8],
];
const pull: SlotSpec[] = [
  ['barbell-deadlift', 3, 3, 5, 8],
  ['pull-up', 4, 5, 8, 8],
  ['barbell-row', 4, 5, 8, 8],
  ['dumbbell-curl', 3, 8, 12, 8],
];
const legs: SlotSpec[] = [
  ['barbell-back-squat', 5, 3, 6, 8],
  ['leg-press', 3, 8, 12, 8],
  ['leg-curl', 3, 10, 15, 8],
  ['jump-squat', 3, 5, 8, 7],
];
const homeA: SlotSpec[] = [
  ['goblet-squat', 3, 10, 15, 7],
  ['push-up', 3, 8, 15, 7],
  ['dumbbell-row', 3, 10, 15, 7],
  ['glute-bridge', 2, 12, 20, 7],
  ['dead-bug', 2, 8, 12, 6],
];
const homeB: SlotSpec[] = [
  ['dumbbell-rdl', 3, 10, 15, 7],
  ['pike-push-up', 3, 6, 12, 7],
  ['band-row', 3, 12, 15, 7],
  ['reverse-lunge', 2, 10, 12, 7],
  ['plank', 2, 30, 45, 6],
];

export const SAFE_DEFAULT = template(
  'safe-default-full-body',
  { goal: 'GENERAL_FITNESS', experience: 'BEGINNER', location: 'HOME', split: 'full_body' },
  [
    [
      'Full body A',
      'full body',
      [
        ['bodyweight-squat', 2, 10, 15, 6],
        ['incline-push-up', 2, 8, 12, 6],
        ['doorway-row', 2, 8, 12, 6],
        ['plank', 2, 20, 30, 6],
      ],
    ],
    [
      'Full body B',
      'full body',
      [
        ['reverse-lunge', 2, 8, 12, 6],
        ['incline-push-up', 2, 8, 12, 6],
        ['doorway-row', 2, 8, 12, 6],
        ['glute-bridge', 2, 10, 15, 6],
      ],
    ],
  ],
);

export const TEMPLATES: WorkoutTemplate[] = [
  SAFE_DEFAULT,
  template(
    'fb-3-gym-beginner-general',
    { goal: 'GENERAL_FITNESS', experience: 'BEGINNER', location: 'GYM', split: 'full_body' },
    [
      ['Full body A', 'full body', gymFullBody],
      ['Full body B', 'full body', gymFullBody],
      ['Full body C', 'full body', gymFullBody],
    ],
  ),
  template(
    'fb-3-home-beginner-fatloss',
    { goal: 'FAT_LOSS', experience: 'BEGINNER', location: 'HOME', split: 'full_body' },
    [
      ['Home A', 'full body', homeA],
      ['Home B', 'full body', homeB],
      ['Home C', 'full body', homeA],
    ],
  ),
  template(
    'fb-2-home-beginner-general',
    { goal: 'GENERAL_FITNESS', experience: 'BEGINNER', location: 'HOME', split: 'full_body' },
    [
      ['Home A', 'full body', homeA],
      ['Home B', 'full body', homeB],
    ],
  ),
  template(
    'ul-4-gym-intermediate-hypertrophy',
    { goal: 'MUSCLE_GAIN', experience: 'INTERMEDIATE', location: 'GYM', split: 'upper_lower' },
    [
      ['Upper A', 'upper', upper],
      ['Lower A', 'lower', lower],
      ['Upper B', 'upper', upper],
      ['Lower B', 'lower', lower],
    ],
  ),
  template(
    'ul-4-gym-intermediate-general',
    { goal: 'GENERAL_FITNESS', experience: 'INTERMEDIATE', location: 'GYM', split: 'upper_lower' },
    [
      ['Upper A', 'upper', upper],
      ['Lower A', 'lower', lower],
      ['Upper B', 'upper', upper],
      ['Lower B', 'lower', lower],
    ],
  ),
  template(
    'ppl-6-gym-advanced-strength',
    { goal: 'STRENGTH', experience: 'ADVANCED', location: 'GYM', split: 'ppl' },
    [
      ['Push A', 'push', push],
      ['Pull A', 'pull', pull],
      ['Legs A', 'legs', legs],
      ['Push B', 'push', push],
      ['Pull B', 'pull', pull],
      ['Legs B', 'legs', legs],
    ],
  ),
  {
    ...template(
      'draft-3-gym-beginner-general',
      { goal: 'GENERAL_FITNESS', experience: 'BEGINNER', location: 'GYM', split: 'full_body' },
      [
        ['A', 'a', gymFullBody],
        ['B', 'b', gymFullBody],
        ['C', 'c', gymFullBody],
      ],
    ),
    status: 'DRAFT',
  },
];

export const CATALOG: WorkoutCatalog = { exercises: EXERCISES, templates: TEMPLATES };

export const GYM_EQUIPMENT = [
  'barbell',
  'dumbbell',
  'bench',
  'machine',
  'cable',
  'pull_up_bar',
  'resistance_band',
].map((code) => ({ code }));

export function user(overrides: Partial<UserTrainingInput> = {}): UserTrainingInput {
  return {
    goal: 'GENERAL_FITNESS',
    experience: 'BEGINNER',
    trainingDays: [0, 2, 4],
    sessionMinutes: 60,
    location: 'GYM',
    equipment: GYM_EQUIPMENT,
    conditions: [],
    intensityCap: 'STANDARD',
    ...overrides,
  };
}
