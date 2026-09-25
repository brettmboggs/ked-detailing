import { localDate, openSlots, slotProblem } from '@ked/scheduling';
import { currentRules, loadCalendar, PROBLEMS } from './booking.ts';
import { getJob } from './jobs.ts';
import { ApiError, now, text, type Bindings } from './lib.ts';

/**
 * A customer's own view of their booking, through the private link in their
 * confirmation: see it, move it, or cancel it.
 *
 * Changes follow the same rules as booking online: only a scheduled job, only
 * while it's further off than the booking notice, and a new time has to be
 * one a new customer could book. Past that, it's a call or text to Jacob.
 * Jacob hears about every change by push.
 */

// TENANT: the business's phone. See docs/multi-tenant.md.
const PHONE = '(314) 223-2988';

/** Tokens are 43 URL-safe characters, or 48 hex for jobs made before links existed. */
async function byToken(db: D1Database, token: string) {
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) throw new ApiError(404, 'not_found', 'No booking at that link.');
  const row = await db.prepare('SELECT id FROM jobs WHERE manage_token = ?').bind(token).first<{ id: string }>();
  if (!row) throw new ApiError(404, 'not_found', 'No booking at that link.');
  return getJob(db, row.id);
}

type Job = Awaited<ReturnType<typeof getJob>>;

/** Why this booking can't be changed online right now, in the customer's words. Null if it can. */
async function lockedReason(db: D1Database, job: Job): Promise<string | null> {
  if (job.status === 'cancelled') return 'This booking is cancelled.';
  if (job.status !== 'scheduled') return `This job is already ${job.status === 'done' ? 'done' : 'underway'}.`;
  const { rules } = await currentRules(db);
  const hours = (new Date(job.start).getTime() - Date.now()) / 36e5;
  if (hours < rules.minNoticeHours) {
    return `It's too close to your time to change it online. Call or text Jacob at ${PHONE}.`;
  }
  if (!rules.onlineBooking) return `To change it, call or text Jacob at ${PHONE}.`;
  return null;
}

export const manageUrl = (env: Bindings, token: string) => `${env.MANAGE_URL}?b=${token}`;

/** What the customer sees. First name only, in case the link is forwarded. */
export async function viewBooking(env: Bindings, token: string) {
  const job = await byToken(env.DB, token);
  const { rules } = await currentRules(env.DB);
  const locked = await lockedReason(env.DB, job);
  return {
    status: job.status,
    customerName: job.customer.name.trim().split(/\s+/)[0],
    service: job.quote.lines[0]?.label ?? 'Detail',
    start: job.start,
    end: job.end,
    timezone: rules.timezone,
    address: job.address,
    vehicle: job.vehicle,
    /** [low, high] in cents, or null when Jacob prices it on site. */
    estimate: job.finalPrice !== null ? [job.finalPrice, job.finalPrice] : job.quote.range,
    canChange: locked === null,
    /** Shown instead of the buttons when it can't be changed. */
    locked,
  };
}

const minutesOf = (job: Job) => Math.round((new Date(job.end).getTime() - new Date(job.start).getTime()) / 60_000);

/** Open times the booking could move to. Its own time counts as free. */
export async function manageAvailability(env: Bindings, token: string) {
  const job = await byToken(env.DB, token);
  const locked = await lockedReason(env.DB, job);
  const { rules } = await currentRules(env.DB);
  if (locked) return { timezone: rules.timezone, days: [], locked };
  const at = new Date();
  const calendar = await loadCalendar(env.DB, new Date(at.getTime() - 864e5), new Date(at.getTime() + (rules.horizonDays + 2) * 864e5), job.id);
  return { timezone: rules.timezone, days: openSlots(rules, calendar, minutesOf(job), at), locked: null };
}

/**
 * `{ start }`. Checked like a new booking, then moved with one conditional
 * UPDATE that re-checks overlaps and the day limit, so two customers can't
 * land on the same time.
 */
export async function reschedule(env: Bindings, token: string, body: Record<string, unknown>) {
  const job = await byToken(env.DB, token);
  const locked = await lockedReason(env.DB, job);
  if (locked) throw new ApiError(409, 'locked', locked);
  const startText = text(body.start, 'Start', 40);
  const start = startText ? new Date(startText) : null;
  if (!start || Number.isNaN(start.getTime())) throw new ApiError(422, 'invalid', 'Pick a time.');
  if (start.getTime() === new Date(job.start).getTime()) return { booking: await viewBooking(env, token), moved: false };

  const { rules } = await currentRules(env.DB);
  const minutes = minutesOf(job);
  const end = new Date(start.getTime() + minutes * 60_000);
  const calendar = await loadCalendar(env.DB, new Date(start.getTime() - 864e5), new Date(end.getTime() + 864e5), job.id);
  const problem = slotProblem(rules, calendar, start, minutes, new Date());
  if (problem) throw new ApiError(409, problem === 'taken' || problem === 'day_full' ? 'slot_taken' : 'bad_slot', PROBLEMS[problem]);

  const day = localDate(start, rules.timezone);
  const buffer = rules.bufferMinutes * 60_000;
  const result = await env.DB
    .prepare(
      `UPDATE jobs SET start_at = ?, end_at = ?, local_date = ?, updated_at = ?
       WHERE id = ? AND status = 'scheduled'
         AND NOT EXISTS (SELECT 1 FROM jobs o WHERE o.id != ? AND o.status != 'cancelled' AND o.start_at < ? AND o.end_at > ?)
         AND NOT EXISTS (SELECT 1 FROM time_off WHERE start_at < ? AND end_at > ?)
         AND (SELECT COUNT(*) FROM jobs o WHERE o.id != ? AND o.status != 'cancelled' AND o.local_date = ?) < ?`,
    )
    .bind(
      start.toISOString(), end.toISOString(), day, now(), job.id,
      job.id, new Date(end.getTime() + buffer).toISOString(), new Date(start.getTime() - buffer).toISOString(),
      end.toISOString(), start.toISOString(),
      job.id, day, rules.maxJobsPerDay,
    )
    .run();
  if (result.meta.changes !== 1) throw new ApiError(409, 'slot_taken', PROBLEMS.taken);
  return { booking: await viewBooking(env, token), moved: true, jobId: job.id, from: job.start };
}

/** `{ reason? }`. Kept on the job, so Jacob sees why. */
export async function cancelBooking(env: Bindings, token: string, body: Record<string, unknown>) {
  const job = await byToken(env.DB, token);
  const locked = await lockedReason(env.DB, job);
  if (locked) throw new ApiError(409, 'locked', locked);
  const reason = text(body.reason, 'Reason', 500) ?? null;
  const result = await env.DB
    .prepare(
      `UPDATE jobs SET status = 'cancelled', cancelled_by = 'customer', cancel_reason = ?, updated_at = ?
       WHERE id = ? AND status = 'scheduled'`,
    )
    .bind(reason, now(), job.id)
    .run();
  if (result.meta.changes !== 1) throw new ApiError(409, 'locked', 'This booking just changed. Reload the page.');
  return { booking: await viewBooking(env, token), jobId: job.id, reason };
}

/**
 * For Jacob: the text to send a customer confirming their booking, with their
 * link. Web bookings need one; so do jobs he adds himself.
 */
export async function confirmationText(env: Bindings, jobId: string) {
  const job = await getJob(env.DB, jobId);
  if (job.status === 'cancelled') throw new ApiError(409, 'cancelled', 'That job is cancelled.');
  const { rules } = await currentRules(env.DB);
  const when = new Date(job.start).toLocaleString('en-US', {
    timeZone: rules.timezone, weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  const url = manageUrl(env, job.manageToken);
  const first = job.customer.name.trim().split(/\s+/)[0];
  return {
    url,
    message: `Hi ${first}, this is Jacob with Knock Em' Down Detailing. You're confirmed for ${when} at ${job.address}. ` +
      `To see your booking, move it or cancel: ${url}`,
  };
}
