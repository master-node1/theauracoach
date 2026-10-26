import { describe, expect, it } from 'vitest';
import { ageBand, ageOn } from '../src/internal/age-band';

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe('age band', () => {
  it('counts a birthday only once it has passed', () => {
    expect(ageOn(d('1990-06-15'), d('2026-06-14'))).toBe(35);
    expect(ageOn(d('1990-06-15'), d('2026-06-15'))).toBe(36);
  });

  it('groups ages into five-year bands starting at 18', () => {
    expect(ageBand(d('2008-01-01'), d('2026-10-26'))).toBe('18-19');
    expect(ageBand(d('2006-10-26'), d('2026-10-26'))).toBe('20-24');
    expect(ageBand(d('1992-03-01'), d('2026-10-26'))).toBe('30-34');
    expect(ageBand(d('1991-10-27'), d('2026-10-26'))).toBe('30-34');
    expect(ageBand(d('1991-10-26'), d('2026-10-26'))).toBe('35-39');
  });
});
