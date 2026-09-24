import { parseCsv, parseDate } from '@ked/books';
import { zonedToUtc } from '@ked/scheduling';

/**
 * Reading someone else's export without knowing its exact columns: headers
 * are matched loosely (case, spaces and punctuation ignored) against a list
 * of likely names, first match wins.
 */

export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export interface Table {
  headers: string[];
  rows: string[][];
  /** The spreadsheet row number of rows[i], for messages. */
  line: (i: number) => number;
  /** Index of the first header matching any of the names, or -1. */
  col(...names: string[]): number;
  /** The row's value in the first matching column that has one. */
  get(row: string[], ...names: string[]): string;
}

/** `headerTest` picks the header row, for exports with title lines above it. */
export function readTable(text: string, headerTest: (cells: string[]) => boolean = () => true): Table | null {
  const all = parseCsv(text, { keepBlank: true });
  const at = all.findIndex((r) => r.some((c) => c.trim()) && headerTest(r.map(norm)));
  if (at < 0) return null;
  const headers = all[at]!.map((h) => h.trim());
  const keys = headers.map(norm);
  const kept = all.map((r, i) => [r, i + 1] as const).slice(at + 1).filter(([r]) => r.some((c) => c.trim()));
  const rows = kept.map(([r]) => r);
  const cols = (names: string[]) => names.map(norm).flatMap((n) => keys.flatMap((k, i) => (k === n ? [i] : [])));
  return {
    headers,
    rows,
    line: (i) => kept[i]![1],
    col: (...names) => cols(names)[0] ?? -1,
    get: (row, ...names) => {
      for (const i of cols(names)) {
        const v = row[i]?.trim();
        if (v) return v;
      }
      return '';
    },
  };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "09/24/2026", "2026-09-24", "Sep 24, 2026" (with or without a time after) → "2026-09-24". */
export function readDate(raw: string): string | null {
  const s = raw.trim();
  const numeric = s.match(/^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}\/\d{2,4})/);
  if (numeric) return parseDate(numeric[1]!);
  const named = s.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (named) {
    const m = MONTHS.indexOf(named[1]!.toLowerCase());
    if (m >= 0) return parseDate(`${named[3]}-${m + 1}-${named[2]}`);
  }
  return null;
}

/** "10:00 AM", "2:30pm", "14:30" anywhere in the text → "HH:MM", or null. */
export function readTime(raw: string): string | null {
  const m = raw.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap])?\.?m?\.?/i);
  if (!m) return null;
  let h = Number(m[1]);
  const ap = m[3]?.toLowerCase();
  if (ap === 'p' && h < 12) h += 12;
  if (ap === 'a' && h === 12) h = 0;
  if (h > 23 || Number(m[2]) > 59) return null;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

/**
 * A local date and time in the business's zone → the instant. ISO strings
 * with their own offset are taken as they are. `time` is for exports that put
 * the time in its own column.
 */
export function readInstant(raw: string, timeZone: string, time = ''): Date | null {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const date = readDate(s);
  if (!date) return null;
  // The time is whatever follows the date, so "9/4/26 10:00 AM" reads right too.
  const rest = s.replace(/^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}\/\d{2,4}|[A-Za-z]{3}[a-z]*\.?\s+\d{1,2},?\s+\d{4})/, '');
  const hhmm = readTime(rest) ?? readTime(time);
  return hhmm ? zonedToUtc(date, hhmm, timeZone) : null;
}
