import { addDays, localDate } from '@ked/scheduling';
import { currentRules } from './booking.ts';
import { getBrand, siteUrl } from './brand.ts';
import { reviewLink } from './crm-followups.ts';
import { listInvoices } from './invoices.ts';
import { getJob } from './jobs.ts';
import { ApiError, now, randomToken, text, ulid, type Bindings } from './lib.ts';
import { mailCustomer } from './notify.ts';

/**
 * After the job: the "your car's done" page, ceramic coating certificates and
 * the QR stickers that lead back to a car's page.
 *
 * Done page: before and after photos, the invoice and a review button, at
 * <site>/done/?d=<token>. The link works for DONE_DAYS; the photos themselves
 * stay in the app (they're Jacob's portfolio and his proof of the car's
 * condition). The next-day thank-you carries the link automatically.
 *
 * Coatings: a record per coated car with its warranty and upkeep interval, a
 * certificate page at <site>/car/?c=<token> emailed to the customer, and a
 * follow-up on Jacob's list when maintenance comes due (runCoatingReminders).
 *
 * Stickers: a door-jamb QR code, <site>/c/<CODE>. Jacob scans it in the app to
 * tie it to a car; anyone scanning it later (the owner, a buyer) sees the car's
 * coating and service dates and a button to book. No names or prices, since
 * the car may have changed hands.
 */

export const DONE_DAYS = 30;
/** Upkeep this late (past its due date) and the warranty lapses. */
const GRACE_DAYS = 60;
/** Jacob's reminder goes on his list this long before upkeep is due. */
const REMIND_DAYS = 14;

const firstName = (name: string) => name.trim().split(/\s+/)[0] || 'there';

function serviceName(quote: string) {
  try {
    const label = (JSON.parse(quote) as { lines?: { label: string }[] }).lines?.[0]?.label;
    return (label ?? 'Detail').split(' — ')[0]!;
  } catch {
    return 'Detail';
  }
}

function addMonths(date: string, months: number) {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}

const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

function whole(v: unknown, field: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw new ApiError(422, 'invalid', `${field} must be a whole number from ${min} to ${max}.`);
  }
  return v;
}

const pretty = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

async function today(db: D1Database) {
  return localDate(new Date(), (await currentRules(db)).rules.timezone);
}

/* ------------------------------------------------------------ done page */

export const doneUrl = (env: Bindings, token: string) => `${siteUrl(env)}/done/?d=${token}`;

/**
 * The link to a finished job, made on first use and good for DONE_DAYS from
 * now (asking again extends it). Returns the text for Jacob to send.
 */
export async function doneLink(env: Bindings, jobId: string) {
  const job = await getJob(env.DB, jobId);
  if (job.status === 'cancelled') throw new ApiError(409, 'job_cancelled', "That job was cancelled, so there's nothing to show.");
  const expires = new Date(Date.now() + DONE_DAYS * 864e5).toISOString();
  const [[, tokenRow], photos, brand] = await Promise.all([
    env.DB.batch([
      env.DB.prepare('UPDATE jobs SET done_token = COALESCE(done_token, ?), done_expires_at = ? WHERE id = ?').bind(randomToken(), expires, jobId),
      env.DB.prepare('SELECT done_token FROM jobs WHERE id = ?').bind(jobId),
    ]),
    env.DB.prepare("SELECT COUNT(*) AS n FROM photos WHERE job_id = ? AND kind = 'job'").bind(jobId).first<{ n: number }>(),
    getBrand(env),
  ]);
  const { done_token } = tokenRow!.results[0] as { done_token: string };
  const url = doneUrl(env, done_token);
  const vehicle = job.vehicle ? `your ${job.vehicle}` : 'your vehicle';
  const message = photos?.n
    ? `Hi ${firstName(job.customer.name)}, ${brand.owner} here. ${vehicle[0]!.toUpperCase()}${vehicle.slice(1)} is done! Here are the before and after photos: ${url}`
    : `Hi ${firstName(job.customer.name)}, ${brand.owner} here. Thanks for having me out! Everything from today is here: ${url}`;
  return { url, message, expiresAt: expires, photos: photos?.n ?? 0 };
}

/** Called by the daily thank-you rule: tokens for finished jobs with photos, in one statement. */
export function doneTokensStatement(db: D1Database, jobIds: string[]) {
  const expires = new Date(Date.now() + DONE_DAYS * 864e5).toISOString();
  return db
    .prepare(
      `UPDATE jobs SET done_token = COALESCE(done_token, lower(hex(randomblob(24)))),
              done_expires_at = CASE WHEN done_expires_at > ?2 THEN done_expires_at ELSE ?2 END
       WHERE id IN (SELECT value FROM json_each(?1))
       RETURNING id, done_token`,
    )
    .bind(JSON.stringify(jobIds), expires);
}

async function jobByDoneToken(db: D1Database, token: string) {
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) throw new ApiError(404, 'not_found', 'No job at that link.');
  const row = await db.prepare('SELECT id, done_expires_at FROM jobs WHERE done_token = ?').bind(token).first<{ id: string; done_expires_at: string | null }>();
  if (!row) throw new ApiError(404, 'not_found', 'No job at that link.');
  if (row.done_expires_at && row.done_expires_at < now()) {
    throw new ApiError(410, 'expired', 'This link has expired. Text us and we will send a fresh one.');
  }
  return row;
}

/** What the customer sees: first name only, no address, in case the link is forwarded. */
export async function publicDone(env: Bindings, token: string) {
  const row = await jobByDoneToken(env.DB, token);
  const [job, photos, invoices, review] = await Promise.all([
    getJob(env.DB, row.id),
    env.DB.prepare("SELECT id, stage FROM photos WHERE job_id = ? AND kind = 'job' ORDER BY id").bind(row.id).all<{ id: string; stage: string | null }>(),
    listInvoices(env, { jobId: row.id }),
    reviewLink(env.DB),
  ]);
  const inv = invoices.find((i) => i.status !== 'void' && i.status !== 'draft');
  return {
    firstName: firstName(job.customer.name),
    service: serviceName(JSON.stringify(job.quote)),
    vehicle: job.vehicle,
    date: job.date,
    photos: photos.results.map((p) => ({ id: p.id, stage: p.stage })),
    invoice: inv ? { number: inv.number, status: inv.status, balance: inv.balance, url: inv.payUrl } : null,
    reviewUrl: review,
    bookUrl: `${siteUrl(env)}/quote/?utm_source=done-page`,
    expiresAt: row.done_expires_at,
  };
}

/** A photo on a done page: only that job's own job photos, while the link works. */
export async function donePhotoId(db: D1Database, token: string, photoId: string) {
  const row = await jobByDoneToken(db, token);
  const ok = await db.prepare("SELECT 1 FROM photos WHERE id = ? AND job_id = ? AND kind = 'job'").bind(photoId, row.id).first();
  if (!ok) throw new ApiError(404, 'not_found', 'No such photo.');
  return photoId;
}

/* ------------------------------------------------------------- coatings */

interface CoatingRow {
  id: string;
  customer_id: string;
  job_id: string | null;
  vehicle: string | null;
  product: string;
  applied_on: string;
  warranty_months: number;
  maintenance_months: number;
  maintained: string;
  notes: string | null;
  token: string;
  created_at: string;
  updated_at: string;
  voided_at: string | null;
}

export const certificateUrl = (env: Bindings, token: string) => `${siteUrl(env)}/car/?c=${token}`;

/** Warranty end, next upkeep and where it stands, as of `on`. */
function standing(r: CoatingRow, on: string) {
  const maintained = (JSON.parse(r.maintained) as { date: string; jobId: string | null }[]).sort((a, b) => a.date.localeCompare(b.date));
  const warrantyUntil = addMonths(r.applied_on, r.warranty_months);
  const last = maintained.at(-1)?.date ?? r.applied_on;
  const next = r.maintenance_months ? addMonths(last, r.maintenance_months) : null;
  // Upkeep that falls after the warranty ends isn't required for it.
  const nextMaintenance = next && next <= warrantyUntil ? next : null;
  const status = r.voided_at
    ? 'void'
    : on > warrantyUntil
      ? 'expired'
      : nextMaintenance && on > addDays(nextMaintenance, GRACE_DAYS)
        ? 'lapsed'
        : nextMaintenance && on >= addDays(nextMaintenance, -30)
          ? 'due'
          : 'active';
  return { maintained, warrantyUntil, nextMaintenance, status: status as 'active' | 'due' | 'lapsed' | 'expired' | 'void' };
}

function toCoating(env: Bindings, r: CoatingRow, tags: string[], on: string) {
  const s = standing(r, on);
  return {
    id: r.id,
    customerId: r.customer_id,
    jobId: r.job_id,
    vehicle: r.vehicle,
    product: r.product,
    appliedOn: r.applied_on,
    warrantyMonths: r.warranty_months,
    maintenanceMonths: r.maintenance_months,
    warrantyUntil: s.warrantyUntil,
    nextMaintenance: s.nextMaintenance,
    status: s.status,
    maintained: s.maintained,
    notes: r.notes,
    url: certificateUrl(env, r.token),
    tags,
    createdAt: r.created_at,
  };
}

export type Coating = ReturnType<typeof toCoating>;

export async function listCoatings(env: Bindings, q: { customerId?: string; jobId?: string }) {
  const where: string[] = [];
  const binds: string[] = [];
  if (q.customerId) (where.push('c.customer_id = ?'), binds.push(q.customerId));
  if (q.jobId) (where.push('c.job_id = ?'), binds.push(q.jobId));
  const [{ results }, on] = await Promise.all([
    env.DB
      .prepare(
        `SELECT c.*, (SELECT json_group_array(t.code) FROM car_tags t WHERE t.coating_id = c.id) AS tag_codes
         FROM coatings c ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY c.applied_on DESC LIMIT 200`,
      )
      .bind(...binds)
      .all<CoatingRow & { tag_codes: string }>(),
    today(env.DB),
  ]);
  return results.map((r) => toCoating(env, r, JSON.parse(r.tag_codes) as string[], on));
}

export async function getCoating(env: Bindings, id: string) {
  const [row, tags, on] = await Promise.all([
    env.DB.prepare('SELECT * FROM coatings WHERE id = ?').bind(id).first<CoatingRow>(),
    env.DB.prepare('SELECT code FROM car_tags WHERE coating_id = ? ORDER BY linked_at').bind(id).all<{ code: string }>(),
    today(env.DB),
  ]);
  if (!row) throw new ApiError(404, 'not_found', 'No coating with that ID.');
  return toCoating(env, row, tags.results.map((t) => t.code), on);
}

function coatingFields(body: Record<string, unknown>, partial: boolean) {
  const out: Record<string, unknown> = {};
  if (!partial || body.product !== undefined) {
    const product = text(body.product, 'Product', 80);
    if (!product) throw new ApiError(422, 'invalid', 'Say which coating it is, like "Gtechniq Crystal Serum Light".');
    out.product = product;
  }
  if (!partial || body.warrantyMonths !== undefined) out.warranty_months = whole(body.warrantyMonths, 'Warranty months', 1, 240);
  if (body.maintenanceMonths !== undefined) out.maintenance_months = whole(body.maintenanceMonths, 'Maintenance every (months)', 0, 60);
  if (body.appliedOn !== undefined) {
    if (!isDate(body.appliedOn)) throw new ApiError(422, 'invalid', 'The date it was applied should look like 2026-09-25.');
    out.applied_on = body.appliedOn;
  }
  if (body.vehicle !== undefined) out.vehicle = text(body.vehicle, 'Vehicle', 120) ?? null;
  if (body.notes !== undefined) out.notes = text(body.notes, 'Notes', 1000) ?? null;
  return out;
}

/** `{ jobId, product, warrantyMonths, maintenanceMonths?, appliedOn?, vehicle?, notes? }`. Emails the certificate. */
export async function createCoating(env: Bindings, body: Record<string, unknown>) {
  if (typeof body.jobId !== 'string') throw new ApiError(422, 'invalid', 'Which job was the coating applied on?');
  const job = await getJob(env.DB, body.jobId);
  if (job.status === 'cancelled') throw new ApiError(409, 'job_cancelled', "That job was cancelled, so it can't carry a coating.");
  const f = coatingFields(body, false);
  const id = ulid();
  const stamp = now();
  await env.DB
    .prepare(
      `INSERT INTO coatings (id, customer_id, job_id, vehicle, product, applied_on, warranty_months, maintenance_months, notes, token,
                             created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id, job.customer.id, job.id, f.vehicle === undefined ? job.vehicle : f.vehicle, f.product, f.applied_on ?? job.date,
      f.warranty_months, f.maintenance_months ?? 12, f.notes ?? null, randomToken(), stamp, stamp,
    )
    .run();
  const coating = await getCoating(env, id);
  const brand = await getBrand(env);
  const first = firstName(job.customer.name);
  const car = coating.vehicle ? `your ${coating.vehicle}` : 'your vehicle';
  const upkeep = coating.maintenanceMonths
    ? `To keep the warranty, it needs a quick maintenance visit every ${coating.maintenanceMonths === 12 ? 'year' : `${coating.maintenanceMonths} months`}. I'll remind you when it's due.`
    : '';
  const emailed = job.customer.email
    ? await mailCustomer(env, {
        to: job.customer.email,
        subject: `Your coating certificate from ${brand.name}`,
        text: [
          `Hi ${first},`,
          '',
          `Thanks for trusting ${brand.name} with ${car}. Your ${coating.product} coating is covered until ${pretty(coating.warrantyUntil)}.`,
          '',
          `Your certificate and care guide: ${coating.url}`,
          '',
          upkeep,
          '',
          brand.owner,
        ].join('\n'),
      }).catch(() => false)
    : false;
  const message = `Hi ${first}, it's ${brand.owner}. Here's the certificate and care guide for the ${coating.product} coating on ${car}: ${coating.url}`;
  return { coating, message, emailed };
}

export async function updateCoating(env: Bindings, id: string, body: Record<string, unknown>) {
  await getCoating(env, id);
  const f = coatingFields(body, true);
  const keys = Object.keys(f);
  if (keys.length) {
    await env.DB
      .prepare(`UPDATE coatings SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .bind(...keys.map((k) => f[k]), now(), id)
      .run();
  }
  return getCoating(env, id);
}

/** `{ date?, jobId? }`: a maintenance visit, which restarts the upkeep clock. */
export async function logMaintenance(env: Bindings, id: string, body: Record<string, unknown>) {
  const c = await getCoating(env, id);
  if (c.status === 'void') throw new ApiError(409, 'void', 'That coating is void.');
  const date = body.date === undefined ? await today(env.DB) : body.date;
  if (!isDate(date)) throw new ApiError(422, 'invalid', 'The date should look like 2026-09-25.');
  if (date < c.appliedOn) throw new ApiError(422, 'invalid', "Maintenance can't be before the coating went on.");
  let jobId: string | null = null;
  if (body.jobId !== undefined && body.jobId !== null) jobId = (await getJob(env.DB, String(body.jobId))).id;
  const maintained = [...c.maintained, { date, jobId }].sort((a, b) => a.date.localeCompare(b.date));
  await env.DB.prepare('UPDATE coatings SET maintained = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(maintained), now(), id).run();
  return getCoating(env, id);
}

export async function voidCoating(env: Bindings, id: string) {
  const c = await getCoating(env, id);
  if (c.status === 'void') throw new ApiError(409, 'void', 'That coating is already void.');
  await env.DB.prepare('UPDATE coatings SET voided_at = ?, updated_at = ? WHERE id = ?').bind(now(), now(), id).run();
  return getCoating(env, id);
}

/**
 * Daily: a follow-up on Jacob's list for each coating whose upkeep is due in
 * the next REMIND_DAYS, once per due date. It's a ready text or email for him
 * to send, never sent automatically.
 */
export async function runCoatingReminders(env: Bindings, at = new Date()) {
  const db = env.DB;
  const [{ rules }, brand, { results }] = await Promise.all([
    currentRules(db),
    getBrand(env),
    db
      .prepare(
        `SELECT c.*, cu.name, cu.phone, cu.email, cu.text_ok, cu.email_ok
         FROM coatings c JOIN customers cu ON cu.id = c.customer_id
         WHERE c.voided_at IS NULL AND c.maintenance_months > 0`,
      )
      .all<CoatingRow & { name: string; phone: string | null; email: string | null; text_ok: number; email_ok: number }>(),
  ]);
  const on = localDate(at, rules.timezone);
  const quote = `${siteUrl(env)}/quote/?utm_source=coating-reminder`;
  const out = [];
  for (const r of results) {
    const s = standing(r, on);
    if (!s.nextMaintenance || s.status === 'expired' || s.status === 'lapsed') continue;
    if (on < addDays(s.nextMaintenance, -REMIND_DAYS)) continue;
    const car = r.vehicle ?? 'car';
    out.push({
      id: ulid(),
      customerId: r.customer_id,
      jobId: r.job_id,
      dueDate: on,
      channel: r.phone && r.text_ok ? 'text' : r.email && r.email_ok ? 'email' : r.phone ? 'call' : null,
      title: `Coating upkeep due ${pretty(s.nextMaintenance)}: ${r.name}, ${car}`,
      subject: `Time for your coating maintenance`,
      message:
        `Hi ${firstName(r.name)}, it's ${brand.owner} with ${brand.name}. The ${r.product} coating on your ${car} is due for its maintenance visit ` +
        `around ${pretty(s.nextMaintenance)}. It keeps the warranty going and the water beading. Want to set it up? ${quote}\n\nOr just text me back.`,
      ruleKey: `coating:${r.id}:${s.nextMaintenance}`,
    });
  }
  if (!out.length) return { created: 0 };
  const stamp = now();
  const { results: made } = await db
    .prepare(
      `INSERT OR IGNORE INTO follow_ups (id, customer_id, job_id, kind, due_date, status, channel, title, message, subject, rule_key,
                                         created_at, updated_at)
       SELECT json_extract(x.value, '$.id'), json_extract(x.value, '$.customerId'), json_extract(x.value, '$.jobId'), 'custom',
              json_extract(x.value, '$.dueDate'), 'open', json_extract(x.value, '$.channel'), json_extract(x.value, '$.title'),
              json_extract(x.value, '$.message'), json_extract(x.value, '$.subject'), json_extract(x.value, '$.ruleKey'), ?2, ?2
       FROM json_each(?1) x
       RETURNING id`,
    )
    .bind(JSON.stringify(out), stamp)
    .all();
  return { created: made.length };
}

/* ------------------------------------------------------------- stickers */

const CODE = /^[A-Z0-9]{4,16}$/;
export const tagUrl = (env: Bindings, code: string) => `${siteUrl(env)}/c/${code}`;

/** A sticker code from what was typed or scanned: the code itself or its whole URL. */
export function parseCode(v: unknown): string {
  if (typeof v !== 'string') throw new ApiError(422, 'invalid', "That isn't a sticker code.");
  const raw = v.trim();
  const fromUrl = raw.match(/\/c\/([A-Za-z0-9]+)/)?.[1];
  const code = (fromUrl ?? raw).toUpperCase();
  if (!CODE.test(code)) throw new ApiError(422, 'invalid', "That doesn't look like one of our stickers.");
  return code;
}

interface TagRow {
  code: string;
  customer_id: string;
  vehicle: string | null;
  job_id: string | null;
  coating_id: string | null;
  linked_at: string;
}

const toTag = (env: Bindings, r: TagRow) => ({
  code: r.code,
  url: tagUrl(env, r.code),
  customerId: r.customer_id,
  vehicle: r.vehicle,
  coatingId: r.coating_id,
  jobId: r.job_id,
  linkedAt: r.linked_at,
});

const sameCar = (a: string | null, b: string | null) => (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();

/** `{ code, jobId, coatingId? }`: put a sticker on the job's car. */
export async function linkTag(env: Bindings, body: Record<string, unknown>, by: string) {
  const code = parseCode(body.code);
  if (typeof body.jobId !== 'string') throw new ApiError(422, 'invalid', 'Which job is the sticker for?');
  const job = await getJob(env.DB, body.jobId);
  let coatingId: string | null = null;
  let vehicle = job.vehicle;
  if (body.coatingId !== undefined && body.coatingId !== null) {
    const c = await getCoating(env, String(body.coatingId));
    if (c.customerId !== job.customer.id) throw new ApiError(422, 'invalid', "That coating is on another customer's car.");
    coatingId = c.id;
    vehicle = c.vehicle ?? vehicle;
  }
  const existing = await env.DB.prepare('SELECT * FROM car_tags WHERE code = ?').bind(code).first<TagRow>();
  if (existing) {
    if (existing.customer_id !== job.customer.id || !sameCar(existing.vehicle, vehicle)) {
      throw new ApiError(409, 'taken', 'That sticker is already on another car. Use a fresh one, or take it off that car first.');
    }
    await env.DB
      .prepare('UPDATE car_tags SET coating_id = COALESCE(?, coating_id), job_id = ? WHERE code = ?')
      .bind(coatingId, job.id, code)
      .run();
    const row = (await env.DB.prepare('SELECT * FROM car_tags WHERE code = ?').bind(code).first<TagRow>())!;
    return { tag: toTag(env, row), created: false };
  }
  await env.DB
    .prepare('INSERT INTO car_tags (code, customer_id, vehicle, job_id, coating_id, linked_at, linked_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(code, job.customer.id, vehicle, job.id, coatingId, now(), by)
    .run();
  const row = (await env.DB.prepare('SELECT * FROM car_tags WHERE code = ?').bind(code).first<TagRow>())!;
  return { tag: toTag(env, row), created: true };
}

export async function listTags(env: Bindings, customerId?: string) {
  const { results } = customerId
    ? await env.DB.prepare('SELECT * FROM car_tags WHERE customer_id = ? ORDER BY linked_at DESC').bind(customerId).all<TagRow>()
    : await env.DB.prepare('SELECT * FROM car_tags ORDER BY linked_at DESC LIMIT 500').all<TagRow>();
  return results.map((r) => toTag(env, r));
}

export async function unlinkTag(env: Bindings, code: string) {
  const c = parseCode(code);
  const { meta } = await env.DB.prepare('DELETE FROM car_tags WHERE code = ?').bind(c).run();
  if (!meta.changes) throw new ApiError(404, 'not_found', 'That sticker isn\'t on any car.');
}

/* ------------------------------------------------------------ car page */

/**
 * The public page for a car, by sticker code or certificate token: the
 * coating's certificate and upkeep, and the dates of work done on it.
 */
export async function publicCar(env: Bindings, by: { code: string } | { token: string }) {
  let customerId: string;
  let vehicle: string | null;
  let coating: CoatingRow | null = null;
  let code: string | null = null;
  if ('code' in by) {
    code = parseCode(by.code);
    const tag = await env.DB.prepare('SELECT * FROM car_tags WHERE code = ?').bind(code).first<TagRow>();
    if (!tag) throw new ApiError(404, 'not_found', "This sticker hasn't been set up yet.");
    customerId = tag.customer_id;
    vehicle = tag.vehicle;
    coating = tag.coating_id
      ? await env.DB.prepare('SELECT * FROM coatings WHERE id = ? AND voided_at IS NULL').bind(tag.coating_id).first<CoatingRow>()
      : await env.DB
          .prepare(
            `SELECT * FROM coatings WHERE customer_id = ? AND voided_at IS NULL AND lower(COALESCE(vehicle, '')) = lower(COALESCE(?, ''))
             ORDER BY applied_on DESC LIMIT 1`,
          )
          .bind(customerId, vehicle)
          .first<CoatingRow>();
  } else {
    if (!/^[A-Za-z0-9_-]{40,64}$/.test(by.token)) throw new ApiError(404, 'not_found', 'No certificate at that link.');
    coating = await env.DB.prepare('SELECT * FROM coatings WHERE token = ? AND voided_at IS NULL').bind(by.token).first<CoatingRow>();
    if (!coating) throw new ApiError(404, 'not_found', 'No certificate at that link.');
    customerId = coating.customer_id;
    vehicle = coating.vehicle;
  }
  const [{ results: jobs }, on] = await Promise.all([
    env.DB
      .prepare(
        `SELECT local_date, quote FROM jobs
         WHERE customer_id = ?1 AND status = 'done' AND (?2 IS NULL OR vehicle IS NULL OR lower(vehicle) = lower(?2))
         ORDER BY start_at DESC LIMIT 20`,
      )
      .bind(customerId, vehicle)
      .all<{ local_date: string; quote: string }>(),
    today(env.DB),
  ]);
  const s = coating ? standing(coating, on) : null;
  return {
    vehicle,
    coating:
      coating && s
        ? {
            product: coating.product,
            appliedOn: coating.applied_on,
            warrantyMonths: coating.warranty_months,
            warrantyUntil: s.warrantyUntil,
            maintenanceMonths: coating.maintenance_months,
            nextMaintenance: s.nextMaintenance,
            maintained: s.maintained.map((m) => m.date),
            status: s.status,
            certificate: coating.id.slice(-8),
          }
        : null,
    history: jobs.map((j) => ({ date: j.local_date, service: serviceName(j.quote) })),
    bookUrl: `${siteUrl(env)}/quote/?utm_source=${code ? 'sticker' : 'certificate'}`,
  };
}
