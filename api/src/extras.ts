import { offerableAddOns } from '@ked/pricing';
import { getJob } from './jobs.ts';
import { mailCustomer } from './notify.ts';
import { currentPricing } from './pricing.ts';
import { ApiError, now, randomToken, text, ulid, type Bindings } from './lib.ts';

/**
 * Add-ons found at the car. Jacob spots yellowed headlights or pet hair,
 * offers the fix with a note and a photo, and the customer taps yes or no on
 * a private link (SITE_URL/approve/?a=<token>). Or they tell him in person and
 * he marks it himself.
 *
 * A yes is money, so it changes the job's price and its invoice together:
 * - no invoice yet: the invoice is built from the quote plus approved add-ons
 *   (see extraLines, used by invoices.ts)
 * - a settled price (finalPrice): it goes up by the add-on
 * - an open invoice: it gets the add-on as a new line
 */

// TENANT: the business's phone. See docs/multi-tenant.md.
const PHONE = '(314) 223-2988';

type Status = 'offered' | 'approved' | 'declined' | 'withdrawn';

interface ExtraRow {
  id: string;
  job_id: string;
  add_on_id: string | null;
  label: string;
  amount: number;
  note: string | null;
  photo_id: string | null;
  status: Status;
  decided_by: 'customer' | 'owner' | null;
  sent_at: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
}

const toExtra = (r: ExtraRow) => ({
  id: r.id,
  jobId: r.job_id,
  addOnId: r.add_on_id,
  label: r.label,
  amount: r.amount,
  note: r.note,
  photoId: r.photo_id,
  status: r.status,
  /** Who said yes or no: the customer on their link, or Jacob for them. */
  decidedBy: r.decided_by,
  sentAt: r.sent_at,
  decidedAt: r.decided_at,
  createdAt: r.created_at,
});

export type Extra = ReturnType<typeof toExtra>;

const approveUrl = (env: Bindings, token: string) =>
  `${(env.SITE_URL || 'https://www.kedservice.com').replace(/\/$/, '')}/approve/?a=${token}`;

const dollars = (c: number) =>
  `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

async function rows(db: D1Database, jobId: string) {
  const { results } = await db.prepare('SELECT * FROM job_extras WHERE job_id = ? ORDER BY id').bind(jobId).all<ExtraRow>();
  return results;
}

/** Approved add-ons as invoice lines, oldest first. invoices.ts adds them to the quote's. */
export async function extraLines(db: D1Database, jobId: string) {
  const { results } = await db
    .prepare("SELECT label, amount FROM job_extras WHERE job_id = ? AND status = 'approved' ORDER BY decided_at, id")
    .bind(jobId)
    .all<{ label: string; amount: number }>();
  return results;
}

/* ------------------------------------------------------------- owner */

/**
 * The job's add-ons, what else from the price list he could offer (priced for
 * this vehicle), and the customer's link once there is one.
 */
export async function listExtras(env: Bindings, jobId: string) {
  const job = await getJob(env.DB, jobId);
  const [extras, { config }, token] = await Promise.all([
    rows(env.DB, jobId),
    currentPricing(env.DB),
    env.DB.prepare('SELECT extras_token FROM jobs WHERE id = ?').bind(jobId).first<{ extras_token: string | null }>(),
  ]);
  const live = new Set(extras.filter((e) => e.status !== 'declined' && e.status !== 'withdrawn').map((e) => e.add_on_id));
  return {
    extras: extras.map(toExtra),
    suggestions: job.service === 'imported' ? [] : offerableAddOns(config, job.input).filter((a) => !live.has(a.id)),
    url: token?.extras_token ? approveUrl(env, token.extras_token) : null,
  };
}

async function openJob(env: Bindings, jobId: string) {
  const job = await getJob(env.DB, jobId);
  if (job.status === 'cancelled') throw new ApiError(409, 'job_cancelled', 'That job was cancelled.');
  if (job.history) throw new ApiError(409, 'history', 'Past jobs from Housecall Pro are already settled.');
  return job;
}

/**
 * `{ addOnId }` prices it from the price list for this vehicle, or
 * `{ label, amount }` for anything else (amount in cents; with an addOnId it
 * overrides the list price). `note` and `photoId` (one of the job's photos)
 * are optional.
 */
export async function offerExtra(env: Bindings, jobId: string, body: Record<string, unknown>) {
  const job = await openJob(env, jobId);
  let addOnId: string | null = null;
  let label = text(body.label, 'Label', 120);
  let amount = body.amount;

  if (body.addOnId !== undefined && body.addOnId !== null) {
    if (typeof body.addOnId !== 'string') throw new ApiError(422, 'invalid', 'addOnId must be text.');
    const { config } = await currentPricing(env.DB);
    const listed = offerableAddOns(config, job.input).find((a) => a.id === body.addOnId);
    if (!listed) throw new ApiError(422, 'invalid', "That add-on isn't on the price list for this job, or it already has it.");
    addOnId = listed.id;
    label ??= listed.label;
    amount ??= listed.amount;
  }
  if (!label) throw new ApiError(422, 'invalid', 'Say what the add-on is.');
  if (!(typeof amount === 'number' && Number.isInteger(amount) && amount > 0 && amount <= 10_000_000)) {
    throw new ApiError(422, 'invalid', 'The price needs to be above zero, in whole cents.');
  }

  let photoId: string | null = null;
  if (body.photoId !== undefined && body.photoId !== null && body.photoId !== '') {
    if (typeof body.photoId !== 'string') throw new ApiError(422, 'invalid', 'photoId must be a photo ID.');
    const photo = await env.DB.prepare("SELECT 1 FROM photos WHERE id = ? AND kind = 'job' AND job_id = ?").bind(body.photoId, jobId).first();
    if (!photo) throw new ApiError(422, 'invalid', "That photo isn't one of this job's.");
    photoId = body.photoId;
  }

  const id = ulid();
  const at = now();
  await env.DB
    .prepare(
      `INSERT INTO job_extras (id, job_id, add_on_id, label, amount, note, photo_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, jobId, addOnId, label, amount, text(body.note, 'Note', 500) ?? null, photoId, at, at)
    .run();
  return getExtra(env.DB, id);
}

async function getExtra(db: D1Database, id: string) {
  const row = await db.prepare('SELECT * FROM job_extras WHERE id = ?').bind(id).first<ExtraRow>();
  if (!row) throw new ApiError(404, 'not_found', 'No add-on with that ID.');
  return toExtra(row);
}

/**
 * Say yes or no. Only an offered add-on can be decided, and only once: the
 * status check is in the UPDATE, so a double tap or two open tabs can't add
 * it twice. A yes then raises the settled price and the open invoice.
 */
async function decide(env: Bindings, row: ExtraRow, yes: boolean, by: 'customer' | 'owner') {
  const at = now();
  const done = await env.DB
    .prepare("UPDATE job_extras SET status = ?, decided_by = ?, decided_at = ?, updated_at = ? WHERE id = ? AND status = 'offered'")
    .bind(yes ? 'approved' : 'declined', by, at, at, row.id)
    .run();
  if (done.meta.changes !== 1) {
    const now = await getExtra(env.DB, row.id);
    throw new ApiError(409, 'decided', now.status === 'withdrawn' ? 'Jacob took this one back.' : `That was already ${now.status === 'approved' ? 'approved' : 'turned down'}.`);
  }
  if (yes) {
    await env.DB.batch([
      env.DB.prepare('UPDATE jobs SET final_price = final_price + ?, updated_at = ? WHERE id = ? AND final_price IS NOT NULL').bind(row.amount, at, row.job_id),
      env.DB
        .prepare(
          `UPDATE invoices SET lines = json_insert(lines, '$[#]', json_object('label', ?, 'amount', ?)), total = total + ?, updated_at = ?
           WHERE job_id = ? AND status = 'open'`,
        )
        .bind(row.label, row.amount, row.amount, at, row.job_id),
    ]);
  }
  return getExtra(env.DB, row.id);
}

/**
 * `{ status: 'approved' | 'declined' }` when the customer told him in person,
 * or `'withdrawn'` to take back one they haven't answered.
 */
export async function updateExtra(env: Bindings, id: string, body: Record<string, unknown>) {
  const row = await env.DB.prepare('SELECT * FROM job_extras WHERE id = ?').bind(id).first<ExtraRow>();
  if (!row) throw new ApiError(404, 'not_found', 'No add-on with that ID.');
  if (body.status === 'approved' || body.status === 'declined') {
    await openJob(env, row.job_id);
    return decide(env, row, body.status === 'approved', 'owner');
  }
  if (body.status === 'withdrawn') {
    const at = now();
    const done = await env.DB
      .prepare("UPDATE job_extras SET status = 'withdrawn', updated_at = ? WHERE id = ? AND status = 'offered'")
      .bind(at, id)
      .run();
    if (done.meta.changes !== 1) throw new ApiError(409, 'decided', 'The customer already answered that one.');
    return getExtra(env.DB, id);
  }
  throw new ApiError(422, 'invalid', 'status must be approved, declined or withdrawn.');
}

/**
 * The text to send with the link, for the admin's clipboard and the app's SMS
 * composer. Also emailed when the customer has an address. Marks what's
 * waiting as sent.
 */
export async function sendExtras(env: Bindings, jobId: string) {
  const job = await openJob(env, jobId);
  const waiting = (await rows(env.DB, jobId)).filter((e) => e.status === 'offered');
  if (!waiting.length) throw new ApiError(409, 'nothing_waiting', 'There are no add-ons waiting on an answer.');

  const at = now();
  const fresh = randomToken();
  // Keep the link it already has, so an earlier text still works.
  await env.DB.batch([
    env.DB.prepare('UPDATE jobs SET extras_token = COALESCE(extras_token, ?) WHERE id = ?').bind(fresh, jobId),
    env.DB.prepare("UPDATE job_extras SET sent_at = ?, updated_at = ? WHERE job_id = ? AND status = 'offered' AND sent_at IS NULL").bind(at, at, jobId),
  ]);
  const { extras_token } = (await env.DB.prepare('SELECT extras_token FROM jobs WHERE id = ?').bind(jobId).first<{ extras_token: string }>())!;
  const url = approveUrl(env, extras_token);

  const vehicle = job.vehicle ? `your ${job.vehicle}` : 'your vehicle';
  const found =
    waiting.length === 1
      ? `something worth fixing: ${waiting[0]!.label}, ${dollars(waiting[0]!.amount)}`
      : `${waiting.length} things worth fixing: ${waiting.map((e) => `${e.label} (${dollars(e.amount)})`).join(', ')}`;
  const message = `Hi ${firstName(job.customer.name)}, Jacob here. While working on ${vehicle} I found ${found}. Take a look and tap yes or no: ${url}`;
  const emailed = job.customer.email
    ? await mailCustomer(env, {
        to: job.customer.email,
        subject: waiting.length === 1 ? `Add ${waiting[0]!.label} to your detail?` : 'A few add-ons for your detail',
        text: `${message}\n\nQuestions? Call or text ${PHONE}.`,
      })
    : false;
  return { url, message, emailed };
}

/* ------------------------------------------------------------- public */

async function jobByToken(db: D1Database, token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new ApiError(404, 'not_found', 'No add-ons at that link.');
  const row = await db.prepare('SELECT id FROM jobs WHERE extras_token = ?').bind(token).first<{ id: string }>();
  if (!row) throw new ApiError(404, 'not_found', 'No add-ons at that link.');
  return getJob(db, row.id);
}

/**
 * What the customer sees: first name only in case the link is forwarded, and
 * nothing Jacob took back. Photos come through this link too, since the
 * regular photo URLs are owner-only.
 */
export async function publicExtras(env: Bindings, token: string) {
  const job = await jobByToken(env.DB, token);
  const extras = (await rows(env.DB, job.id)).filter((e) => e.status !== 'withdrawn');
  return {
    customerName: firstName(job.customer.name),
    vehicle: job.vehicle,
    service: job.quote.lines[0]?.label ?? 'Detail',
    date: job.date,
    /** False once the job is cancelled: they can look, not answer. */
    open: job.status !== 'cancelled',
    extras: extras.map((e) => ({
      id: e.id,
      label: e.label,
      amount: e.amount,
      note: e.note,
      photo: e.photo_id ? `/v1/approve/${token}/photos/${e.photo_id}` : null,
      status: e.status,
    })),
  };
}

/** `{ yes: boolean }`. Returns the page's new state and what Jacob should hear. */
export async function answerExtra(env: Bindings, token: string, extraId: string, body: Record<string, unknown>) {
  const job = await jobByToken(env.DB, token);
  if (job.status === 'cancelled') throw new ApiError(409, 'job_cancelled', `This booking was cancelled. Call or text Jacob at ${PHONE}.`);
  if (typeof body.yes !== 'boolean') throw new ApiError(422, 'invalid', 'Say yes or no.');
  const row = await env.DB.prepare('SELECT * FROM job_extras WHERE id = ? AND job_id = ?').bind(extraId, job.id).first<ExtraRow>();
  if (!row || row.status === 'withdrawn') throw new ApiError(404, 'not_found', 'That add-on is no longer offered.');
  const extra = await decide(env, row, body.yes, 'customer');
  return { page: await publicExtras(env, token), extra, customerName: job.customer.name, jobId: job.id };
}

/** A photo on one of this link's add-ons, and no other. */
export async function extraPhotoId(db: D1Database, token: string, photoId: string) {
  const job = await jobByToken(db, token);
  const ok = await db
    .prepare("SELECT 1 FROM job_extras WHERE job_id = ? AND photo_id = ? AND status != 'withdrawn'")
    .bind(job.id, photoId)
    .first();
  if (!ok) throw new ApiError(404, 'not_found', 'No such photo.');
  return photoId;
}
