/**
 * Wall-clock ↔ instant conversion for one IANA zone, using only Intl, so it
 * runs unchanged in Workers, browsers, Node and React Native (Hermes has Intl).
 *
 * Dates are 'YYYY-MM-DD' strings and times 'HH:MM' strings, both in the
 * business's zone. Instants are Date objects or ISO strings in UTC.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function parts(instant: number, timeZone: string) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  const out: Record<string, number> = {};
  for (const p of f.formatToParts(instant)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** Milliseconds the zone is ahead of UTC at that instant (negative in the US). */
function offset(instant: number, timeZone: string): number {
  const p = parts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * The instant a wall-clock time happens in the zone. Across a DST change the
 * first guess can be an hour out, so it is corrected once against the offset
 * actually in force at the result.
 */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let guess = wall - offset(wall, timeZone);
  const corrected = wall - offset(guess, timeZone);
  if (corrected !== guess) guess = corrected;
  return new Date(guess);
}

/** The zone's calendar date at an instant. */
export function localDate(instant: Date | number | string, timeZone: string): string {
  const p = parts(new Date(instant).getTime(), timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** 0 = Sunday … 6 = Saturday. Calendar arithmetic only, so no zone needed. */
export function weekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

const pad = (n: number) => String(n).padStart(2, '0');
