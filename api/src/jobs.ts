import { driveMinutes, gapMinutes, jobMinutes, localDate, slotProblem, zipOf, type BookingRules, type Calendar } from '@ked/scheduling';
import { currentRules, loadCalendar } from './booking.ts';
import { findOrCreateCustomer, getCustomer } from './customers.ts';
import { readTouch } from './attribution.ts';
import { ApiError, now, randomToken, text, ulid } from './lib.ts';
import { priceRequest } from './pricing.ts';

export const JOB_STATUSES = ['scheduled', 'in_progress', 'done', 'cancelled'] as const;
type JobStatus = (typeof JOB_STATUSES)[number];

interface JobRow {
  id: string;
  customer_id: string;
  status: JobStatus;
  source: 'web' | 'app';
  service: string;
  vehicle: string | null;
  address: string;
  zip: string | null;
  notes: string | null;
  input: string;
  quote: string;
  config_version: number;
  final_price: number | null;
  manage_token: string;
  imported_from: string | null;
  history: number;
  cancelled_by: string | null;
  cancel_reason: string | null;
  start_at: string;
  end_at: string;
  local_date: string;
  created_at: string;
  updated_at: string;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
}

const SELECT = `SELECT j.*, c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email
                FROM jobs j JOIN customers c ON c.id = j.customer_id`;

function toJob(r: JobRow) {
  return {
    id: r.id,
    status: r.status,
    source: r.source,
    service: r.service,
    customer: { id: r.customer_id, name: r.customer_name, phone: r.customer_phone, email: r.customer_email },
    vehicle: r.vehicle,
    address: r.address,
    zip: r.zip,
    notes: r.notes,
    input: JSON.parse(r.input),
    quote: JSON.parse(r.quote),
    configVersion: r.config_version,
    finalPrice: r.final_price,
    /** The customer's private link is MANAGE_URL?b=<this>. POST /jobs/:id/confirmation builds the text. */
    manageToken: r.manage_token,
    /** 'customer' if they cancelled through their link. */
    cancelledBy: r.cancelled_by,
    cancelReason: r.cancel_reason,
    /** 'hcp:<job number>' for jobs brought over from Housecall Pro. Their `service` is 'imported'. */
    importedFrom: r.imported_from,
    /** Past work imported for history: never asks for payment or mileage. */
    history: r.history === 1,
    start: r.start_at,
    end: r.end_at,
    date: r.local_date,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function instant(value: unknown, field: string): Date {
  const t = text(value, field, 40);
  const d = t ? new Date(t) : null;
  if (!d || Number.isNaN(d.getTime())) throw new ApiError(422, 'invalid', `${field} must be a date and time.`);
  return d;
}

/** Jobs overlapping [from, to). Defaults to yesterday through two weeks out. */
export async function listJobs(db: D1Database, from?: string, to?: string) {
  const f = from ? instant(from, 'from') : new Date(Date.now() - 864e5);
  const t = to ? instant(to, 'to') : new Date(Date.now() + 14 * 864e5);
  const { results } = await db
    .prepare(`${SELECT} WHERE j.start_at < ? AND j.end_at > ? ORDER BY j.start_at LIMIT 500`)
    .bind(t.toISOString(), f.toISOString())
    .all<JobRow>();
  return results.map(toJob);
}

export async function getJob(db: D1Database, id: string) {
  const row = await db.prepare(`${SELECT} WHERE j.id = ?`).bind(id).first<JobRow>();
  if (!row) throw new ApiError(404, 'not_found', 'No job with that ID.');
  return toJob(row);
}

export async function customerJobs(db: D1Database, customerId: string) {
  await getCustomer(db, customerId);
  const { results } = await db
    .prepare(`${SELECT} WHERE j.customer_id = ? ORDER BY j.start_at DESC LIMIT 200`)
    .bind(customerId)
    .all<JobRow>();
  return results.map(toJob);
}

/**
 * Clashes worth telling Jacob about when he books by hand. Each is checked on
 * its own so one doesn't hide another; the online-only rules (grid, notice,
 * horizon) are relaxed away.
 */
function ownerWarnings(rules: BookingRules, calendar: Calendar, start: Date, minutes: number, zip: string | null): string[] {
  const relaxed: BookingRules = {
    ...rules,
    onlineBooking: true,
    slotStepMinutes: 1,
    minNoticeHours: 0,
    horizonDays: 3650,
    maxJobsPerDay: Number.MAX_SAFE_INTEGER,
  };
  const before = new Date(start.getTime() - 60_000);
  const warnings: string[] = [];

  const hours = slotProblem(relaxed, { jobs: [], timeOff: [] }, start, minutes, before);
  if (hours === 'closed') warnings.push("This is on a day you've marked closed.");
  if (hours === 'outside_hours' || hours === 'too_long') warnings.push('This runs outside your working hours.');

  const s = start.getTime();
  const e = s + minutes * 60_000;
  const ms = (t: string | Date) => new Date(t).getTime();
  const clock = (t: string | Date) => new Date(t).toLocaleTimeString('en-US', { timeZone: rules.timezone, hour: 'numeric', minute: '2-digit' });
  if (calendar.jobs.some((j) => s < ms(j.end) && e > ms(j.start)) || calendar.timeOff.some((t) => s < ms(t.end) && e > ms(t.start))) {
    warnings.push('This overlaps another job or time off.');
  } else {
    // Close enough to overlap once the drive (or the usual gap) is counted.
    for (const j of calendar.jobs) {
      const gap = gapMinutes(rules, j.zip, zip);
      const after = ms(j.end) <= s;
      const room = Math.round((after ? s - ms(j.end) : ms(j.start) - e) / 60_000);
      if (room >= gap) continue;
      const drive = rules.travel?.on ? driveMinutes(j.zip, zip) : null;
      const which = after ? `the job that ends at ${clock(j.end)}` : `the ${clock(j.start)} job`;
      warnings.push(
        drive !== null
          ? `Only ${room} minutes between this and ${which}, and the drive is about ${drive}.`
          : `Only ${room} minutes between this and ${which}. You usually leave ${gap}.`,
      );
    }
  }

  const day = localDate(start, rules.timezone);
  if (calendar.jobs.filter((j) => localDate(j.start, rules.timezone) === day).length >= rules.maxJobsPerDay) {
    warnings.push('This goes over your jobs-per-day limit.');
  }
  return warnings;
}

/**
 * Jacob adds a job from the app. He can book anything he likes; the booking
 * rules only constrain customers. Clashes come back as warnings.
 */
export async function createJob(db: D1Database, body: Record<string, unknown>) {
  const start = instant(body.start, 'start');
  const zip = text(body.zip, 'ZIP', 10);
  const { input, summary, version } = await priceRequest(db, body.input, zip);
  const { rules } = await currentRules(db);

  let customerId: string;
  if (typeof body.customerId === 'string') {
    customerId = (await getCustomer(db, body.customerId)).id;
  } else {
    const c = (body.customer ?? {}) as Record<string, unknown>;
    const name = text(c.name, 'Customer name', 100);
    if (!name) throw new ApiError(422, 'invalid', 'Pick a customer or add a name.');
    customerId = (
      await findOrCreateCustomer(db, {
        name,
        phone: text(c.phone, 'Phone', 30),
        email: text(c.email, 'Email', 200),
        address: text(c.address, 'Address', 200),
      }, readTouch(body))
    ).id;
  }
  const address = text(body.address, 'Address', 200) ?? (await getCustomer(db, customerId)).address;
  if (!address) throw new ApiError(422, 'invalid', 'Add the address for the job.');

  const minutes =
    typeof body.minutes === 'number' && Number.isInteger(body.minutes) && body.minutes > 0
      ? body.minutes
      : jobMinutes(summary.hours, rules);
  const end = new Date(start.getTime() + minutes * 60_000);

  const calendar = await loadCalendar(db, new Date(start.getTime() - 864e5), new Date(end.getTime() + 864e5));
  const warnings = ownerWarnings(rules, calendar, start, minutes, zipOf(zip ?? input.zip, address));

  const id = ulid();
  const at = now();
  await db
    .prepare(
      `INSERT INTO jobs (id, customer_id, status, source, service, vehicle, address, zip, notes, input, quote,
                         config_version, start_at, end_at, local_date, created_at, updated_at, manage_token)
       VALUES (?, ?, 'scheduled', 'app', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id, customerId, summary.service, text(body.vehicle, 'Vehicle', 120) ?? null, address, zip ?? input.zip ?? null,
      text(body.notes, 'Notes', 5000) ?? null, JSON.stringify(input), JSON.stringify(summary), version,
      start.toISOString(), end.toISOString(), localDate(start, rules.timezone), at, at, randomToken(),
    )
    .run();
  return { job: await getJob(db, id), warnings };
}

/** Status, reschedule, notes, the settled price. Only the fields sent change. */
export async function updateJob(db: D1Database, id: string, body: Record<string, unknown>) {
  const job = await getJob(db, id);
  const fields: [string, unknown][] = [];

  if ('status' in body) {
    if (typeof body.status !== 'string' || !(JOB_STATUSES as readonly string[]).includes(body.status)) {
      throw new ApiError(422, 'invalid', `status must be one of ${JOB_STATUSES.join(', ')}.`);
    }
    fields.push(['status', body.status]);
    // Remember who cancelled; un-cancelling forgets it.
    if (body.status !== job.status) {
      const reason = body.status === 'cancelled' ? (text(body.cancelReason, 'Reason', 500) ?? null) : null;
      fields.push(['cancelled_by', body.status === 'cancelled' ? 'owner' : null], ['cancel_reason', reason]);
    }
  }
  if ('start' in body || 'end' in body) {
    const start = 'start' in body ? instant(body.start, 'start') : new Date(job.start);
    // Moving the start keeps the length unless a new end is given too.
    const end =
      'end' in body
        ? instant(body.end, 'end')
        : new Date(start.getTime() + (new Date(job.end).getTime() - new Date(job.start).getTime()));
    if (end <= start) throw new ApiError(422, 'invalid', 'The end must be after the start.');
    const { rules } = await currentRules(db);
    fields.push(['start_at', start.toISOString()], ['end_at', end.toISOString()], ['local_date', localDate(start, rules.timezone)]);
  }
  if ('notes' in body) fields.push(['notes', text(body.notes, 'Notes', 5000) ?? null]);
  if ('address' in body) {
    const address = text(body.address, 'Address', 200);
    if (!address) throw new ApiError(422, 'invalid', "Address can't be empty.");
    fields.push(['address', address]);
  }
  if ('vehicle' in body) fields.push(['vehicle', text(body.vehicle, 'Vehicle', 120) ?? null]);
  if ('finalPrice' in body) {
    const p = body.finalPrice;
    if (p !== null && !(typeof p === 'number' && Number.isInteger(p) && p >= 0)) {
      throw new ApiError(422, 'invalid', 'finalPrice must be whole cents, or null.');
    }
    fields.push(['final_price', p]);
  }
  if (!fields.length) return job;

  await db
    .prepare(`UPDATE jobs SET ${fields.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .bind(...fields.map(([, v]) => v), now(), id)
    .run();
  return getJob(db, id);
}

/* ---------------------------------------------------------- time off */

/** Time off overlapping [from, to); by default, anything that ended in the last week or later. */
export async function listTimeOff(db: D1Database, from?: string, to?: string) {
  const after = from ? instant(from, 'from') : new Date(Date.now() - 7 * 864e5);
  const before = to ? instant(to, 'to') : new Date('9999-12-31T00:00:00Z');
  const { results } = await db
    .prepare('SELECT id, start_at, end_at, reason FROM time_off WHERE end_at > ? AND start_at < ? ORDER BY start_at LIMIT 200')
    .bind(after.toISOString(), before.toISOString())
    .all<{ id: string; start_at: string; end_at: string; reason: string | null }>();
  return results.map((r) => ({ id: r.id, start: r.start_at, end: r.end_at, reason: r.reason }));
}

export async function addTimeOff(db: D1Database, body: Record<string, unknown>) {
  const start = instant(body.start, 'start');
  const end = instant(body.end, 'end');
  if (end <= start) throw new ApiError(422, 'invalid', 'The end must be after the start.');
  const reason = text(body.reason, 'Reason', 200) ?? null;
  const id = ulid();
  await db
    .prepare('INSERT INTO time_off (id, start_at, end_at, reason, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, start.toISOString(), end.toISOString(), reason, now())
    .run();
  return { id, start: start.toISOString(), end: end.toISOString(), reason };
}

export async function removeTimeOff(db: D1Database, id: string) {
  const { meta } = await db.prepare('DELETE FROM time_off WHERE id = ?').bind(id).run();
  if (meta.changes !== 1) throw new ApiError(404, 'not_found', 'No time off with that ID.');
}
