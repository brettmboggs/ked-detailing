import {
  defaultRules,
  jobMinutes,
  localDate,
  minGapMinutes,
  openSlots,
  slotProblem,
  validateRules,
  zipOf,
  type BookingRules,
  type Calendar,
  type SlotProblem,
} from '@ked/scheduling';
import { ApiError, now, randomToken, text, ulid } from './lib.ts';
import { priceRequest, type QuoteSummary } from './pricing.ts';
import { findOrCreateCustomer } from './customers.ts';
import { readTouch, touchJson } from './attribution.ts';

/* ------------------------------------------------------------ rules */

export async function currentRules(db: D1Database): Promise<{ rules: BookingRules; updatedAt: string | null }> {
  const row = await db
    .prepare("SELECT value, updated_at FROM settings WHERE key = 'booking'")
    .first<{ value: string; updated_at: string }>();
  if (!row) return { rules: defaultRules, updatedAt: null };
  return { rules: JSON.parse(row.value) as BookingRules, updatedAt: row.updated_at };
}

export async function saveRules(db: D1Database, body: unknown, by: string) {
  const rules = body as BookingRules;
  let errors: string[];
  try {
    errors = validateRules(rules);
  } catch {
    throw new ApiError(422, 'invalid_rules', 'Those are not booking rules.');
  }
  if (errors.length) throw new ApiError(422, 'invalid_rules', 'Some booking rules need fixing.', errors);
  // Keep only the known fields, so nothing else rides along into storage.
  const clean: BookingRules = {
    onlineBooking: rules.onlineBooking,
    timezone: rules.timezone,
    week: rules.week.map((d) => (d ? { open: d.open, close: d.close } : null)) as BookingRules['week'],
    slotStepMinutes: rules.slotStepMinutes,
    bufferMinutes: rules.bufferMinutes,
    ...(rules.travel
      ? { travel: { on: rules.travel.on, homeZip: rules.travel.homeZip, packUpMinutes: rules.travel.packUpMinutes } }
      : {}),
    maxJobsPerDay: rules.maxJobsPerDay,
    minNoticeHours: rules.minNoticeHours,
    horizonDays: rules.horizonDays,
  };
  const at = now();
  await db
    .prepare(
      `INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('booking', ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    )
    .bind(JSON.stringify(clean), at, by)
    .run();
  return { rules: clean, updatedAt: at };
}

/* --------------------------------------------------------- calendar */

/**
 * Everything that occupies time between two instants: live jobs (with where
 * they are, for drive times) and time off.
 */
export async function loadCalendar(db: D1Database, from: Date, to: Date, exceptJobId = ''): Promise<Calendar> {
  const [jobs, timeOff] = await db.batch<{ start_at: string; end_at: string; zip?: string | null; address?: string }>([
    db
      .prepare("SELECT start_at, end_at, zip, address FROM jobs WHERE status != 'cancelled' AND start_at < ? AND end_at > ? AND id != ?")
      .bind(to.toISOString(), from.toISOString(), exceptJobId),
    db.prepare('SELECT start_at, end_at FROM time_off WHERE start_at < ? AND end_at > ?').bind(to.toISOString(), from.toISOString()),
  ]);
  return {
    jobs: jobs!.results.map((r) => ({ start: r.start_at, end: r.end_at, zip: zipOf(r.zip, r.address) })),
    timeOff: timeOff!.results.map((r) => ({ start: r.start_at, end: r.end_at })),
  };
}

/**
 * Why a quote can't be booked online at all, whatever the time. These go to
 * Jacob as a quote request instead.
 */
function unbookable(summary: QuoteSummary, rules: BookingRules, minutes: number): string | null {
  if (!rules.onlineBooking) return 'Online booking is off right now. Send your quote to Jacob and he will set a time.';
  if (!summary.range || summary.inspection) return 'Jacob needs to see this one first. Send it to him and he will set a time.';
  const longest = Math.max(
    0,
    ...rules.week.map((d) => (d ? toMinutes(d.close) - toMinutes(d.open) : 0)),
  );
  if (minutes > longest) return 'This job runs longer than one day. Send it to Jacob and he will plan the days with you.';
  return null;
}

const toMinutes = (t: string) => {
  const [h, m] = t.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

/** Open start times for this job, day by day. */
export async function availability(db: D1Database, body: Record<string, unknown>) {
  const { summary } = await priceRequest(db, body.input, undefined);
  const { rules } = await currentRules(db);
  const minutes = jobMinutes(summary.hours, rules);
  const reason = unbookable(summary, rules, minutes);
  const base = { timezone: rules.timezone, minutes, quote: summary };
  if (reason) return { ...base, bookable: false, reason, days: [] };

  const at = new Date();
  const calendar = await loadCalendar(db, new Date(at.getTime() - 864e5), new Date(at.getTime() + (rules.horizonDays + 2) * 864e5));
  // The quote's ZIP, so times allow for the drive from Jacob's other jobs.
  const zip = zipOf((body.input as { zip?: string } | undefined)?.zip ?? (typeof body.zip === 'string' ? body.zip : null));
  return { ...base, bookable: true, days: openSlots(rules, calendar, minutes, at, zip) };
}

/* ---------------------------------------------------------- booking */

export const PROBLEMS: Record<SlotProblem, string> = {
  booking_off: 'Online booking is off right now.',
  too_long: 'This job is too long to book online.',
  closed: "Jacob isn't working that day.",
  outside_hours: "That time is outside Jacob's hours.",
  off_grid: "That isn't one of the offered start times.",
  too_soon: 'That time is too soon to book online. Pick a later one, or call Jacob.',
  too_far: "That's further ahead than online booking goes.",
  day_full: 'That day just filled up. Pick another.',
  taken: 'Someone just took that time. Pick another.',
};

/**
 * A customer books a slot from the website. The slot is checked against the
 * rules, then inserted with a single conditional statement that re-checks for
 * overlaps and the daily limit, so two people racing for the same time can't
 * both get it.
 */
export async function createBooking(db: D1Database, body: Record<string, unknown>) {
  // Honeypot, as on leads: act as if it worked, store nothing.
  if (body.website) return { id: ulid(), start: null, end: null, quote: null };

  const name = text(body.name, 'Name', 100);
  const phone = text(body.phone, 'Phone', 30);
  const email = text(body.email, 'Email', 200);
  const address = text(body.address, 'Address', 200);
  const zip = text(body.zip, 'ZIP', 10);
  const vehicle = text(body.vehicle, 'Vehicle', 120);
  const notes = text(body.notes, 'Notes', 2000);
  if (!name) throw new ApiError(422, 'invalid', 'Add a name so Jacob knows who to ask for.');
  if (!phone) throw new ApiError(422, 'invalid', 'Add a phone number so Jacob can reach you on the day.');
  if (!address) throw new ApiError(422, 'invalid', 'Add the address where the vehicle will be.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError(422, 'invalid', "That email address doesn't look right.");
  }
  const startText = text(body.start, 'Start', 40);
  const start = startText ? new Date(startText) : null;
  if (!start || Number.isNaN(start.getTime())) throw new ApiError(422, 'invalid', 'Pick a time.');

  const { input, summary, version } = await priceRequest(db, body.input, zip);
  const { rules } = await currentRules(db);
  const minutes = jobMinutes(summary.hours, rules);
  const reason = unbookable(summary, rules, minutes);
  if (reason) throw new ApiError(422, 'not_bookable', reason);

  const end = new Date(start.getTime() + minutes * 60_000);
  const at = new Date();
  const calendar = await loadCalendar(db, new Date(start.getTime() - 864e5), new Date(end.getTime() + 864e5));
  const problem = slotProblem(rules, calendar, start, minutes, at, zipOf(zip ?? input.zip, address));
  if (problem) throw new ApiError(409, problem === 'taken' || problem === 'day_full' ? 'slot_taken' : 'bad_slot', PROBLEMS[problem]);

  const touch = readTouch(body);
  const customer = await findOrCreateCustomer(db, { name, phone, email, address }, touch);
  const id = ulid();
  const stamp = now();
  const day = localDate(start, rules.timezone);
  // The drive-based gap was checked above; this last-moment guard only stops a
  // true double booking, so it uses the smallest gap two jobs could have.
  const buffer = minGapMinutes(rules) * 60_000;
  const token = randomToken();
  const result = await db
    .prepare(
      `INSERT INTO jobs (id, customer_id, status, source, service, vehicle, address, zip, notes, input, quote,
                         config_version, start_at, end_at, local_date, created_at, updated_at, manage_token, attribution)
       SELECT ?, ?, 'scheduled', 'web', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE NOT EXISTS (
               SELECT 1 FROM jobs WHERE status != 'cancelled' AND start_at < ? AND end_at > ?)
         AND NOT EXISTS (
               SELECT 1 FROM time_off WHERE start_at < ? AND end_at > ?)
         AND (SELECT COUNT(*) FROM jobs WHERE status != 'cancelled' AND local_date = ?) < ?`,
    )
    .bind(
      id, customer.id, summary.service, vehicle ?? null, address, zip ?? input.zip ?? null, notes ?? null,
      JSON.stringify(input), JSON.stringify(summary), version,
      start.toISOString(), end.toISOString(), day, stamp, stamp, token, touchJson(touch.attribution),
      new Date(end.getTime() + buffer).toISOString(), new Date(start.getTime() - buffer).toISOString(),
      end.toISOString(), start.toISOString(),
      day, rules.maxJobsPerDay,
    )
    .run();
  if (result.meta.changes !== 1) throw new ApiError(409, 'slot_taken', PROBLEMS.taken);

  // The customer's own link to see, move or cancel it.
  return { id, start: start.toISOString(), end: end.toISOString(), quote: summary, manageToken: token };
}
