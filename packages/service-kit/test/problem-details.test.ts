import { BadRequestException, HttpStatus, InternalServerErrorException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ProblemDetailsFilter, ProblemException } from '../src';

const filter = new ProblemDetailsFilter();

describe('ProblemDetailsFilter.toProblem', () => {
  it('maps a ProblemException with its code', () => {
    const p = filter.toProblem(
      new ProblemException(HttpStatus.CONFLICT, 'SESSION_CLOSED', 'Session is closed'),
    );
    expect(p).toEqual({
      type: 'https://docs.auracoach.app/problems/session-closed',
      title: 'Session is closed',
      status: 409,
      code: 'SESSION_CLOSED',
    });
  });

  it('maps Zod errors to 422 with field paths', () => {
    const result = z.object({ grams: z.number().positive() }).safeParse({ grams: -1 });
    const p = filter.toProblem(result.error);
    expect(p.status).toBe(422);
    expect(p.errors?.[0]?.path).toBe('grams');
  });

  it('hides internal error messages', () => {
    expect(filter.toProblem(new InternalServerErrorException('db password wrong')).title).toBe(
      'Internal error',
    );
    expect(filter.toProblem(new Error('secret detail')).title).toBe('Internal error');
  });

  it('keeps standard 4xx codes', () => {
    expect(filter.toProblem(new BadRequestException()).code).toBe('BAD_REQUEST');
  });
});
