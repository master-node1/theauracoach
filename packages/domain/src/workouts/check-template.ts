import { generatePlan, type GeneratePlanError } from './generate-plan';
import { DEFAULT_WORKOUT_POLICY, type WorkoutPolicy } from './policy';
import {
  EXPERIENCE_LEVELS,
  type Exercise,
  type ExperienceLevel,
  type TrainingLocation,
  type UserEquipment,
  type UserTrainingInput,
  type WorkoutTemplate,
} from './types';
import { validatePlan, type ValidationIssue } from './validate-plan';

// Template publish check (admin LLD §2): before a template goes live, the plans it produces for
// 20 synthetic users must all pass validatePlan. The profiles cover short and long sessions,
// back-to-back days, every condition in the default contraindication map, the low intensity cap
// and sparse equipment, so a template that only works for an ideal user is refused.

export interface TemplateCheckProfile {
  label: string;
  input: UserTrainingInput;
}

export type TemplateCheckError = GeneratePlanError | 'NOT_SELECTED' | 'FELL_BACK';

export interface TemplateCheckFailure {
  profile: string;
  error: TemplateCheckError;
  issues: ValidationIssue[];
}

export interface TemplateCheckResult {
  ok: boolean;
  failures: TemplateCheckFailure[];
}

const GYM_EQUIPMENT = [
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
];
const LOCATION_EQUIPMENT: Record<TrainingLocation, string[]> = {
  GYM: GYM_EQUIPMENT,
  HOME: ['dumbbell', 'resistance_band', 'bench', 'pull_up_bar'],
  OUTDOOR: ['pull_up_bar'],
};

const kit = (codes: string[]): UserEquipment[] => codes.map((code) => ({ code }));

/** Training days spread over the week (rest days between where the count allows). */
function spreadDays(n: number): number[] {
  const table: Record<number, number[]> = {
    2: [1, 4],
    3: [1, 3, 5],
    4: [0, 1, 3, 4],
    5: [0, 1, 2, 4, 5],
    6: [0, 1, 2, 3, 4, 5],
  };
  return table[n] ?? consecutiveDays(n);
}

function consecutiveDays(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

function nextLevel(level: ExperienceLevel): ExperienceLevel {
  const i = EXPERIENCE_LEVELS.indexOf(level);
  return EXPERIENCE_LEVELS[Math.min(i + 1, EXPERIENCE_LEVELS.length - 1)]!;
}

/** The 20 synthetic users a template must serve: its goal, location and days, at its level or above. */
export function templateCheckProfiles(
  template: Pick<WorkoutTemplate, 'goal' | 'experience' | 'location' | 'daysPerWeek'>,
): TemplateCheckProfile[] {
  const base: UserTrainingInput = {
    goal: template.goal,
    experience: template.experience,
    trainingDays: spreadDays(template.daysPerWeek),
    sessionMinutes: 60,
    location: template.location,
    equipment: kit(LOCATION_EQUIPMENT[template.location]),
    conditions: [],
    intensityCap: 'STANDARD',
    bodyweightKg: 70,
  };
  const p = (label: string, change: Partial<UserTrainingInput>): TemplateCheckProfile => ({
    label,
    input: { ...base, ...change },
  });
  const knee = { code: 'injury_knee', severity: 'moderate' as const };
  const back = { code: 'injury_lower_back', severity: 'mild' as const };
  const shoulder = { code: 'injury_shoulder', severity: 'mild' as const };
  const pregnancy = { code: 'pregnancy', severity: 'mild' as const };
  const hypertension = { code: 'hypertension', severity: 'mild' as const };
  return [
    p('baseline', {}),
    p('30-minute sessions', { sessionMinutes: 30 }),
    p('20-minute sessions', { sessionMinutes: 20 }),
    p('90-minute sessions', { sessionMinutes: 90 }),
    p('back-to-back days', { trainingDays: consecutiveDays(template.daysPerWeek) }),
    p('more experienced user', { experience: nextLevel(template.experience) }),
    p('low intensity cap', { intensityCap: 'LOW' }),
    p('knee injury, moderate', { conditions: [knee] }),
    p('knee injury, severe, low cap', {
      conditions: [{ ...knee, severity: 'severe' }],
      intensityCap: 'LOW',
    }),
    p('lower back injury', { conditions: [back] }),
    p('shoulder injury', { conditions: [shoulder] }),
    p('pregnancy', { conditions: [pregnancy], intensityCap: 'LOW' }),
    p('hypertension', { conditions: [hypertension] }),
    p('bodyweight only', { equipment: [] }),
    p('light dumbbells only', { equipment: [{ code: 'dumbbell', maxLoadKg: 10, incrementKg: 2 }] }),
    p('resistance bands only', { equipment: kit(['resistance_band']) }),
    p('knee, back and shoulder, bodyweight only', {
      conditions: [knee, back, shoulder],
      equipment: [],
    }),
    p('pregnancy and hypertension, 30 minutes', {
      conditions: [pregnancy, hypertension],
      intensityCap: 'LOW',
      sessionMinutes: 30,
    }),
    p('light user', { bodyweightKg: 50 }),
    p('heavy user, 45 minutes, back-to-back', {
      bodyweightKg: 110,
      sessionMinutes: 45,
      trainingDays: consecutiveDays(template.daysPerWeek),
    }),
  ];
}

/**
 * Generates a week from `template` alone for each synthetic profile and validates it. `exercises`
 * is the library the template would go live with. A week the safe default had to replace fails.
 */
export function checkTemplate(
  template: WorkoutTemplate,
  exercises: Exercise[],
  policy: WorkoutPolicy = DEFAULT_WORKOUT_POLICY,
): TemplateCheckResult {
  const candidate: WorkoutTemplate = { ...template, status: 'PUBLISHED' };
  const catalog = { exercises, templates: [candidate] };
  const byId = new Map(exercises.map((e) => [e.id, e]));
  const failures: TemplateCheckFailure[] = [];

  for (const { label, input } of templateCheckProfiles(template)) {
    const result = generatePlan(input, catalog, policy);
    if (!result.ok) {
      failures.push({ profile: label, error: result.error, issues: result.issues ?? [] });
    } else if (result.templateId !== candidate.id) {
      failures.push({ profile: label, error: 'NOT_SELECTED', issues: [] });
    } else if (result.fallback) {
      failures.push({ profile: label, error: 'FELL_BACK', issues: result.rejectedIssues });
    } else {
      const validation = validatePlan(result.week, input, byId, policy);
      if (!validation.valid) {
        failures.push({ profile: label, error: 'PLAN_INVALID', issues: validation.issues });
      }
    }
  }
  return { ok: failures.length === 0, failures };
}
