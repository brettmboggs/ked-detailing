import { business } from '../data/site';
import { apiUrl } from './pricing';

/**
 * Jacob's working hours, read once per build from the API. Saving hours in the
 * admin rebuilds the site (see rebuildSite in api/src/index.ts), so the footer
 * and the search listing follow them without a commit.
 *
 * Until he has saved any, or when the API can't be reached, the site keeps the
 * line in site.ts and the listing's usual hours. A broken API never breaks the
 * build.
 */
type Day = { open: string; close: string } | null;

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** Monday first, the way people say it. Indexes into the Sunday-first week. */
const ORDER = [1, 2, 3, 4, 5, 6, 0];

export interface Hours {
  /** One sentence for the footer and intro, no trailing period. */
  line: string;
  /** schema.org OpeningHoursSpecification entries. */
  spec: { '@type': 'OpeningHoursSpecification'; dayOfWeek: string[]; opens: string; closes: string }[];
}

const fallback: Hours = {
  line: business.hours,
  spec: [{ '@type': 'OpeningHoursSpecification', dayOfWeek: ORDER.map((i) => DAYS[i]!), opens: '09:00', closes: '17:00' }],
};

let cached: Promise<Hours> | undefined;

export function loadHours(): Promise<Hours> {
  cached ??= fetchHours();
  return cached;
}

async function fetchHours(): Promise<Hours> {
  if (!apiUrl) return fallback;
  try {
    const res = await fetch(`${apiUrl}/v1/hours`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { week, updatedAt } = (await res.json()) as { week: Day[]; updatedAt: string | null };
    if (!updatedAt) return fallback;
    if (!Array.isArray(week) || week.length !== 7) throw new Error('not a week');
    return describe(week);
  } catch (err) {
    console.warn(`[hours] using the built-in line: ${(err as Error).message}`);
    return fallback;
  }
}

/** Runs of consecutive days (Monday first) that share the same hours. */
function runs(week: Day[]) {
  const out: { days: number[]; open: string; close: string }[] = [];
  for (const i of ORDER) {
    const d = week[i];
    if (!d) continue;
    const last = out.at(-1);
    const prev = last?.days.at(-1);
    const adjacent = prev !== undefined && ORDER.indexOf(prev) === ORDER.indexOf(i) - 1;
    if (last && adjacent && last.open === d.open && last.close === d.close) last.days.push(i);
    else out.push({ days: [i], open: d.open, close: d.close });
  }
  return out;
}

/** Runs with the same hours together, so "Monday to Friday and Sunday" reads as one. */
function sameHours<T extends { open: string; close: string }>(groups: T[]) {
  const by = new Map<string, T[]>();
  for (const g of groups) by.set(`${g.open}-${g.close}`, [...(by.get(`${g.open}-${g.close}`) ?? []), g]);
  return [...by.values()];
}

function clock(t: string) {
  const [h, m] = t.split(':').map(Number) as [number, number];
  const hour = h % 12 || 12;
  return `${hour}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

function span(days: number[]) {
  const first = DAYS[days[0]!]!;
  if (days.length === 1) return first;
  return `${first}${days.length === 2 ? ' and ' : ' to '}${DAYS[days.at(-1)!]!}`;
}

export function describe(week: Day[]): Hours {
  const groups = runs(week);
  if (!groups.length) return { line: 'By appointment', spec: [] };
  const allWeek = groups.length === 1 && groups[0]!.days.length === 7;
  const line = allWeek
    ? `Seven days a week, ${clock(groups[0]!.open)} to ${clock(groups[0]!.close)}`
    : sameHours(groups)
        .map((gs) => `${gs.map((g) => span(g.days)).join(' and ')}, ${clock(gs[0]!.open)} to ${clock(gs[0]!.close)}`)
        .join('; ');
  const spec = groups.map((g) => ({
    '@type': 'OpeningHoursSpecification' as const,
    dayOfWeek: g.days.map((i) => DAYS[i]!),
    opens: g.open,
    closes: g.close,
  }));
  return { line, spec };
}
