// Workout engines (ADR-004, workouts LLD §3–5): pure, deterministic, no I/O.
export * from './types';
export * from './policy';
export { roundToIncrement, loadEquipment, type LoadEquipment, type RoundMode } from './load';
export { excludedTags, isHeavyHinge } from './eligibility';
export * from './validate-plan';
export * from './generate-plan';
export * from './progress-week';
export * from './substitute';
export * from './metrics';
export * from './reschedule';
