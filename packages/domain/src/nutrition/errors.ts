/** Codes a service maps to 422 problem documents. */
export type NutritionErrorCode =
  'UNIT_NOT_SUPPORTED' | 'STATE_NOT_SUPPORTED' | 'INVALID_INPUT' | 'INVALID_RECIPE';

export class NutritionDomainError extends Error {
  override readonly name = 'NutritionDomainError';

  constructor(
    readonly code: NutritionErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function ensure(condition: boolean, message: string): asserts condition {
  if (!condition) throw new NutritionDomainError('INVALID_INPUT', message);
}
