import type { UserDataExport } from '@aura/service-kit';
import { strToU8, zipSync, type Zippable } from 'fflate';

/**
 * Builds the export zip (users LLD §3): every service's part as JSON (machine-readable) and each
 * table as CSV for spreadsheets, with a short README.
 */
export function buildExportArchive(parts: UserDataExport[], generatedAt: Date): Uint8Array {
  const files: Zippable = {
    'README.txt': strToU8(readme(parts, generatedAt)),
  };
  for (const part of [...parts].sort((a, b) => a.service.localeCompare(b.service))) {
    const name = part.service.replace(/-service$/, '');
    files[`json/${name}.json`] = strToU8(JSON.stringify(part, null, 2));
    for (const [model, rows] of Object.entries(part.tables)) {
      if (rows.length === 0) continue;
      files[`csv/${name}/${model}.csv`] = strToU8(toCsv(rows as Record<string, unknown>[]));
    }
  }
  return zipSync(files, { level: 6, mtime: generatedAt });
}

function readme(parts: UserDataExport[], generatedAt: Date): string {
  const lines = [
    'AuraCoach data export',
    `Created ${generatedAt.toISOString()}`,
    '',
    'json/ has everything we hold about you, one file per part of the app.',
    'csv/ has the same records as one spreadsheet per table.',
    'Dates are in UTC. Weights are in kilograms and heights in centimetres.',
    '',
    'Records per part:',
    ...parts.map(
      (p) =>
        `  ${p.service.replace(/-service$/, '')}: ${Object.values(p.tables).reduce((n, t) => n + t.length, 0)}`,
    ),
    '',
    'Questions: privacy@auracoach.app',
  ];
  return lines.join('\r\n') + '\r\n';
}

const NUMBER = /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i;

/** One CSV cell: JSON for objects and arrays; text that a spreadsheet would run as a formula is quoted. */
function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(text) && !NUMBER.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const lines = [columns.map(cell).join(',')];
  for (const row of rows) lines.push(columns.map((c) => cell(row[c])).join(','));
  return lines.join('\r\n') + '\r\n';
}
