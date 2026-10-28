import { LOAD_EQUIPMENT, type ExerciseContent, type TemplateContent } from '@aura/contracts';
import type {
  ContentStatus,
  Exercise as EngineExercise,
  WorkoutTemplate as EngineTemplate,
} from '@aura/domain/workouts';

// Content bodies (what editors write) mapped into the engine types. The same mapping serves the
// publish checks, the dataset tests and, from TAC-16, plan generation, so a template is checked
// exactly as plans will read it.

/** True when the exercise needs no load equipment (a bench or a pull-up bar is not load). */
export function isBodyweight(equipment: readonly string[]): boolean {
  return !equipment.some((code) => (LOAD_EQUIPMENT as readonly string[]).includes(code));
}

export function toEngineExercise(
  body: ExerciseContent,
  id: string,
  status: ContentStatus,
  links: { regressionId?: string | null; progressionId?: string | null } = {},
): EngineExercise {
  return {
    id,
    slug: body.slug,
    status,
    movementPattern: body.movementPattern,
    mechanics: body.mechanics,
    difficulty: body.difficulty,
    isBodyweight: isBodyweight(body.equipment),
    equipment: [...body.equipment],
    primaryMuscles: [...body.primaryMuscles],
    secondaryMuscles: [...body.secondaryMuscles],
    contraindications: [...body.contraindications],
    regressionId: links.regressionId ?? null,
    progressionId: links.progressionId ?? null,
    defaultRestSec: body.defaultRestSec,
  };
}

/**
 * `exerciseId` resolves a slot's exercise slug to the id the catalog uses; unknown slugs keep the
 * slug, which the engine then reports as an unknown exercise.
 */
export function toEngineTemplate(
  body: TemplateContent,
  id: string,
  status: ContentStatus,
  exerciseId: (slug: string) => string | undefined,
): EngineTemplate {
  return {
    id,
    slug: body.slug,
    status,
    goal: body.goal,
    experience: body.experience,
    daysPerWeek: body.daysPerWeek,
    location: body.location,
    split: body.split,
    days: body.days.map((d, dayIndex) => ({ dayIndex, name: d.name, focus: d.focus })),
    slots: body.days.flatMap((d, dayIndex) =>
      d.exercises.map((s, i) => ({
        dayIndex,
        order: i + 1,
        exerciseId: exerciseId(s.exercise) ?? s.exercise,
        sets: s.sets,
        repMin: s.repMin,
        repMax: s.repMax,
        targetRpe: s.targetRpe,
        restSec: s.restSec,
      })),
    ),
  };
}
