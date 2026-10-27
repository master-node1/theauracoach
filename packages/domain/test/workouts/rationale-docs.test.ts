import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RATIONALE_CODES, RECOMMENDATION_KINDS, VALIDATION_RULES } from '../../src/workouts';

// TAC-11 acceptance: every code the engines emit is documented in the workouts LLD.
const LLD = readFileSync(join(__dirname, '../../../../docs/modules/workouts/LLD.md'), 'utf8');

describe('workouts LLD', () => {
  it.each([...RATIONALE_CODES, ...RECOMMENDATION_KINDS, ...VALIDATION_RULES])(
    'documents %s',
    (code) => {
      expect(LLD).toContain(`\`${code}\``);
    },
  );
});
