/**
 * Nutrition engines (TAC-12, nutrition LLD §2–6). Pure functions, no I/O: services load data,
 * call these, and persist what they return.
 */
export * from './decimal';
export * from './types';
export * from './errors';
export * from './rationale';
export * from './diet';
export * from './targets';
export * from './assessment';
export * from './normalise-serving';
export * from './composite-recipe';
export * from './meal-plan';
export * from './adapt-targets';
