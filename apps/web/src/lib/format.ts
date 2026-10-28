/** `2026-10-27T10:43:09.000Z` → `27 Oct 2026, 16:13 IST`. Staff work in India time. */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toLocaleString('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })} IST`;
}

export function formatNumber(value: number): string {
  return value.toLocaleString('en-IN');
}

/** A support-view or report value as text. ISO timestamps are shown as times. */
export function formatValue(value: string | number | boolean | null): string {
  if (value === null) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return formatNumber(value);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return formatTime(value);
  return value;
}

/** `role.grant` → `Role grant`. */
export function readableAction(action: string): string {
  const text = action.replace(/[._]/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
