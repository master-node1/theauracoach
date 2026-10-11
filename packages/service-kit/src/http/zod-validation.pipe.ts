import { PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/** Validates a body, query or param with a schema from packages/contracts. Failures render as 422. */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    return this.schema.parse(value);
  }
}
