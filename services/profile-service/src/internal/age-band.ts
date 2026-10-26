/** Whole years between a date of birth and `today`, both read as UTC calendar dates. */
export function ageOn(dateOfBirth: Date, today: Date): number {
  const age = today.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const beforeBirthday =
    today.getUTCMonth() < dateOfBirth.getUTCMonth() ||
    (today.getUTCMonth() === dateOfBirth.getUTCMonth() &&
      today.getUTCDate() < dateOfBirth.getUTCDate());
  return beforeBirthday ? age - 1 : age;
}

/**
 * Five-year age band such as `30-34`, so coach-service never sees a date of birth (ai-coach LLD §5).
 * Users are at least 18, so the first band is `18-19`.
 */
export function ageBand(dateOfBirth: Date, today: Date = new Date()): string {
  const age = ageOn(dateOfBirth, today);
  if (age < 20) return '18-19';
  const start = Math.floor(age / 5) * 5;
  return `${start}-${start + 4}`;
}
