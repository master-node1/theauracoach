import type { ExerciseContent, PublishIssue, TemplateContent } from '@aura/contracts';
import {
  checkTemplate,
  type Exercise as EngineExercise,
  type WorkoutPolicy,
} from '@aura/domain/workouts';
import { toEngineTemplate } from './engine-mapping';

// What must hold before a reviewed version goes live (admin LLD §2). Pure functions: the store
// loads what they need, so the importer and the admin API refuse exactly the same content.

/** `knownSlugs`: exercise slugs in any version, to check regression and progression links. */
export function checkExercise(
  body: ExerciseContent,
  knownSlugs: ReadonlySet<string>,
): PublishIssue[] {
  const issues: PublishIssue[] = [];
  if (body.primaryMuscles.length === 0) {
    issues.push({ code: 'MISSING_PRIMARY_MUSCLE', path: 'primaryMuscles' });
  }
  const overlap = body.primaryMuscles.filter((m) => body.secondaryMuscles.includes(m));
  if (overlap.length > 0) {
    issues.push({
      code: 'MUSCLE_PRIMARY_AND_SECONDARY',
      path: 'secondaryMuscles',
      detail: { muscles: overlap.join(',') },
    });
  }
  if (body.equipment.length === 0) issues.push({ code: 'MISSING_EQUIPMENT', path: 'equipment' });
  if (body.equipment.includes('bodyweight') && body.equipment.length > 1) {
    issues.push({ code: 'BODYWEIGHT_WITH_EQUIPMENT', path: 'equipment' });
  }
  if (body.instructions.length === 0) {
    issues.push({ code: 'MISSING_INSTRUCTIONS', path: 'instructions' });
  }
  if (!body.contraindicationsReviewed) {
    issues.push({ code: 'CONTRAINDICATIONS_NOT_REVIEWED', path: 'contraindicationsReviewed' });
  }
  body.media.forEach((m, i) => {
    if (!m.altText) issues.push({ code: 'MEDIA_ALT_TEXT_MISSING', path: `media.${i}.altText` });
    if (m.kind === 'VIDEO' && !m.captionsKey) {
      issues.push({ code: 'MEDIA_CAPTIONS_MISSING', path: `media.${i}.captionsKey` });
    }
  });
  for (const link of ['regression', 'progression'] as const) {
    const target = body[link];
    if (target === null) continue;
    if (target === body.slug) issues.push({ code: 'LINK_TO_SELF', path: link });
    else if (!knownSlugs.has(target)) {
      issues.push({ code: 'UNKNOWN_LINKED_EXERCISE', path: link, detail: { slug: target } });
    }
  }
  return issues;
}

/**
 * `live` is the published library keyed by slug. Every slot must name a live exercise, then the
 * template must produce valid weeks for all 20 synthetic profiles (`checkTemplate`).
 */
export function checkTemplateContent(
  body: TemplateContent,
  live: ReadonlyMap<string, EngineExercise>,
  policy: WorkoutPolicy,
): PublishIssue[] {
  const issues: PublishIssue[] = [];
  body.days.forEach((day, d) =>
    day.exercises.forEach((slot, i) => {
      if (!live.has(slot.exercise)) {
        issues.push({
          code: 'EXERCISE_NOT_PUBLISHED',
          path: `days.${d}.exercises.${i}.exercise`,
          detail: { slug: slot.exercise },
        });
      }
    }),
  );
  if (issues.length > 0) return issues;

  const template = toEngineTemplate(body, 'candidate', 'IN_REVIEW', (s) => live.get(s)?.id);
  for (const failure of checkTemplate(template, [...live.values()], policy).failures) {
    issues.push({
      code: 'SAMPLE_PLAN_INVALID',
      detail: {
        profile: failure.profile,
        error: failure.error,
        rules: [...new Set(failure.issues.map((x) => x.rule))].join(','),
      },
    });
  }
  return issues;
}
