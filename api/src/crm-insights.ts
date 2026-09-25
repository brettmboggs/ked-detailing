import { Hono } from 'hono';
import { defaultConfig, findZone, type PricingConfig } from '@ked/pricing';
import { addDays, defaultRules, localDate, weekday, zonedToUtc, type BookingRules } from '@ked/scheduling';
import type { AppEnv } from './app-env.ts';
import { requireOwner, type Owner } from './auth.ts';
import { SOURCES } from './attribution.ts';
import { STATS_CTE, type Segment } from './crm-segments.ts';
import { ApiError, json, list, now, text, ulid, type Bindings } from './lib.ts';

/**
 * Metrics and marketing insights, and the weekly AI summary. Mounted at
 * /v1/crm/insights. See docs/crm.md: every number comes with what to do about
 * it, so the response ends in `actions`, a ranked list of plain next steps.
 *
 * Everything for a period is read in one D1 batch of nine statements, whatever
 * the size of the history, so the free plan's 50-queries cap is never close.
 * A job's value is its final price, else the quoted total; only done jobs
 * count as revenue (see crm-segments.ts).
 */
export const insights = new Hono<AppEnv>();
insights.use('*', requireOwner);

// TENANT: time zone, and the St. Louis ZIP table and home base below, are this business's.
const TZ = 'America/Chicago';
const who = (o: Owner) => o.email ?? o.subject;

/* ------------------------------------------------------------ places */

/**
 * St. Louis area ZIPs: the town people call it, and a rough centre point, so
 * insights can say "Oakville, about 9 miles" and find the neighbours of a good
 * ZIP. Distances are straight lines from High Ridge (63049), where Jacob is.
 */
const ZIPS: Record<string, [string, number, number]> = {
  '63005': ['Chesterfield', 38.64, -90.65], '63010': ['Arnold', 38.43, -90.38], '63011': ['Ballwin', 38.6, -90.56],
  '63012': ['Barnhart', 38.34, -90.4], '63015': ['Catawissa', 38.4, -90.76], '63016': ['Cedar Hill', 38.35, -90.64],
  '63017': ['Chesterfield', 38.65, -90.57], '63019': ['Crystal City', 38.23, -90.38], '63020': ['De Soto', 38.14, -90.56],
  '63021': ['Ballwin', 38.57, -90.54], '63023': ['Dittmer', 38.29, -90.68], '63025': ['Eureka', 38.5, -90.63],
  '63026': ['Fenton', 38.51, -90.44], '63028': ['Festus', 38.22, -90.4], '63031': ['Florissant', 38.81, -90.34],
  '63033': ['Florissant', 38.8, -90.28], '63034': ['Florissant', 38.85, -90.29], '63038': ['Wildwood', 38.58, -90.66],
  '63039': ['Gray Summit', 38.49, -90.83], '63040': ['Wildwood', 38.57, -90.63], '63042': ['Hazelwood', 38.78, -90.36],
  '63043': ['Maryland Heights', 38.72, -90.46], '63044': ['Bridgeton', 38.75, -90.42], '63048': ['Herculaneum', 38.26, -90.39],
  '63049': ['High Ridge', 38.46, -90.53], '63050': ['Hillsboro', 38.23, -90.56], '63051': ['House Springs', 38.41, -90.57],
  '63052': ['Imperial', 38.37, -90.38], '63053': ['Kimmswick', 38.37, -90.36], '63069': ['Pacific', 38.48, -90.74],
  '63070': ['Pevely', 38.28, -90.4], '63074': ['St. Ann', 38.73, -90.39], '63088': ['Valley Park', 38.55, -90.49],
  '63089': ['Villa Ridge', 38.47, -90.88], '63090': ['Washington', 38.55, -91.01], '63101': ['Downtown St. Louis', 38.63, -90.19],
  '63102': ['Downtown St. Louis', 38.63, -90.19], '63103': ['Downtown West', 38.63, -90.22], '63104': ['Soulard', 38.61, -90.21],
  '63105': ['Clayton', 38.65, -90.33], '63106': ['Near North Side', 38.64, -90.2], '63107': ['Hyde Park', 38.66, -90.21],
  '63108': ['Central West End', 38.64, -90.25], '63109': ['St. Louis Hills', 38.58, -90.3], '63110': ['The Hill', 38.62, -90.26],
  '63111': ['Carondelet', 38.56, -90.25], '63112': ['West End', 38.66, -90.28], '63113': ['The Ville', 38.66, -90.22],
  '63114': ['Overland', 38.7, -90.36], '63115': ['North St. Louis', 38.68, -90.24], '63116': ['Bevo', 38.58, -90.26],
  '63117': ['Richmond Heights', 38.63, -90.33], '63118': ['Tower Grove', 38.59, -90.23], '63119': ['Webster Groves', 38.59, -90.35],
  '63120': ['North St. Louis', 38.69, -90.26], '63121': ['Normandy', 38.71, -90.3], '63122': ['Kirkwood', 38.58, -90.42],
  '63123': ['Affton', 38.55, -90.33], '63124': ['Ladue', 38.64, -90.38], '63125': ['Lemay', 38.52, -90.29],
  '63126': ['Crestwood', 38.55, -90.38], '63127': ['Sunset Hills', 38.54, -90.41], '63128': ['Sappington', 38.49, -90.38],
  '63129': ['Oakville', 38.46, -90.32], '63130': ['University City', 38.66, -90.32], '63131': ['Des Peres', 38.62, -90.45],
  '63132': ['Olivette', 38.67, -90.37], '63133': ['Pagedale', 38.68, -90.3], '63134': ['Berkeley', 38.74, -90.34],
  '63135': ['Ferguson', 38.75, -90.3], '63136': ['Jennings', 38.74, -90.26], '63137': ['Bellefontaine Neighbors', 38.75, -90.21],
  '63138': ['Spanish Lake', 38.8, -90.21], '63139': ['Southampton', 38.61, -90.29], '63141': ['Creve Coeur', 38.66, -90.46],
  '63143': ['Maplewood', 38.61, -90.32], '63144': ['Brentwood', 38.62, -90.35], '63146': ['Maryland Heights', 38.69, -90.47],
  '63147': ['Baden', 38.69, -90.22], '63301': ['St. Charles', 38.8, -90.48], '63303': ['St. Charles', 38.75, -90.54],
  '63304': ['St. Charles', 38.72, -90.62], '63366': ["O'Fallon", 38.8, -90.72], '63367': ['Lake St. Louis', 38.79, -90.78],
  '63368': ["O'Fallon", 38.75, -90.73], '63376': ['St. Peters', 38.78, -90.61],
};
const HOME = ZIPS['63049']!;

function milesBetween(a: [string, number, number], b: [string, number, number]) {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[2] - a[2]) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 3959 * 2 * Math.asin(Math.sqrt(s));
}
const place = (zip: string | null) => (zip ? ZIPS[zip.slice(0, 5)] : undefined);
const milesFromHome = (zip: string | null) => {
  const p = place(zip);
  return p ? Math.round(milesBetween(HOME, p)) : null;
};

export const SOURCE_LABELS: Record<string, string> = {
  google: 'Google search',
  maps: 'Google Maps',
  instagram: 'Instagram',
  facebook: 'Facebook',
  nextdoor: 'Nextdoor',
  referral: 'Friends and family',
  van: 'The van or a sign',
  repeat: 'Came back on their own',
  other: 'Other',
  unknown: "Didn't say",
};

/* ------------------------------------------------------------ period */

export interface Period {
  from: string;
  to: string;
  /** The same number of days just before, or null when not comparing. */
  prev: { from: string; to: string } | null;
}

const isDay = (v: string | undefined) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);

/** from/to as YYYY-MM-DD in Jacob's time zone. Default: the last 90 days. */
export function readPeriod(q: { from?: string; to?: string; compare?: string }, today = localDate(new Date(), TZ)): Period {
  const to = q.to ?? today;
  const from = q.from ?? addDays(to, -89);
  if (!isDay(from) || !isDay(to)) throw new ApiError(422, 'invalid', 'from and to must be dates like 2026-09-01.');
  if (from > to) throw new ApiError(422, 'invalid', 'The start date must be before the end date.');
  const span = daysBetween(from, to) + 1;
  if (span > 3 * 366) throw new ApiError(422, 'invalid', 'Pick three years or less.');
  if (q.compare === '0' || q.compare === 'false') return { from, to, prev: null };
  // From the 1st (a month or more, or this month so far): the same dates whole months back (September 1-25
  // against August 1-25, 2020 against 2019). Otherwise the same number of days just before.
  if (from.endsWith('-01') && (span >= 28 || (span > 7 && to.slice(0, 7) === from.slice(0, 7)))) {
    // The year so far is compared with the same dates last year.
    const yearSoFar = from.endsWith('-01-01') && to.slice(0, 4) === from.slice(0, 4);
    const months = yearSoFar ? 12 : (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7)) + 1;
    return { from, to, prev: { from: monthsBack(from, months), to: monthsBack(to, months) } };
  }
  return { from, to, prev: { from: addDays(from, -span), to: addDays(from, -1) } };
}

/** The same day n months earlier, or that month's last day when it's shorter. */
function monthsBack(date: string, n: number) {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = y * 12 + (m - 1) - n;
  const yy = Math.floor(t / 12);
  const mm = (t % 12) + 1;
  const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  // The last day of a month maps to the last day of the other month.
  const lastHere = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dd = d === lastHere ? last : Math.min(d, last);
  return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/* ------------------------------------------------------------ types */

interface Totals {
  revenue: number;
  jobs: number;
  avgTicket: number | null;
  workDays: number;
  perDay: number | null;
  hours: number;
  perHour: number | null;
  addonRate: number | null;
  customers: number;
  cancelled: number;
  cancelledByCustomer: number;
  cancelledValue: number;
  cancelRate: number | null;
  online: number;
  phone: number;
}

interface Books {
  hasBooks: boolean;
  collected: number;
  tips: number;
  expenses: number;
  advertising: number;
  profit: number;
}

export type ActionType = 'reviews' | 'rebook' | 'area' | 'pricing' | 'schedule' | 'channel' | 'referral' | 'upsell' | 'leads';

export interface Action {
  id: string;
  type: ActionType;
  /** The step, in plain words. */
  title: string;
  /** The number behind it. */
  detail: string;
  /** Dollars it could be worth, in cents, when there's an honest estimate. */
  impact: number | null;
  impactNote: string | null;
  /** Where the button goes: an admin tab, and a customer segment when the step is about a group. */
  target: { tab: string; label: string; segment?: Segment };
}

interface CustomerRow {
  id: string;
  name: string;
  source: string | null;
  referred_by: string | null;
  visits: number;
  spend: number;
  first_visit: string | null;
  last_visit: string | null;
  next_visit: string | null;
  zip: string | null;
  referrals: number;
  cur_spend: number;
  cur_visits: number;
  prev_spend: number;
  avg_gap: number | null;
  second_visit: string | null;
}

/* ------------------------------------------------------------ queries */

const JV = `jv AS (
    SELECT j.id, j.customer_id, j.status, j.source, j.service, j.zip, j.local_date, j.created_at, j.cancelled_by, j.quote,
      COALESCE(j.final_price, CAST(json_extract(j.quote, '$.total') AS INTEGER), 0) AS value,
      json_extract(j.quote, '$.hours[1]') IS NOT NULL AS has_hours,
      (COALESCE(json_extract(j.quote, '$.hours[0]'), 0) + COALESCE(json_extract(j.quote, '$.hours[1]'), 0)) / 2.0 AS hours,
      COALESCE(json_array_length(j.input, '$.addOns'), 0) AS addons,
      json_extract(j.input, '$.vehicleClass') AS vclass,
      CASE WHEN j.local_date BETWEEN ?2 AND ?3 THEN 'cur' WHEN j.local_date BETWEEN ?4 AND ?5 THEN 'prev' END AS p
    FROM jobs j
  )`;

/**
 * Reads every number for a period. Binds: ?1 now (ISO), ?2/?3 the period,
 * ?4/?5 the one before (a never-matching range when not comparing), ?6 today,
 * ?7 today + 29, ?8/?9 the period as instants, ?10 the previous start as an
 * instant, ?11 to ?13 the window for time off, ?12 60 days ago as an instant.
 */
function statements(db: D1Database, p: Period, today: string, at: Date) {
  const inst = (d: string) => zonedToUtc(d, '00:00', TZ).toISOString();
  // Not comparing: a range no job can fall in.
  const prev = p.prev ?? { from: '9999-12-31', to: '9999-12-31' };
  const binds = [
    at.toISOString(), p.from, p.to, prev.from, prev.to, today, addDays(today, 29),
    inst(p.from), inst(addDays(p.to, 1)), p.prev ? inst(p.prev.from) : inst(p.from),
    inst(p.from < today ? p.from : today), new Date(at.getTime() - 60 * 864e5).toISOString(), inst(addDays(today, 31)),
  ];
  // D1 wants exactly as many values as the highest ?N a statement uses.
  const q = (sql: string) => db.prepare(sql).bind(...binds.slice(0, Math.max(...[...sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1])))));
  // A lead booked if it was marked booked, or the person has a live job made after it.
  const bookedLead = `(l.status = 'booked' OR EXISTS (SELECT 1 FROM jobs b WHERE b.customer_id = l.customer_id AND b.created_at >= l.created_at AND b.status != 'cancelled'))`;
  return [
    // 0: totals for this period and the one before.
    q(`WITH ${JV}
       SELECT p,
         COUNT(*) FILTER (WHERE status = 'done') AS jobs,
         COALESCE(SUM(value) FILTER (WHERE status = 'done'), 0) AS revenue,
         COUNT(DISTINCT CASE WHEN status = 'done' THEN local_date END) AS days,
         COALESCE(SUM(hours) FILTER (WHERE status = 'done' AND has_hours), 0) AS hours,
         COALESCE(SUM(value) FILTER (WHERE status = 'done' AND has_hours), 0) AS hours_revenue,
         COUNT(*) FILTER (WHERE status = 'done' AND service != 'imported') AS priced_jobs,
         COUNT(*) FILTER (WHERE status = 'done' AND service != 'imported' AND addons > 0) AS addon_jobs,
         COUNT(DISTINCT CASE WHEN status = 'done' THEN customer_id END) AS customers,
         COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled,
         COUNT(*) FILTER (WHERE status = 'cancelled' AND cancelled_by = 'customer') AS cancelled_by_customer,
         COALESCE(SUM(value) FILTER (WHERE status = 'cancelled'), 0) AS cancelled_value,
         COUNT(*) FILTER (WHERE status != 'cancelled' AND source = 'web') AS online,
         COUNT(*) FILTER (WHERE status != 'cancelled' AND source = 'app') AS phone
       FROM jv WHERE p IS NOT NULL GROUP BY p`),
    // 1: every month of history, for the trend and the seasons.
    q(`WITH ${JV}
       SELECT substr(local_date, 1, 7) AS month, COUNT(*) AS jobs, SUM(value) AS revenue
       FROM jv WHERE status = 'done' AND local_date <= ?6 GROUP BY month ORDER BY month`),
    // 2: breakdowns (k says which), done jobs only.
    q(`WITH ${JV}
       SELECT 'service' AS k, p, service AS a, vclass AS b, COUNT(*) AS n, SUM(value) AS v, SUM(addons > 0) AS x, SUM(hours) AS h
         FROM jv WHERE p IS NOT NULL AND status = 'done' GROUP BY p, service, vclass
       UNION ALL
       SELECT 'weekday', p, CAST(strftime('%w', local_date) AS INTEGER), NULL, COUNT(*), SUM(value), COUNT(DISTINCT local_date), SUM(hours)
         FROM jv WHERE p = 'cur' AND status != 'cancelled' GROUP BY 3
       UNION ALL
       SELECT 'zip', p, substr(zip, 1, 5), NULL, COUNT(*), SUM(value), COUNT(DISTINCT customer_id), SUM(hours) FILTER (WHERE has_hours)
         FROM jv WHERE p = 'cur' AND status = 'done' AND zip IS NOT NULL GROUP BY 3
       UNION ALL
       SELECT 'line', p, json_extract(l.value, '$.label'), service, COUNT(*), SUM(json_extract(l.value, '$.amount')), NULL, NULL
         FROM jv, json_each(jv.quote, '$.lines') l WHERE p = 'cur' AND status = 'done' GROUP BY 3, 4`),
    // 3: every customer with their lifetime numbers, this period's spend and how often they come.
    q(`WITH ${STATS_CTE}, ${JV},
       per AS (
         SELECT customer_id,
           COALESCE(SUM(value) FILTER (WHERE p = 'cur'), 0) AS cur_spend,
           COUNT(*) FILTER (WHERE p = 'cur') AS cur_visits,
           COALESCE(SUM(value) FILTER (WHERE p = 'prev'), 0) AS prev_spend
         FROM jv WHERE status = 'done' GROUP BY customer_id
       ),
       days AS (SELECT DISTINCT customer_id, local_date FROM jobs WHERE status = 'done'),
       seq AS (
         SELECT customer_id, local_date,
           LAG(local_date) OVER (PARTITION BY customer_id ORDER BY local_date) AS before,
           ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY local_date) AS n
         FROM days
       ),
       gaps AS (
         SELECT customer_id, AVG(julianday(local_date) - julianday(before)) AS avg_gap,
           MIN(CASE WHEN n = 2 THEN local_date END) AS second_visit
         FROM seq GROUP BY customer_id
       )
       SELECT c.id, c.name, c.source, c.referred_by, s.visits, s.spend, s.first_visit, s.last_visit, s.next_visit, s.zip, s.referrals,
         COALESCE(per.cur_spend, 0) AS cur_spend, COALESCE(per.cur_visits, 0) AS cur_visits, COALESCE(per.prev_spend, 0) AS prev_spend,
         g.avg_gap, g.second_visit
       FROM customers c JOIN stats s ON s.customer_id = c.id
       LEFT JOIN per ON per.customer_id = c.id LEFT JOIN gaps g ON g.customer_id = c.id`),
    // 4: quote requests by where they came from, and how many booked.
    q(`SELECT l.p, COALESCE(l.source, c.source, 'unknown') AS source, COUNT(*) AS n, SUM(${bookedLead}) AS booked
       FROM (SELECT *, CASE WHEN created_at >= ?8 AND created_at < ?9 THEN 'cur' WHEN created_at >= ?10 AND created_at < ?8 THEN 'prev' END AS p FROM leads) l
       LEFT JOIN customers c ON c.id = l.customer_id
       WHERE l.p IS NOT NULL GROUP BY l.p, 2`),
    // 5: what's ahead: booked jobs by day for 30 days, open quote requests, time off.
    q(`WITH ${JV}
       SELECT 'ahead' AS k, local_date AS a, NULL AS b, COUNT(*) AS n, SUM(value) AS v, SUM(hours) AS h
         FROM jv WHERE status IN ('scheduled', 'in_progress') AND local_date BETWEEN ?6 AND ?7 GROUP BY local_date
       UNION ALL
       SELECT 'quotes', MIN(l.created_at), NULL, COUNT(*), SUM(json_extract(l.quote, '$.total')), NULL
         FROM leads l WHERE l.status IN ('new', 'contacted') AND l.created_at >= ?12 AND NOT ${bookedLead}
       UNION ALL
       SELECT 'off', start_at, end_at, NULL, NULL, NULL FROM time_off WHERE end_at > ?11 AND start_at < MAX(?13, ?9)
       UNION ALL
       SELECT 'booked', p, NULL, COUNT(*), NULL, SUM(hours) FROM jv WHERE p = 'cur' AND status != 'cancelled' GROUP BY p`),
    // 6: the books: money in and out by category.
    q(`SELECT e.p, a.id, a.type, SUM(l.amount) AS amount
       FROM (SELECT id, CASE WHEN date BETWEEN ?2 AND ?3 THEN 'cur' WHEN date BETWEEN ?4 AND ?5 THEN 'prev' END AS p FROM entries) e
       JOIN entry_lines l ON l.entry_id = e.id JOIN accounts a ON a.id = l.account_id
       WHERE e.p IS NOT NULL AND a.type IN ('income', 'expense') GROUP BY e.p, a.id`),
    // 7: marketing spend in the months the two periods touch.
    q(`SELECT * FROM marketing_spend WHERE month BETWEEN substr(MIN(?2, ?4), 1, 7) AND substr(?3, 1, 7) ORDER BY month DESC, id DESC`),
    // 8: prices (for add-on names and boats) and booking rules (for open hours).
    db.prepare(
      `SELECT 'pricing' AS k, (SELECT config FROM pricing_configs ORDER BY version DESC LIMIT 1) AS v
       UNION ALL SELECT 'booking', (SELECT value FROM settings WHERE key = 'booking')`,
    ),
  ];
}

/* ------------------------------------------------------------ helpers */

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
const avg = (a: number, b: number) => (b > 0 ? Math.round(a / b) : null);
const usd = (c: number) => `$${Math.round(c / 100).toLocaleString('en-US')}`;
const pct = (r: number) => `${Math.round(r * 100)}%`;
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;
const monthName = (m: number) => ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1]!;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Hours open on a day by the booking rules, less any time off inside them. */
function openHours(date: string, rules: BookingRules, off: { start: number; end: number }[]) {
  const h = rules.week[weekday(date)];
  if (!h) return 0;
  const open = zonedToUtc(date, h.open, rules.timezone).getTime();
  const close = zonedToUtc(date, h.close, rules.timezone).getTime();
  let ms = close - open;
  for (const o of off) ms -= Math.max(0, Math.min(close, o.end) - Math.max(open, o.start));
  return Math.max(0, ms / 36e5);
}

function* eachDay(from: string, to: string) {
  for (let d = from; d <= to; d = addDays(d, 1)) yield d;
}

/* ------------------------------------------------------------ compute */

export async function computeInsights(db: D1Database, period: Period, at = new Date()) {
  const today = localDate(at, TZ);
  const rs = await db.batch<Record<string, any>>(statements(db, period, today, at));
  const [totalsR, monthsR, breakR, custR, leadsR, aheadR, booksR, spendR, cfgR] = rs.map((r) => r.results);

  const cfgRows = new Map(cfgR!.map((r) => [r.k as string, r.v as string | null]));
  const config: PricingConfig = cfgRows.get('pricing') ? JSON.parse(cfgRows.get('pricing')!) : defaultConfig;
  const rules: BookingRules = cfgRows.get('booking') ? JSON.parse(cfgRows.get('booking')!) : defaultRules;
  const serviceById = new Map(config.services.map((s) => [s.id, s]));
  const addOnByLabel = new Map(config.addOns.map((a) => [a.label, a]));
  const classById = new Map(config.vehicleClasses.map((c) => [c.id, c]));

  /* ---- money */
  const totals = (p: 'cur' | 'prev'): Totals | null => {
    if (p === 'prev' && !period.prev) return null;
    const r = totalsR!.find((x) => x.p === p) ?? {};
    const n = (k: string) => Number(r[k] ?? 0);
    return {
      revenue: n('revenue'),
      jobs: n('jobs'),
      avgTicket: avg(n('revenue'), n('jobs')),
      workDays: n('days'),
      perDay: avg(n('revenue'), n('days')),
      hours: Math.round(n('hours') * 10) / 10,
      perHour: avg(n('hours_revenue'), n('hours')),
      addonRate: ratio(n('addon_jobs'), n('priced_jobs')),
      customers: n('customers'),
      cancelled: n('cancelled'),
      cancelledByCustomer: n('cancelled_by_customer'),
      cancelledValue: n('cancelled_value'),
      cancelRate: ratio(n('cancelled'), n('cancelled') + n('jobs')),
      online: n('online'),
      phone: n('phone'),
    };
  };
  const cur = totals('cur')!;
  const prev = totals('prev');

  // Months from the first job to this one, gaps filled with zero.
  const monthRows = new Map(monthsR!.map((r) => [r.month as string, { jobs: Number(r.jobs), revenue: Number(r.revenue) }]));
  const byMonth: { month: string; jobs: number; revenue: number }[] = [];
  if (monthsR!.length) {
    const thisMonth = today.slice(0, 7);
    for (let m = monthsR![0]!.month as string; m <= thisMonth; ) {
      byMonth.push({ month: m, ...(monthRows.get(m) ?? { jobs: 0, revenue: 0 }) });
      const [y, mm] = m.split('-').map(Number) as [number, number];
      m = mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, '0')}`;
    }
  }
  // Seasons: each calendar month's average over the full months on record.
  const full = byMonth.filter((m) => m.month < today.slice(0, 7));
  const seasonality = Array.from({ length: 12 }, (_, i) => {
    const ms = full.filter((m) => Number(m.month.slice(5)) === i + 1);
    return { month: i + 1, years: ms.length, avgRevenue: ms.length ? Math.round(ms.reduce((s, m) => s + m.revenue, 0) / ms.length) : null };
  });
  const seasonsKnown = full.length >= 12;
  const monthAvg = full.length ? full.reduce((s, m) => s + m.revenue, 0) / full.length : 0;

  const breaks = (k: string, p = 'cur') => breakR!.filter((r) => r.k === k && r.p === p);

  // Open days per weekday in the period, for how full each weekday was.
  const offRows = aheadR!.filter((r) => r.k === 'off').map((r) => ({ start: Date.parse(r.a), end: Date.parse(r.b) }));
  const periodOpen = { days: [0, 0, 0, 0, 0, 0, 0], hours: 0 };
  for (const d of eachDay(period.from, period.to)) {
    const h = openHours(d, rules, offRows);
    if (h > 0) {
      periodOpen.days[weekday(d)]!++;
      periodOpen.hours += h;
    }
  }
  const weekdays = DAY_NAMES.map((name, day) => {
    const r = breaks('weekday').find((x) => Number(x.a) === day);
    const jobs = Number(r?.n ?? 0);
    const openDays = periodOpen.days[day]!;
    return {
      day, name, jobs, revenue: Number(r?.v ?? 0), openDays, closed: !rules.week[day],
      jobsPerDay: openDays ? Math.round((jobs / openDays) * 10) / 10 : null,
      fill: openDays ? Math.min(1, jobs / (openDays * rules.maxJobsPerDay)) : null,
    };
  });

  const serviceRows = (p: string) => {
    const m = new Map<string, { jobs: number; revenue: number; addonJobs: number; hours: number }>();
    for (const r of breaks('service', p)) {
      const s = m.get(r.a) ?? { jobs: 0, revenue: 0, addonJobs: 0, hours: 0 };
      s.jobs += Number(r.n); s.revenue += Number(r.v); s.addonJobs += Number(r.x); s.hours += Number(r.h ?? 0);
      m.set(r.a, s);
    }
    return m;
  };
  const curServices = serviceRows('cur');
  const services = [...curServices]
    .map(([id, s]) => ({
      service: id,
      name: id === 'imported' ? 'Imported history' : serviceById.get(id)?.name ?? id,
      level: serviceById.get(id)?.level ?? '',
      craft: serviceById.get(id)?.craft ?? 'vehicle',
      jobs: s.jobs,
      revenue: s.revenue,
      share: ratio(s.revenue, cur.revenue),
      avgTicket: avg(s.revenue, s.jobs),
      addonJobs: s.addonJobs,
      addonRate: id === 'imported' ? null : ratio(s.addonJobs, s.jobs),
    }))
    .sort((a, b) => b.revenue - a.revenue);
  const craftSplit = (m: Map<string, { jobs: number; revenue: number }>) => {
    const out = { boats: { jobs: 0, revenue: 0 }, cars: { jobs: 0, revenue: 0 } };
    for (const [id, s] of m) {
      const k = serviceById.get(id)?.craft === 'boat' ? 'boats' : 'cars';
      out[k].jobs += s.jobs; out[k].revenue += s.revenue;
    }
    return out;
  };
  const sizes = new Map<string, { jobs: number; revenue: number }>();
  for (const r of breaks('service')) {
    if (serviceById.get(r.a)?.craft === 'boat' || r.a === 'imported') continue;
    const k = r.b ?? 'unknown';
    const s = sizes.get(k) ?? { jobs: 0, revenue: 0 };
    s.jobs += Number(r.n); s.revenue += Number(r.v);
    sizes.set(k, s);
  }
  const addOnRows = new Map<string, { jobs: number; revenue: number; services: Map<string, number> }>();
  for (const r of breaks('line')) {
    if (!addOnByLabel.has(r.a)) continue;
    const s = addOnRows.get(r.a) ?? { jobs: 0, revenue: 0, services: new Map() };
    s.jobs += Number(r.n); s.revenue += Number(r.v);
    s.services.set(r.b, (s.services.get(r.b) ?? 0) + Number(r.n));
    addOnRows.set(r.a, s);
  }
  const addOns = [...addOnRows]
    .map(([label, s]) => ({ id: addOnByLabel.get(label)!.id, label, jobs: s.jobs, revenue: s.revenue, rate: ratio(s.jobs, cur.jobs) }))
    .sort((a, b) => b.jobs - a.jobs);

  const books = (p: string): Books | null => {
    if (p === 'prev' && !period.prev) return null;
    const rows = booksR!.filter((r) => r.p === p);
    const income = rows.filter((r) => r.type === 'income').reduce((s, r) => s - Number(r.amount), 0);
    const tips = -Number(rows.find((r) => r.id === 'income-tips')?.amount ?? 0);
    const expenses = rows.filter((r) => r.type === 'expense').reduce((s, r) => s + Number(r.amount), 0);
    const advertising = Number(rows.find((r) => r.id === 'advertising')?.amount ?? 0);
    return { hasBooks: rows.length > 0, collected: income, tips, expenses, advertising, profit: income - expenses };
  };

  /* ---- customers */
  const people = custR as unknown as CustomerRow[];
  const byId = new Map(people.map((c) => [c.id, c]));
  const paying = people.filter((c) => c.visits > 0);
  const inPeriod = (d: string | null, p = period) => !!d && d >= p.from && d <= p.to;
  const newCur = paying.filter((c) => inPeriod(c.first_visit));
  const newPrev = period.prev ? paying.filter((c) => inPeriod(c.first_visit, period.prev as Period)).length : null;
  const repeat = paying.filter((c) => c.visits >= 2);
  const lifetimeRevenue = paying.reduce((s, c) => s + c.spend, 0);
  const backWithin = (days: number) => {
    const cutoff = addDays(today, -days);
    const base = paying.filter((c) => c.first_visit! <= cutoff);
    const back = base.filter((c) => c.second_visit && daysBetween(c.first_visit!, c.second_visit) <= days);
    return { base: base.length, back: back.length, rate: ratio(back.length, base.length) };
  };
  const gapCustomers = paying.filter((c) => c.avg_gap !== null && c.avg_gap > 0);
  const avgGap = gapCustomers.length ? Math.round(gapCustomers.reduce((s, c) => s + c.avg_gap!, 0) / gapCustomers.length) : null;
  const lapsedCut = addDays(today, -180);
  const lapsed = paying.filter((c) => !c.next_visit && c.last_visit! < lapsedCut);
  const overdue = repeat.filter((c) => {
    if (c.next_visit || !c.avg_gap || c.avg_gap < 14 || c.last_visit! < lapsedCut) return false;
    return daysBetween(c.last_visit!, today) > c.avg_gap * 1.25;
  });
  const ticketOf = (c: CustomerRow) => Math.round(c.spend / Math.max(1, c.visits));

  const spenders = paying.filter((c) => c.cur_spend > 0).sort((a, b) => b.cur_spend - a.cur_spend);
  const top20Count = Math.ceil(spenders.length * 0.2);
  const top20Revenue = spenders.slice(0, top20Count).reduce((s, c) => s + c.cur_spend, 0);
  const periodCustomerRevenue = spenders.reduce((s, c) => s + c.cur_spend, 0);
  const top = spenders.slice(0, 10).map((c) => ({
    id: c.id, name: c.name, spend: c.cur_spend, visits: c.cur_visits, lifetimeSpend: c.spend, lifetimeVisits: c.visits,
    lastVisit: c.last_visit, nextVisit: c.next_visit, source: c.source ?? 'unknown', zip: c.zip,
  }));

  // Cohorts: customers by the quarter of their first visit, last eight quarters.
  const quarterOf = (d: string) => `${d.slice(0, 4)} Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;
  const cohortMap = new Map<string, CustomerRow[]>();
  for (const c of paying) {
    if (c.first_visit! > period.to) continue;
    const q = quarterOf(c.first_visit!);
    cohortMap.set(q, [...(cohortMap.get(q) ?? []), c]);
  }
  const cohorts = [...cohortMap]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .slice(0, 8)
    .map(([quarter, cs]) => ({
      quarter,
      customers: cs.length,
      cameBack: cs.filter((c) => c.visits >= 2).length,
      rate: ratio(cs.filter((c) => c.visits >= 2).length, cs.length),
      avgSpend: avg(cs.reduce((s, c) => s + c.spend, 0), cs.length),
    }));

  /* ---- sources */
  const spendRows = spendR!.map((r) => ({ id: r.id as string, month: r.month as string, source: r.source as string, amount: Number(r.amount), note: r.note as string | null }));
  const spendIn = (p: { from: string; to: string }) => {
    // A month's spend is spread evenly over its days, so a period gets its share.
    const out = new Map<string, number>();
    for (const s of spendRows) {
      const first = `${s.month}-01`;
      const [y, m] = s.month.split('-').map(Number) as [number, number];
      const last = addDays(m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`, -1);
      const a = first > p.from ? first : p.from;
      const b = last < p.to ? last : p.to;
      if (a > b) continue;
      const share = (daysBetween(a, b) + 1) / (daysBetween(first, last) + 1);
      out.set(s.source, (out.get(s.source) ?? 0) + s.amount * share);
    }
    return new Map([...out].map(([k, v]) => [k, Math.round(v)]));
  };
  const spendCur = spendIn(period);
  const leadRow = (p: string, src: string) => leadsR!.find((r) => r.p === p && r.source === src);
  const sourceKeys = new Set<string>([...SOURCES, 'unknown']);
  const sources = [...sourceKeys]
    .map((src) => {
      const cs = paying.filter((c) => (c.source ?? 'unknown') === src);
      const fresh = newCur.filter((c) => (c.source ?? 'unknown') === src);
      const leads = Number(leadRow('cur', src)?.n ?? 0);
      const booked = Number(leadRow('cur', src)?.booked ?? 0);
      const spend = spendCur.get(src) ?? 0;
      const freshValue = fresh.reduce((s, c) => s + c.spend, 0);
      return {
        source: src,
        label: SOURCE_LABELS[src] ?? src,
        leads,
        leadsBooked: booked,
        conversion: ratio(booked, leads),
        leadsPrev: period.prev ? Number(leadRow('prev', src)?.n ?? 0) : null,
        newCustomers: fresh.length,
        newCustomersPrev: period.prev ? paying.filter((c) => (c.source ?? 'unknown') === src && inPeriod(c.first_visit, period.prev as Period)).length : null,
        revenue: cs.reduce((s, c) => s + c.cur_spend, 0),
        customers: cs.length,
        avgLifetimeSpend: avg(cs.reduce((s, c) => s + c.spend, 0), cs.length),
        repeatRate: ratio(cs.filter((c) => c.visits >= 2).length, cs.length),
        spend,
        costPerLead: spend && leads ? Math.round(spend / leads) : null,
        costPerCustomer: spend && fresh.length ? Math.round(spend / fresh.length) : null,
        newCustomerValue: freshValue,
        returnOnSpend: spend ? Math.round((freshValue / spend) * 100) / 100 : null,
      };
    })
    .filter((s) => s.leads || s.customers || s.spend || s.revenue)
    .sort((a, b) => b.revenue - a.revenue || b.customers - a.customers);
  const leadTotals = (p: string) => ({
    leads: leadsR!.filter((r) => r.p === p).reduce((s, r) => s + Number(r.n), 0),
    booked: leadsR!.filter((r) => r.p === p).reduce((s, r) => s + Number(r.booked), 0),
  });
  const leadsCur = leadTotals('cur');
  const leadsPrev = period.prev ? leadTotals('prev') : null;

  const referredValue = new Map<string, number>();
  for (const c of people) if (c.referred_by) referredValue.set(c.referred_by, (referredValue.get(c.referred_by) ?? 0) + c.spend);
  const referrers = people
    .filter((c) => c.referrals > 0)
    .map((c) => ({ id: c.id, name: c.name, referrals: c.referrals, referredRevenue: referredValue.get(c.id) ?? 0 }))
    .sort((a, b) => b.referrals - a.referrals || b.referredRevenue - a.referredRevenue)
    .slice(0, 10);

  /* ---- where */
  const zipLife = new Map<string, CustomerRow[]>();
  for (const c of paying) {
    const z = c.zip?.slice(0, 5);
    if (z && /^\d{5}$/.test(z)) zipLife.set(z, [...(zipLife.get(z) ?? []), c]);
  }
  const zipPeriod = new Map(breaks('zip').map((r) => [r.a as string, r]));
  const zips = [...new Set([...zipLife.keys(), ...zipPeriod.keys()])]
    .map((zip) => {
      const cs = zipLife.get(zip) ?? [];
      const pr = zipPeriod.get(zip);
      const visits = cs.reduce((s, c) => s + c.visits, 0);
      const zone = findZone(config, zip);
      const hours = Number(pr?.h ?? 0);
      return {
        zip,
        town: place(zip)?.[0] ?? null,
        miles: milesFromHome(zip),
        zone: zone?.label ?? null,
        travelFee: zone ? zone.fee : config.travel.outsideFee,
        customers: cs.length,
        repeatRate: ratio(cs.filter((c) => c.visits >= 2).length, cs.length),
        avgTicket: avg(cs.reduce((s, c) => s + c.spend, 0), visits),
        lifetimeRevenue: cs.reduce((s, c) => s + c.spend, 0),
        periodJobs: Number(pr?.n ?? 0),
        periodRevenue: Number(pr?.v ?? 0),
        perHour: hours ? Math.round(Number(pr?.v ?? 0) / hours) : null,
      };
    })
    .sort((a, b) => b.periodRevenue - a.periodRevenue || b.lifetimeRevenue - a.lifetimeRevenue);
  const townMap = new Map<string, { customers: number; revenue: number; visits: number; zips: string[] }>();
  for (const [zip, cs] of zipLife) {
    const town = place(zip)?.[0] ?? 'Other places';
    const t = townMap.get(town) ?? { customers: 0, revenue: 0, visits: 0, zips: [] };
    t.customers += cs.length; t.revenue += cs.reduce((s, c) => s + c.spend, 0); t.visits += cs.reduce((s, c) => s + c.visits, 0); t.zips.push(zip);
    townMap.set(town, t);
  }
  const towns = [...townMap].map(([town, t]) => ({ town, customers: t.customers, revenue: t.revenue, avgTicket: avg(t.revenue, t.visits), zips: t.zips.sort() }))
    .sort((a, b) => b.revenue - a.revenue);
  const overallTicket = avg(lifetimeRevenue, paying.reduce((s, c) => s + c.visits, 0));
  // Strong ZIPs: 3+ customers who pay at least the usual ticket. Their close
  // neighbours with hardly anyone yet are the next streets to try.
  const strong = zips.filter((z) => z.customers >= 3 && z.avgTicket !== null && overallTicket !== null && z.avgTicket >= overallTicket)
    .sort((a, b) => b.avgTicket! * b.customers - a.avgTicket! * a.customers);
  const nearby: { zip: string; town: string; miles: number | null; customers: number; near: string; nearMiles: number }[] = [];
  for (const s of strong.slice(0, 5)) {
    const sp = place(s.zip);
    if (!sp) continue;
    for (const [zip, p] of Object.entries(ZIPS)) {
      if (zip === s.zip || nearby.some((n) => n.zip === zip)) continue;
      const have = zipLife.get(zip)?.length ?? 0;
      const d = milesBetween(sp, p);
      if (have <= 1 && d <= 5) nearby.push({ zip, town: p[0], miles: milesFromHome(zip), customers: have, near: s.zip, nearMiles: Math.round(d * 10) / 10 });
    }
  }
  nearby.sort((a, b) => a.nearMiles - b.nearMiles);

  /* ---- pipeline */
  const aheadDays = new Map(aheadR!.filter((r) => r.k === 'ahead').map((r) => [r.a as string, r]));
  let next = { jobs: 0, revenue: 0, hours: 0, openHours: 0, openDays: 0, slots: 0 };
  const emptyDays: string[] = [];
  for (const d of eachDay(today, addDays(today, 29))) {
    const h = openHours(d, rules, offRows);
    const r = aheadDays.get(d);
    next.jobs += Number(r?.n ?? 0); next.revenue += Number(r?.v ?? 0); next.hours += Number(r?.h ?? 0);
    if (h > 0) {
      next.openHours += h; next.openDays++; next.slots += rules.maxJobsPerDay;
      if (!r && d > today && d <= addDays(today, 14)) emptyDays.push(d);
    }
  }
  next = { ...next, hours: Math.round(next.hours * 10) / 10, openHours: Math.round(next.openHours) };
  const quotes = aheadR!.find((r) => r.k === 'quotes');
  const bookedPeriod = aheadR!.find((r) => r.k === 'booked');
  const pipeline = {
    next30: { ...next, from: today, to: addDays(today, 29), use: ratio(next.jobs, next.slots), hoursUse: ratio(next.hours, next.openHours) },
    emptyDays,
    openQuotes: {
      count: Number(quotes?.n ?? 0),
      value: Number(quotes?.v ?? 0),
      oldestDays: quotes?.a ? Math.floor((at.getTime() - Date.parse(quotes.a)) / 864e5) : null,
    },
    period: {
      jobs: Number(bookedPeriod?.n ?? 0),
      hours: Math.round(Number(bookedPeriod?.h ?? 0) * 10) / 10,
      openHours: Math.round(periodOpen.hours),
      openDays: periodOpen.days.reduce((s, d) => s + d, 0),
      use: ratio(Number(bookedPeriod?.n ?? 0), periodOpen.days.reduce((s, d) => s + d, 0) * rules.maxJobsPerDay),
    },
    maxJobsPerDay: rules.maxJobsPerDay,
  };

  const booksCur = books('cur')!;
  const spendTotal = [...spendCur.values()].reduce((s, v) => s + v, 0);

  const result = {
    period: { from: period.from, to: period.to, days: daysBetween(period.from, period.to) + 1, compare: period.prev, today },
    money: {
      cur,
      prev,
      books: booksCur,
      booksPrev: books('prev'),
      byMonth,
      seasonality: seasonsKnown ? seasonality : null,
      weekdays,
      services,
      craft: craftSplit(curServices),
      craftPrev: period.prev ? craftSplit(serviceRows('prev')) : null,
      sizes: [...sizes].map(([id, s]) => ({ id, label: classById.get(id)?.label ?? 'Not recorded', jobs: s.jobs, revenue: s.revenue, avgTicket: avg(s.revenue, s.jobs) }))
        .sort((a, b) => b.revenue - a.revenue),
      addOns,
    },
    customers: {
      total: paying.length,
      leadsOnly: people.length - paying.length,
      new: newCur.length,
      newPrev,
      served: cur.customers,
      returning: cur.customers - newCur.filter((c) => c.cur_visits > 0).length,
      repeat: repeat.length,
      repeatRate: ratio(repeat.length, paying.length),
      back6: backWithin(183),
      back12: backWithin(365),
      avgVisits: paying.length ? Math.round((paying.reduce((s, c) => s + c.visits, 0) / paying.length) * 10) / 10 : null,
      lifetimeValue: avg(lifetimeRevenue, paying.length),
      avgDaysBetween: avgGap,
      lapsed: { count: lapsed.length, atRisk: lapsed.reduce((s, c) => s + ticketOf(c), 0), days: 180 },
      overdue: { count: overdue.length, value: overdue.reduce((s, c) => s + ticketOf(c), 0) },
      top,
      top20: { count: top20Count, of: spenders.length, revenue: top20Revenue, share: ratio(top20Revenue, periodCustomerRevenue) },
      cohorts,
    },
    sources,
    leads: { ...leadsCur, conversion: ratio(leadsCur.booked, leadsCur.leads), prev: leadsPrev },
    referrers,
    zips,
    towns,
    nearby: nearby.slice(0, 8),
    pipeline,
    spend: {
      rows: spendRows.filter((r) => r.month >= period.from.slice(0, 7) && r.month <= period.to.slice(0, 7)),
      total: spendTotal,
      booksAdvertising: booksCur.advertising,
      notSplit: Math.max(0, booksCur.advertising - spendTotal),
    },
    actions: [] as Action[],
  };
  result.actions = rankActions(result, { overdue, lapsed, strong, nearby, config, seasonality: seasonsKnown ? seasonality : null, monthAvg, today, byId });
  return result;
}

export type Insights = Awaited<ReturnType<typeof computeInsights>>;

/* ------------------------------------------------------------ actions */

/**
 * Fixed rules that turn the numbers into next steps. Each fires only when the
 * data behind it is big enough to trust, carries the number that triggered
 * it, and says what it's worth in dollars when there's an honest estimate.
 * Ranked by that estimate; steps without one go after.
 */
function rankActions(
  r: Omit<Insights, 'actions'> & { actions: Action[] },
  x: {
    overdue: CustomerRow[];
    lapsed: CustomerRow[];
    strong: Insights['zips'];
    nearby: Insights['nearby'];
    config: PricingConfig;
    seasonality: Insights['money']['seasonality'];
    monthAvg: number;
    today: string;
    byId: Map<string, CustomerRow>;
  },
): Action[] {
  const out: Action[] = [];
  const add = (a: Action) => out.push(a);
  const ticket = r.money.cur.avgTicket ?? (r.customers.lifetimeValue && r.customers.avgVisits ? Math.round(r.customers.lifetimeValue / r.customers.avgVisits) : null);
  // Too few bookings to trust the rate yet: assume half, and say so.
  const rateKnown = r.leads.booked >= 3 && r.leads.conversion !== null;
  const bookRate = rateKnown ? r.leads.conversion! : 0.5;

  // Quote requests nobody has answered.
  const q = r.pipeline.openQuotes;
  if (q.count > 0) {
    add({
      id: 'quotes', type: 'leads',
      title: `${q.count} quote ${q.count === 1 ? 'request is' : 'requests are'} waiting for an answer: call or text ${q.count === 1 ? 'them' : 'each one'} today`,
      detail: `Worth ${usd(q.value)} as quoted.${q.oldestDays ? ` The oldest is ${q.oldestDays} ${q.oldestDays === 1 ? 'day' : 'days'} old.` : ''} ${rateKnown ? `${pct(bookRate)} of your quote requests book.` : 'Too few have booked yet to know your rate, so this guesses half.'}`,
      impact: Math.round(q.value * bookRate), impactNote: 'if they book at your usual rate',
      target: { tab: 'leads', label: 'Open quote requests' },
    });
  }

  // Regulars past their usual gap.
  if (x.overdue.length) {
    const value = x.overdue.reduce((s, c) => s + Math.round(c.spend / c.visits), 0);
    add({
      id: 'overdue', type: 'rebook',
      title: `${x.overdue.length} ${x.overdue.length === 1 ? 'regular is' : 'regulars are'} overdue for their next detail: text them today`,
      detail: `They've gone longer than usual since their last visit and nothing is booked. Together they spend about ${usd(value)} a visit.`,
      impact: value, impactNote: 'if each books one visit',
      target: { tab: 'today', label: 'Open Today' },
    });
  }

  // Lapsed customers.
  if (x.lapsed.length >= 3) {
    const at = r.customers.lapsed.atRisk;
    add({
      id: 'lapsed', type: 'rebook',
      title: `${x.lapsed.length} customers haven't been back in 6 months: send them a come-back offer`,
      detail: `Each spent about ${usd(Math.round(at / x.lapsed.length))} a visit. If one in three comes back once, that's ${usd(Math.round(at / 3))}.`,
      impact: Math.round(at / 3), impactNote: 'if one in three comes back once',
      target: { tab: 'marketing', label: 'Send an offer', segment: { lifecycle: 'lapsed', lapsedDays: 180 } },
    });
  }

  // The channel whose customers are worth the most.
  const avgLife = r.customers.lifetimeValue;
  const worth = r.sources
    .filter((s) => !['repeat', 'other', 'unknown', 'referral'].includes(s.source) && s.customers >= 3 && s.avgLifetimeSpend !== null && avgLife)
    .sort((a, b) => b.avgLifetimeSpend! - a.avgLifetimeSpend!)[0];
  if (worth && avgLife && worth.avgLifetimeSpend! >= avgLife * 1.1) {
    const more = Math.round((worth.avgLifetimeSpend! / avgLife - 1) * 100);
    const booked = worth.leadsBooked ? ` and ${worth.leadsBooked} of ${worth.leads} quote requests booked` : '';
    const google = worth.source === 'maps' || worth.source === 'google';
    add({
      id: `channel-best-${worth.source}`, type: google ? 'reviews' : 'channel',
      title: google
        ? `${worth.label} customers spend ${more}% more than average${booked}: ask every happy customer for a Google review`
        : `${worth.label} customers spend ${more}% more than average${booked}: put more of your time there`,
      detail: `${worth.customers} customers from ${worth.label} have spent ${usd(worth.avgLifetimeSpend!)} each so far. The average customer: ${usd(avgLife)}.`,
      impact: worth.avgLifetimeSpend, impactNote: 'for each new customer it brings',
      target: { tab: 'marketing', label: google ? 'Ask for reviews' : 'Open Marketing' },
    });
  }

  // Channels that bring leads that don't book, or cost more than they bring.
  for (const s of r.sources) {
    if (['repeat', 'unknown'].includes(s.source)) continue;
    if (rateKnown && s.leads >= 5 && (s.conversion ?? 0) < Math.min(0.2, bookRate / 2)) {
      add({
        id: `channel-weak-${s.source}`, type: 'channel',
        title: `${s.label}: ${s.leads} quote requests, ${s.leadsBooked === 0 ? 'none' : `only ${s.leadsBooked}`} booked. ${s.spend ? 'Stop paying for it until it books' : 'Spend less time on it'}`,
        detail: `Across all channels, ${pct(bookRate)} of quote requests book.${s.spend ? ` You spent ${usd(s.spend)} on it in this period.` : ''}`,
        impact: s.spend || null, impactNote: s.spend ? 'saved' : null,
        target: { tab: 'insights', label: 'See sources' },
      });
    } else if (s.spend > 0 && ticket && (s.costPerCustomer === null || s.costPerCustomer > ticket)) {
      add({
        id: `channel-cost-${s.source}`, type: 'channel',
        title: s.newCustomers
          ? `${s.label} cost ${usd(s.costPerCustomer!)} for each new customer, more than a first job pays: cut it back`
          : `${s.label}: ${usd(s.spend)} spent, no new customers yet: pause it`,
        detail: `Your average job is ${usd(ticket)}. New customers from it have spent ${usd(s.newCustomerValue)} so far.`,
        impact: s.spend, impactNote: 'saved',
        target: { tab: 'insights', label: 'See marketing spend' },
      });
    }
  }

  // Where to market: the best ZIP, and its neighbours with hardly anyone.
  const best = x.strong[0];
  if (best && ticket) {
    const near = x.nearby.find((n) => n.near === best.zip);
    const town = best.town ? ` (${best.town})` : '';
    add({
      id: `area-${best.zip}`, type: 'area',
      title: `${best.zip}${town} has ${best.customers} customers averaging ${usd(best.avgTicket!)}: put door hangers on their streets${near ? ` and next door in ${near.zip} (${near.town})` : ''}`,
      detail: `${best.repeatRate !== null ? `${pct(best.repeatRate)} of them come back. ` : ''}Your average job is ${usd(ticket)}.${best.miles === null ? '' : best.miles < 2 ? " It's your own ZIP." : ` It's about ${best.miles} miles from home.`}${near ? ` ${near.zip} has ${near.customers === 0 ? 'no customers' : 'one customer'} yet.` : ''}`,
      impact: best.avgTicket, impactNote: 'for each new customer there, per visit',
      target: { tab: 'marketing', label: 'Plan a mailing', segment: { zips: [best.zip] } },
    });
  }

  // The slow weekday.
  const open = r.money.weekdays.filter((d) => !d.closed && d.openDays >= 2 && d.jobsPerDay !== null);
  if (open.length >= 3 && ticket) {
    const mean = open.reduce((s, d) => s + d.jobsPerDay!, 0) / open.length;
    const slow = [...open].sort((a, b) => a.jobsPerDay! - b.jobsPerDay!)[0]!;
    if (mean > 0 && slow.jobsPerDay! < mean * 0.5) {
      add({
        id: `schedule-${slow.day}`, type: 'schedule',
        title: `${slow.name}s are slow: offer a ${slow.name} discount`,
        detail: `${slow.jobsPerDay} jobs on an open ${slow.name}, against ${Math.round(mean * 10) / 10} on your other open days.`,
        impact: Math.round(ticket * 0.9 * 4), impactNote: `if one more ${slow.name} fills each week for a month at 10% off`,
        target: { tab: 'marketing', label: 'Send an offer' },
      });
    }
  }

  // Add-ons: the package where people rarely take one.
  const popular = r.money.addOns[0];
  const lowest = r.money.services
    .filter((s) => s.service !== 'imported' && s.jobs >= 5 && s.addonRate !== null && s.addonRate < 0.3)
    .sort((a, b) => a.addonRate! - b.addonRate!)[0];
  if (lowest) {
    const craftAddOns = x.config.addOns.filter((a) => a.craft === lowest.craft && !a.includedIn?.includes(lowest.service));
    const pick = craftAddOns.find((a) => a.label === popular?.label) ?? craftAddOns.find((a) => a.id === 'headlights') ?? craftAddOns[0];
    if (pick) {
      const said = lowest.addonJobs === 0 ? `None of your ${lowest.jobs} ${lowest.name} customers bought an add-on` : `Only 1 in ${Math.round(lowest.jobs / lowest.addonJobs)} ${lowest.name} customers buys an add-on`;
      add({
        id: `upsell-${lowest.service}`, type: 'upsell',
        title: `${said}: offer ${pick.label.toLowerCase()} at checkout`,
        detail: `${lowest.addonJobs} of ${lowest.jobs} in this period. ${pick.label} is ${usd(pick.price)}.`,
        impact: Math.round(lowest.jobs * (0.3 - lowest.addonRate!) * pick.price), impactNote: 'if 3 in 10 said yes',
        target: { tab: 'prices', label: 'Open Prices' },
      });
    }
  }

  // Referrals.
  const topRef = r.referrers[0];
  const refSource = r.sources.find((s) => s.source === 'referral');
  if (topRef) {
    add({
      id: 'referral-thanks', type: 'referral',
      title: `${firstName(topRef.name)} has sent you ${topRef.referrals} ${topRef.referrals === 1 ? 'customer' : 'customers'}: thank them, and give every regular their referral link`,
      detail: `Customers they sent have spent ${usd(topRef.referredRevenue)}.${refSource?.avgLifetimeSpend ? ` A referred customer spends ${usd(refSource.avgLifetimeSpend)} on average.` : ''}`,
      impact: refSource?.avgLifetimeSpend ?? null, impactNote: 'for each new referral',
      target: { tab: 'marketing', label: 'Referral links', segment: { lifecycle: 'repeat' } },
    });
  } else if (r.customers.repeat >= 5) {
    add({
      id: 'referral-start', type: 'referral',
      title: `No one has used a referral link yet: give your ${r.customers.repeat} regulars theirs`,
      detail: `Regulars already trust you. Their friends are the cheapest new customers you can get.`,
      impact: r.customers.lifetimeValue, impactNote: 'for each new referral',
      target: { tab: 'marketing', label: 'Referral links', segment: { lifecycle: 'repeat' } },
    });
  }

  // Price: busy enough to charge more, or the average job slipping.
  const use = r.pipeline.next30.use;
  if (use !== null && use >= 0.85 && r.pipeline.next30.revenue) {
    add({
      id: 'pricing-busy', type: 'pricing',
      title: `You're ${pct(use)} booked for the next 30 days: raise prices 10% for new bookings`,
      detail: `${r.pipeline.next30.jobs} of ${r.pipeline.next30.slots} job slots are taken. Busy is the time to charge more.`,
      impact: Math.round(r.pipeline.next30.revenue * 0.1), impactNote: 'on a month like the next one',
      target: { tab: 'prices', label: 'Open Prices' },
    });
  }
  const prev = r.money.prev;
  if (prev?.avgTicket && r.money.cur.avgTicket && r.money.cur.jobs >= 5 && r.money.cur.avgTicket < prev.avgTicket * 0.9) {
    add({
      id: 'pricing-ticket', type: 'pricing',
      title: `Your average job fell from ${usd(prev.avgTicket)} to ${usd(r.money.cur.avgTicket)}: suggest the next package up when people book`,
      detail: `${r.money.cur.jobs} jobs in this period against ${prev.jobs} before.`,
      impact: (prev.avgTicket - r.money.cur.avgTicket) * r.money.cur.jobs, impactNote: 'back, at the old average',
      target: { tab: 'prices', label: 'Open Prices' },
    });
  }

  // Cancellations.
  const c = r.money.cur;
  if (c.cancelled >= 3 && (c.cancelRate ?? 0) >= 0.12) {
    add({
      id: 'cancellations', type: 'schedule',
      title: `${c.cancelled} of ${c.cancelled + c.jobs} jobs were cancelled (${pct(c.cancelRate!)}): send a reminder text the day before`,
      detail: `${c.cancelledByCustomer} were cancelled by the customer. Together they were worth ${usd(c.cancelledValue)}.`,
      impact: Math.round(c.cancelledValue / 2), impactNote: 'if half had gone ahead',
      target: { tab: 'today', label: 'Open Today' },
    });
  }

  // Empty days coming up.
  if (r.pipeline.emptyDays.length >= 3 && ticket) {
    add({
      id: 'empty-days', type: 'schedule',
      title: `${r.pipeline.emptyDays.length} open days in the next two weeks have nothing booked: text your regulars that you have openings`,
      detail: `Your average job is ${usd(ticket)}.`,
      impact: Math.round(r.pipeline.emptyDays.length * ticket * 0.5), impactNote: 'if half of those days fill',
      target: { tab: 'marketing', label: 'Text your regulars', segment: { lifecycle: 'repeat', noUpcoming: true } },
    });
  }

  // Seasons: next month's usual level.
  if (x.seasonality && x.monthAvg > 0) {
    const m = (Number(x.today.slice(5, 7)) % 12) + 1;
    const s = x.seasonality[m - 1]!;
    if (s.avgRevenue !== null) {
      const idx = s.avgRevenue / x.monthAvg;
      if (idx < 0.8) {
        add({
          id: 'season-slow', type: 'schedule',
          title: `${monthName(m)} is usually slow, ${pct(1 - idx)} below a normal month: send a gift card or special offer now`,
          detail: `${monthName(m)} has averaged ${usd(s.avgRevenue)}; a normal month is ${usd(Math.round(x.monthAvg))}.`,
          impact: Math.round((x.monthAvg - s.avgRevenue) / 2), impactNote: 'if you close half the gap',
          target: { tab: 'marketing', label: 'Plan an offer' },
        });
      } else if (idx > 1.2) {
        add({
          id: 'season-busy', type: 'pricing',
          title: `${monthName(m)} is usually busy, ${pct(idx - 1)} above a normal month: book your regulars early and hold your prices`,
          detail: `${monthName(m)} has averaged ${usd(s.avgRevenue)}; a normal month is ${usd(Math.round(x.monthAvg))}.`,
          impact: null, impactNote: null,
          target: { tab: 'today', label: 'Open Today' },
        });
      }
    }
  }

  return out.sort((a, b) => (b.impact ?? -1) - (a.impact ?? -1)).slice(0, 8);
}

/* ------------------------------------------------------------ spend */

interface SpendRow {
  id: string;
  month: string;
  source: string;
  amount: number;
  note: string | null;
  created_at: string;
  updated_at: string;
}
const toSpend = (r: SpendRow) => ({ id: r.id, month: r.month, source: r.source, amount: r.amount, note: r.note, createdAt: r.created_at, updatedAt: r.updated_at });

function readSpend(body: Record<string, unknown>, partial: boolean) {
  const out: Partial<{ month: string; source: string; amount: number; note: string | null }> = {};
  if (!partial || 'month' in body) {
    if (typeof body.month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(body.month)) throw new ApiError(422, 'invalid', 'Pick the month, like 2026-09.');
    out.month = body.month;
  }
  if (!partial || 'source' in body) {
    if (typeof body.source !== 'string' || !(SOURCES as readonly string[]).includes(body.source)) {
      throw new ApiError(422, 'invalid', `Pick where the money went: ${SOURCES.join(', ')}.`);
    }
    out.source = body.source;
  }
  if (!partial || 'amount' in body) {
    if (!(typeof body.amount === 'number' && Number.isInteger(body.amount) && body.amount > 0 && body.amount < 10_000_000)) {
      throw new ApiError(422, 'invalid', 'The amount must be more than zero (in cents).');
    }
    out.amount = body.amount;
  }
  if (!partial || 'note' in body) out.note = text(body.note, 'Note', 200) ?? null;
  return out;
}

insights.get('/spend', async (c) => {
  const from = c.req.query('from') ?? '0000-01';
  const to = c.req.query('to') ?? '9999-12';
  const { results } = await c.env.DB.prepare('SELECT * FROM marketing_spend WHERE month BETWEEN ? AND ? ORDER BY month DESC, id DESC LIMIT 500')
    .bind(from, to).all<SpendRow>();
  return c.json({ spend: results.map(toSpend) });
});

insights.post('/spend', async (c) => {
  const s = readSpend(await json(c.req.raw), false);
  const at = now();
  const row = await c.env.DB.prepare(
    'INSERT INTO marketing_spend (id, month, source, amount, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *',
  ).bind(ulid(), s.month, s.source, s.amount, s.note, at, at).first<SpendRow>();
  return c.json(toSpend(row!), 201);
});

insights.patch('/spend/:id', async (c) => {
  const s = readSpend(await json(c.req.raw), true);
  const sets = Object.entries(s).map(([k]) => `${k} = ?`);
  const row = await c.env.DB.prepare(`UPDATE marketing_spend SET ${[...sets, 'updated_at = ?'].join(', ')} WHERE id = ? RETURNING *`)
    .bind(...Object.values(s), now(), c.req.param('id')).first<SpendRow>();
  if (!row) throw new ApiError(404, 'not_found', 'No spending with that ID.');
  return c.json(toSpend(row));
});

insights.delete('/spend/:id', async (c) => {
  const r = await c.env.DB.prepare('DELETE FROM marketing_spend WHERE id = ?').bind(c.req.param('id')).run();
  if (!r.meta.changes) throw new ApiError(404, 'not_found', 'No spending with that ID.');
  return c.body(null, 204);
});

/* ------------------------------------------------------------ summary */

/** Cost-sensible: a short weekly note, low effort. About 3k tokens in and 1-2k out, a few cents a week. */
const MODEL = 'claude-opus-5';
const ANTHROPIC = 'https://api.anthropic.com/v1/messages';

const SYSTEM = `You write a short weekly note to Jacob, who owns Knock Em' Down, a one-man mobile auto and boat detailing business in the St. Louis area.
Jacob is not technical. Write at a fifth-grade reading level: short sentences, everyday words, no business jargon, no markdown, no bold, no emoji.
Use only the numbers you are given, rounded to whole dollars. Never make up a number, a name or a reason.
Write exactly these three parts, in this order, with these labels:

How last week went:
Two to four sentences comparing last week with the week before and with the last 90 days.

Do these 3 things this week:
- one step per line, each with the number behind it

Stop doing this:
- one thing, with the number behind it

Pick the three steps from the ranked actions you are given, most valuable first, in your own plain words. If nothing needs stopping, say to stop waiting on quote requests or stop guessing, whichever the numbers support. Keep the whole note under 200 words.`;

/** Last week, Monday to Sunday, in Jacob's time zone. */
function lastWeek(at: Date) {
  const today = localDate(at, TZ);
  const monday = addDays(today, -((weekday(today) + 6) % 7));
  return { from: addDays(monday, -7), to: addDays(monday, -1) };
}

/**
 * What goes to Claude: totals, rates and the ranked actions. No customer's
 * phone, email, address or last name; only first names of the top three.
 */
function facts(week: Insights, trailing: Insights) {
  const m = (t: Totals | null) => t && { revenue: usd(t.revenue), jobs: t.jobs, avgTicket: t.avgTicket === null ? null : usd(t.avgTicket), cancelled: t.cancelled };
  return {
    lastWeek: { dates: `${week.period.from} to ${week.period.to}`, ...m(week.money.cur), newCustomers: week.customers.new, quoteRequests: week.leads.leads, quoteRequestsBooked: week.leads.booked },
    weekBefore: m(week.money.prev),
    last90Days: {
      ...m(trailing.money.cur),
      newCustomers: trailing.customers.new,
      repeatRate: trailing.customers.repeatRate === null ? null : pct(trailing.customers.repeatRate),
      bestCustomers: trailing.customers.top.slice(0, 3).map((c) => ({ firstName: firstName(c.name), spent: usd(c.spend), visits: c.visits })),
      topSources: trailing.sources.slice(0, 4).map((s) => ({ source: s.label, revenue: usd(s.revenue), quoteRequests: s.leads, booked: s.leadsBooked, spend: s.spend ? usd(s.spend) : null })),
    },
    next30Days: {
      jobsBooked: trailing.pipeline.next30.jobs,
      bookedValue: usd(trailing.pipeline.next30.revenue),
      slotsFilled: trailing.pipeline.next30.use === null ? null : pct(trailing.pipeline.next30.use),
      emptyOpenDaysNext2Weeks: trailing.pipeline.emptyDays.length,
      quoteRequestsWaiting: trailing.pipeline.openQuotes.count,
    },
    rankedActions: trailing.actions.slice(0, 6).map((a) => ({ step: a.title, numbers: a.detail, worth: a.impact ? `${usd(a.impact)} ${a.impactNote ?? ''}`.trim() : null })),
  };
}

/** The note without Claude: the same three parts, from the numbers and the rules. */
function rulesNote(week: Insights, trailing: Insights, why: string | null) {
  const c = week.money.cur;
  const p = week.money.prev;
  const change = p && p.revenue ? ` That's ${c.revenue >= p.revenue ? 'up' : 'down'} from ${usd(p.revenue)} the week before.` : '';
  const weekly90 = Math.round(trailing.money.cur.revenue / 13);
  const steps = trailing.actions.filter((a) => a.type !== 'channel' || !/Stop|cut|pause/.test(a.title));
  const stop = trailing.actions.find((a) => a.type === 'channel' && /Stop|cut|pause/i.test(a.title));
  return [
    `How last week went:\nYou finished ${c.jobs} ${c.jobs === 1 ? 'job' : 'jobs'} worth ${usd(c.revenue)}.${change} Over the last 90 days you averaged about ${usd(weekly90)} a week. ${week.customers.new} new ${week.customers.new === 1 ? 'customer' : 'customers'} and ${week.leads.leads} quote ${week.leads.leads === 1 ? 'request' : 'requests'} came in.`,
    `Do these 3 things this week:\n${steps.slice(0, 3).map((a) => `- ${a.title}. ${a.detail}`).join('\n') || '- Keep going. Nothing stands out this week.'}`,
    `Stop doing this:\n- ${stop ? `${stop.title}. ${stop.detail}` : `Stop letting quote requests wait. ${trailing.pipeline.openQuotes.count} are open right now.`}`,
    why ? `(${why})` : null,
  ].filter(Boolean).join('\n\n');
}

interface Written {
  body: string;
  source: 'claude' | 'rules';
  model: string | null;
  note: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

async function askClaude(env: Bindings, payload: object): Promise<Written | string> {
  const request = (fallbacks: boolean) =>
    fetch(env.ANTHROPIC_URL || ANTHROPIC, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
        ...(fallbacks ? { 'anthropic-beta': 'server-side-fallback-2026-07-01' } : {}),
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 3000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'low' },
        ...(fallbacks ? { fallbacks: 'default' } : {}),
        system: SYSTEM,
        messages: [{ role: 'user', content: `Here are this week's numbers as JSON. Write the note.\n\n${JSON.stringify(payload, null, 1)}` }],
      }),
    });
  try {
    let res = await request(true);
    // If the fallback option is ever refused, the plain request still works.
    if (res.status === 400) res = await request(false);
    if (!res.ok) return `Claude answered ${res.status}`;
    const msg = (await res.json()) as {
      model?: string;
      stop_reason?: string;
      content?: { type: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    if (msg.stop_reason === 'refusal') return 'Claude declined to write it';
    const body = (msg.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim();
    if (!body) return 'Claude sent back nothing';
    return {
      body,
      source: 'claude',
      model: msg.model ?? MODEL,
      note: null,
      inputTokens: msg.usage?.input_tokens ?? null,
      outputTokens: msg.usage?.output_tokens ?? null,
    };
  } catch (err) {
    console.error('weekly summary: Claude failed', err);
    return "Couldn't reach Claude";
  }
}

interface SummaryRow {
  id: string;
  week_start: string;
  week_end: string;
  source: 'claude' | 'rules';
  model: string | null;
  body: string;
  note: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  emailed: number;
  created_by: string;
  created_at: string;
}
const toSummary = (r: SummaryRow) => ({
  id: r.id, weekStart: r.week_start, weekEnd: r.week_end, source: r.source, model: r.model, body: r.body, note: r.note,
  inputTokens: r.input_tokens, outputTokens: r.output_tokens, emailed: r.emailed === 1, createdBy: r.created_by, createdAt: r.created_at,
});

/** Email the note to ALERT_EMAIL, the way alerts go (Cloudflare Email Routing to verified addresses). */
async function emailNote(env: Bindings, subject: string, body: string): Promise<boolean> {
  if (!env.EMAIL || !env.MAIL_FROM || !env.ALERT_EMAIL) return false;
  const footer = env.ADMIN_URL ? `\n\nSee every number: ${env.ADMIN_URL} (Insights)` : '';
  const sent = await Promise.all(
    list(env.ALERT_EMAIL).map((to) =>
      env.EMAIL.send({ to, from: { name: "Knock Em' Down", email: env.MAIL_FROM }, subject, text: body + footer }).then(
        () => true,
        (err: unknown) => (console.error(`weekly summary email to ${to} failed`, err), false),
      ),
    ),
  );
  return sent.some(Boolean);
}

/** Writes, stores and emails the note for last week. */
export async function makeSummary(env: Bindings, by: string, at = new Date()) {
  const wk = lastWeek(at);
  const today = localDate(at, TZ);
  const [week, trailing] = await Promise.all([
    computeInsights(env.DB, readPeriod({ ...wk }, today), at),
    computeInsights(env.DB, readPeriod({ to: addDays(wk.to, 0) }, today), at),
  ]);
  const payload = facts(week, trailing);
  // Without a key the rules write it, and nothing mentions Claude: this project runs without AI credits.
  let written: Written | string | null = env.ANTHROPIC_API_KEY ? await askClaude(env, payload) : null;
  if (typeof written === 'string' || written === null) {
    const why = written ? `${written}, so this was built from your numbers alone.` : null;
    written = { body: rulesNote(week, trailing, why), source: 'rules', model: null, note: why, inputTokens: null, outputTokens: null };
  }
  const id = ulid();
  await env.DB.prepare(
    `INSERT INTO insight_summaries (id, week_start, week_end, source, model, body, numbers, note, input_tokens, output_tokens, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, wk.from, wk.to, written.source, written.model, written.body, JSON.stringify(payload), written.note,
    written.inputTokens, written.outputTokens, by, now()).run();
  const emailed = await emailNote(env, `Your week: ${usd(week.money.cur.revenue)} from ${week.money.cur.jobs} ${week.money.cur.jobs === 1 ? 'job' : 'jobs'}`, written.body)
    .catch((err) => (console.error('weekly summary email failed', err), false));
  if (emailed) await env.DB.prepare('UPDATE insight_summaries SET emailed = 1 WHERE id = ?').bind(id).run();
  const row = await env.DB.prepare('SELECT * FROM insight_summaries WHERE id = ?').bind(id).first<SummaryRow>();
  return toSummary(row!);
}

/** Runs once a week from the Worker's cron (see `scheduled` in index.ts). Once per week, even if the cron retries. */
export async function runWeekly(env: AppEnv['Bindings']): Promise<void> {
  const wk = lastWeek(new Date());
  const done = await env.DB.prepare("SELECT 1 FROM insight_summaries WHERE week_start = ? AND created_by = 'cron'").bind(wk.from).first();
  if (done) return;
  await makeSummary(env, 'cron');
}

insights.get('/summary', async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 5) || 5, 1), 20);
  const { results } = await c.env.DB.prepare('SELECT * FROM insight_summaries ORDER BY created_at DESC, id DESC LIMIT ?').bind(limit).all<SummaryRow>();
  return c.json({ summaries: results.map(toSummary), claude: !!c.env.ANTHROPIC_API_KEY });
});

insights.post('/summary', async (c) => c.json(await makeSummary(c.env, who(c.get('owner'))), 201));

/* ------------------------------------------------------------ the numbers */

insights.get('/', async (c) => {
  const period = readPeriod({ from: c.req.query('from'), to: c.req.query('to'), compare: c.req.query('compare') });
  return c.json(await computeInsights(c.env.DB, period));
});
