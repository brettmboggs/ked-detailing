import { Hono } from 'hono';
import { localDate } from '@ked/scheduling';
import type { AppEnv } from './app-env.ts';
import { requireOwner, type Owner } from './auth.ts';
import { MAX_TAGS, getCustomer, referralCode, toCustomer, updateCustomer, type CustomerRow } from './customers.ts';
import { STATS_CTE, readSegment, segmentCustomers, type CustomerStats } from './crm-segments.ts';
import { listInvoices } from './invoices.ts';
import { customerJobs } from './jobs.ts';
import { ApiError, json, now, text, ulid, type Bindings } from './lib.ts';

/**
 * Customer records beyond the basics: the CRM list and CSV export, one
 * customer's profile (numbers, referral code, jobs, invoices, payments, open
 * follow-ups and the timeline), notes and calls, tags, and merging duplicates.
 * Mounted at /v1/crm/customers. See docs/crm.md.
 *
 * Plain edits (name, phone, tags, source, consent, referred by) go through
 * `updateCustomer` in customers.ts, so PATCH /v1/customers/:id and
 * PATCH /v1/crm/customers/:id accept the same fields.
 */
export const customers = new Hono<AppEnv>();
customers.use('*', requireOwner);

const TZ = 'America/Chicago';
const who = (o: Owner) => o.email ?? o.subject;

function segmentFrom(raw: string | undefined) {
  try {
    return readSegment(JSON.parse(raw || '{}'));
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(422, 'invalid_segment', 'segment must be JSON.');
  }
}

/**
 * Customers with their numbers, filtered and sorted by a segment passed as
 * JSON in ?segment= (see crm-segments.ts). Leads without a job are included.
 */
customers.get('/', async (c) => c.json({ customers: await segmentCustomers(c.env.DB, segmentFrom(c.req.query('segment'))) }));

/** Every tag in use, most used first, for the list's filter. */
customers.get('/tags', async (c) => {
  const { results } = await c.env.DB
    .prepare(
      `SELECT t.value AS tag, COUNT(*) AS count FROM customers c, json_each(c.tags) t
       GROUP BY t.value ORDER BY count DESC, t.value LIMIT 200`,
    )
    .all<{ tag: string; count: number }>();
  return c.json({ tags: results });
});

/** The same segment as GET /, as a spreadsheet. Up to 2,000 rows. */
customers.get('/export', async (c) => {
  const seg = { ...segmentFrom(c.req.query('segment')), limit: 2000 };
  const rows = await segmentCustomers(c.env.DB, seg);
  const day = localDate(new Date(), TZ);
  return new Response(customersCsv(rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="ked-customers-${day}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
});

/** People who look like the same person twice: same phone, email or name. */
customers.get('/duplicates', async (c) => c.json({ groups: await findDuplicates(c.env.DB) }));

customers.get('/:id', async (c) => c.json(await customerProfile(c.env, c.req.param('id'))));

/** Same fields as PATCH /v1/customers/:id, including tags, source, sourceDetail, emailOk, textOk, referredBy. */
customers.patch('/:id', async (c) => c.json(await updateCustomer(c.env.DB, c.req.param('id'), await json(c.req.raw))));

customers.post('/:id/activities', async (c) =>
  c.json(await addActivity(c.env.DB, c.req.param('id'), await json(c.req.raw), who(c.get('owner'))), 201),
);
customers.patch('/:id/activities/:activityId', async (c) =>
  c.json(await editActivity(c.env.DB, c.req.param('id'), c.req.param('activityId'), await json(c.req.raw))),
);
customers.delete('/:id/activities/:activityId', async (c) => {
  await deleteActivity(c.env.DB, c.req.param('id'), c.req.param('activityId'));
  return c.body(null, 204);
});

/** `{ otherId }`: the two become one. The older record stays; see mergeCustomers. */
customers.post('/:id/merge', async (c) => {
  const body = await json(c.req.raw);
  const other = text(body.otherId, 'The other customer', 40);
  if (!other) throw new ApiError(422, 'invalid', 'Pick the other customer to merge with.');
  return c.json(await mergeCustomers(c.env.DB, c.req.param('id'), other, who(c.get('owner'))));
});

/* ------------------------------------------------------------ CSV */

/** A cell, quoted, with spreadsheet formulas defused (a name starting "=" stays text). */
function cell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function customersCsv(rows: CustomerStats[]): string {
  const head = ['Name', 'Phone', 'Email', 'Visits', 'Spent', 'Last visit', 'Next booking', 'Source', 'Tags', 'Can email', 'Can text'];
  const lines = rows.map((r) =>
    [
      r.name,
      r.phone,
      r.email,
      r.visits,
      (r.spend / 100).toFixed(2),
      r.lastVisit,
      r.nextVisit ? localDate(r.nextVisit, TZ) : '',
      r.source,
      r.tags.join('; '),
      r.email && r.emailOk ? 'yes' : 'no',
      r.phone && r.textOk ? 'yes' : 'no',
    ]
      .map(cell)
      .join(','),
  );
  return `﻿${[head.join(','), ...lines].join('\r\n')}\r\n`;
}

/* ------------------------------------------------------------ profile */

interface StatsRow extends CustomerRow {
  visits: number;
  spend: number;
  first_visit: string | null;
  last_visit: string | null;
  next_visit: string | null;
  services: string | null;
  last_service: string | null;
  zip: string | null;
  referrals: number;
  referrer_name: string | null;
}

interface ActivityRow {
  id: string;
  customer_id: string | null;
  lead_id: string | null;
  job_id: string | null;
  kind: string;
  body: string | null;
  meta: string | null;
  created_at: string;
  created_by: string;
}

interface LeadRow {
  id: string;
  status: string;
  vehicle: string | null;
  zip: string | null;
  notes: string | null;
  quote: string;
  source: string | null;
  created_at: string;
}

interface FollowUpRow {
  id: string;
  kind: string;
  due_date: string;
  status: string;
  channel: string | null;
  title: string;
  message: string | null;
  job_id: string | null;
  lead_id: string | null;
  created_at: string;
}

interface PaymentRow {
  id: string;
  date: string;
  method: string | null;
  job_id: string;
  amount: number;
  tip: number;
}

/** Kinds Jacob writes himself from the profile, and may edit or delete later. */
const OWN_KINDS = ['note', 'call', 'text'] as const;

export type TimelineItem = {
  /** activity kinds (note, call, text, email, review_request, referral, system), or job, invoice, payment, quote. */
  type: string;
  id: string;
  /** When it happened, ISO. Payments only have a day; they sit at 1 PM Central. */
  at: string;
  title: string;
  body: string | null;
  amount?: number | null;
  jobId?: string | null;
  invoiceId?: string | null;
  /** The job's day or the payment's day, YYYY-MM-DD. */
  date?: string;
  status?: string;
  meta?: Record<string, unknown> | null;
  by?: string;
  /** Jacob's own notes, calls and texts can be edited and deleted. */
  editable?: boolean;
};

const serviceOf = (quote: { lines?: { label?: string }[] } | null, fallback = 'Detail') =>
  (quote?.lines?.[0]?.label ?? fallback).split(' — ')[0]!;

const parse = <T>(s: string | null | undefined, fallback: T): T => {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

function activityTitle(a: { kind: string; body: string | null; meta: Record<string, unknown> | null }) {
  const inbound = a.meta?.direction === 'in';
  switch (a.kind) {
    case 'note':
      return 'Note';
    case 'call':
      return inbound ? 'They called' : 'Called them';
    case 'text':
      return inbound ? 'They texted' : 'Texted them';
    case 'email':
      return `Email: ${(a.body ?? '').split('\n')[0]!.slice(0, 120) || 'sent'}`;
    case 'review_request':
      return 'Asked for a review';
    case 'referral':
      return 'Referral';
    default:
      return 'Update';
  }
}

export function toActivity(r: ActivityRow): TimelineItem {
  const meta = parse<Record<string, unknown> | null>(r.meta, null);
  const body = r.kind === 'email' ? (r.body ?? '').split('\n').slice(2).join('\n').trim() || null : r.body;
  return {
    type: r.kind,
    id: r.id,
    at: r.created_at,
    title: activityTitle({ kind: r.kind, body: r.body, meta }),
    body,
    jobId: r.job_id,
    meta,
    by: r.created_by,
    editable: (OWN_KINDS as readonly string[]).includes(r.kind) && r.created_by !== 'system',
  };
}

/**
 * Everything about one customer in one response: their numbers, where they
 * came from, their referral code and who they sent, jobs, invoices, payments,
 * quote requests, open follow-ups, and the timeline (all of it merged, newest
 * first). About a dozen queries, whatever their history.
 */
export async function customerProfile(env: Bindings, id: string, at = new Date()) {
  const db = env.DB;
  const [statsRes, leadsRes, actsRes, followRes, referredRes, paymentsRes] = await db.batch([
    db
      .prepare(
        `WITH ${STATS_CTE}
         SELECT c.*, s.*, (SELECT r.name FROM customers r WHERE r.id = c.referred_by) AS referrer_name
         FROM customers c JOIN stats s ON s.customer_id = c.id WHERE c.id = ?2`,
      )
      .bind(at.toISOString(), id),
    db.prepare('SELECT * FROM leads WHERE customer_id = ? ORDER BY id DESC LIMIT 50').bind(id),
    db
      .prepare(
        `SELECT * FROM activities
         WHERE customer_id = ?1 OR lead_id IN (SELECT id FROM leads WHERE customer_id = ?1)
         ORDER BY created_at DESC, id DESC LIMIT 300`,
      )
      .bind(id),
    db.prepare("SELECT * FROM follow_ups WHERE customer_id = ? AND status = 'open' ORDER BY due_date, id LIMIT 50").bind(id),
    db
      .prepare(
        `SELECT r.id, r.name, r.created_at,
                (SELECT COUNT(*) FROM jobs j WHERE j.customer_id = r.id AND j.status = 'done') AS visits
         FROM customers r WHERE r.referred_by = ? ORDER BY r.id DESC LIMIT 100`,
      )
      .bind(id),
    db
      .prepare(
        `SELECT e.id, e.date, e.method, e.job_id, SUM(l.amount) AS amount,
                EXISTS (SELECT 1 FROM entry_lines t WHERE t.entry_id = e.id AND t.account_id = 'income-tips') AS tip
         FROM entries e JOIN entry_lines l ON l.entry_id = e.id JOIN accounts a ON a.id = l.account_id
         WHERE e.job_id IN (SELECT id FROM jobs WHERE customer_id = ?) AND e.kind = 'income'
           AND e.voided_by IS NULL AND a.money_account = 1 AND l.amount > 0
         GROUP BY e.id ORDER BY e.date DESC, e.id DESC LIMIT 200`,
      )
      .bind(id),
  ]);
  const row = (statsRes!.results as StatsRow[])[0];
  if (!row) throw new ApiError(404, 'not_found', 'No customer with that ID.');

  const [jobs, invoices] = await Promise.all([customerJobs(db, id), listInvoices(env, { customerId: id })]);

  // Customers from before referral codes get theirs the first time anyone looks.
  if (!row.referral_code) row.referral_code = await giveReferralCode(db, id);

  const leads = leadsRes!.results as LeadRow[];
  const acts = actsRes!.results as ActivityRow[];
  const follow = followRes!.results as FollowUpRow[];
  const referred = referredRes!.results as { id: string; name: string; created_at: string; visits: number }[];
  const payments = (paymentsRes!.results as PaymentRow[]).map((p) => ({
    id: p.id,
    date: p.date,
    amount: Number(p.amount),
    method: p.method,
    jobId: p.job_id,
    tip: !!p.tip,
  }));

  /* numbers */
  const visits = Number(row.visits);
  const spend = Number(row.spend);
  const visitDays = [...new Set(jobs.filter((j) => j.status === 'done').map((j) => j.date))].sort();
  const span = visitDays.length >= 2 ? (Date.parse(visitDays.at(-1)!) - Date.parse(visitDays[0]!)) / 864e5 : null;
  const everyDays = span !== null && span > 0 ? Math.round(span / (visitDays.length - 1)) : null;
  const created = localDate(row.created_at, TZ);
  const openInvoices = invoices.filter((i) => i.status === 'draft' || i.status === 'sent');

  const numbers = {
    visits,
    spend,
    avgTicket: visits ? Math.round(spend / visits) : null,
    firstVisit: row.first_visit,
    lastVisit: row.last_visit,
    lastService: row.last_service,
    nextVisit: row.next_visit,
    /** The earlier of the day they were added and their first visit (imports bring older visits). */
    customerSince: row.first_visit && row.first_visit < created ? row.first_visit : created,
    /** Average days between visits, once they've come at least twice on different days. */
    everyDays,
    services: parse<(string | null)[]>(row.services, []).filter((s): s is string => !!s),
    zip: row.zip,
    referrals: Number(row.referrals),
    paid: payments.filter((p) => !p.tip).reduce((s, p) => s + p.amount, 0),
    tips: payments.filter((p) => p.tip).reduce((s, p) => s + p.amount, 0),
    owed: openInvoices.reduce((s, i) => s + i.balance, 0),
  };

  /* timeline */
  const timeline: TimelineItem[] = acts.map(toActivity);
  for (const j of jobs) {
    const service = j.service === 'imported' ? serviceOf(j.quote, 'Past job') : serviceOf(j.quote);
    const value = j.finalPrice ?? j.quote?.total ?? null;
    const base = { id: j.id, jobId: j.id, date: j.date, status: j.status, amount: value, body: j.notes };
    if (j.status === 'done') timeline.push({ ...base, type: 'job', at: j.start, title: `Job done: ${service}` });
    else if (j.status === 'cancelled') timeline.push({ ...base, type: 'job', at: j.updatedAt, title: `Cancelled: ${service}`, body: j.cancelReason ?? null });
    else timeline.push({ ...base, type: 'job', at: j.createdAt, title: `Booked: ${service}` });
  }
  for (const i of invoices) {
    const base = { type: 'invoice', id: i.id, invoiceId: i.id, jobId: i.jobId, amount: i.total, status: i.status, body: null };
    if (i.voidedAt) timeline.push({ ...base, at: i.voidedAt, title: `Invoice ${i.number} voided` });
    else timeline.push({ ...base, at: i.sentAt ?? i.createdAt, title: `Invoice ${i.number} ${i.sentAt ? 'sent' : 'made'}` });
  }
  for (const p of payments) {
    timeline.push({
      type: 'payment',
      id: p.id,
      at: `${p.date}T18:00:00.000Z`,
      date: p.date,
      title: p.tip ? 'Tip' : 'Paid',
      body: p.method,
      amount: p.amount,
      jobId: p.jobId,
    });
  }
  const quoteRequests = leads.map((l) => {
    const quote = parse<{ lines?: { label?: string }[]; range?: [number, number] | null; total?: number } | null>(l.quote, null);
    return {
      id: l.id,
      status: l.status,
      service: serviceOf(quote, 'Quote'),
      vehicle: l.vehicle,
      zip: l.zip,
      notes: l.notes,
      range: quote?.range ?? null,
      source: l.source,
      createdAt: l.created_at,
    };
  });
  for (const q of quoteRequests) {
    timeline.push({
      type: 'quote',
      id: q.id,
      at: q.createdAt,
      title: `Asked for a quote: ${q.service}`,
      body: q.notes,
      status: q.status,
      meta: { range: q.range, vehicle: q.vehicle },
    });
  }
  timeline.sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));

  const site = (env.SITE_URL || 'https://www.kedservice.com').replace(/\/$/, '');
  return {
    customer: { ...toCustomer(row), referralCode: row.referral_code },
    numbers,
    referral: {
      code: row.referral_code,
      url: `${site}/?ref=${row.referral_code}`,
      referredBy: row.referred_by ? { id: row.referred_by, name: row.referrer_name ?? 'Unknown' } : null,
      referred: referred.map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at, visits: Number(r.visits) })),
    },
    jobs,
    invoices,
    payments,
    quoteRequests,
    followUps: follow.map((f) => ({
      id: f.id,
      kind: f.kind,
      dueDate: f.due_date,
      channel: f.channel,
      title: f.title,
      message: f.message,
      jobId: f.job_id,
      leadId: f.lead_id,
      createdAt: f.created_at,
    })),
    timeline: timeline.slice(0, 400),
  };
}

/** Sets a referral code if they have none; a clash with another code just tries again. */
async function giveReferralCode(db: D1Database, id: string): Promise<string> {
  for (let tries = 0; tries < 5; tries++) {
    try {
      const r = await db
        .prepare('UPDATE customers SET referral_code = COALESCE(referral_code, ?) WHERE id = ? RETURNING referral_code')
        .bind(referralCode(), id)
        .first<{ referral_code: string }>();
      if (r) return r.referral_code;
    } catch (err) {
      if (!/UNIQUE/i.test(String(err))) throw err;
    }
  }
  throw new ApiError(500, 'referral_code', "Couldn't make a referral code. Try again.");
}

/* ------------------------------------------------------------ timeline writes */

function readOwnActivity(body: Record<string, unknown>, kind: string) {
  const text_ = text(body.body, 'The note', 5000) ?? null;
  if (kind === 'note' && !text_) throw new ApiError(422, 'invalid', 'Write something in the note.');
  let meta: Record<string, unknown> | null = null;
  if (kind === 'call' || kind === 'text') {
    const direction = body.direction ?? 'out';
    if (direction !== 'in' && direction !== 'out') throw new ApiError(422, 'invalid', 'direction must be "in" or "out".');
    meta = { direction };
  }
  return { body: text_, meta };
}

/** `{ kind: 'note' | 'call' | 'text', body, direction?: 'out' | 'in' }`. */
export async function addActivity(db: D1Database, customerId: string, body: Record<string, unknown>, by: string) {
  const kind = body.kind ?? 'note';
  if (typeof kind !== 'string' || !(OWN_KINDS as readonly string[]).includes(kind)) {
    throw new ApiError(422, 'invalid', 'kind must be note, call or text.');
  }
  const a = readOwnActivity(body, kind);
  const row = await db
    .prepare(
      `INSERT INTO activities (id, customer_id, kind, body, meta, created_at, created_by)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7 WHERE EXISTS (SELECT 1 FROM customers WHERE id = ?2)
       RETURNING *`,
    )
    .bind(ulid(), customerId, kind, a.body, a.meta ? JSON.stringify(a.meta) : null, now(), by)
    .first<ActivityRow>();
  if (!row) throw new ApiError(404, 'not_found', 'No customer with that ID.');
  return toActivity(row);
}

async function ownActivity(db: D1Database, customerId: string, activityId: string) {
  const row = await db
    .prepare('SELECT * FROM activities WHERE id = ? AND customer_id = ?')
    .bind(activityId, customerId)
    .first<ActivityRow>();
  if (!row) throw new ApiError(404, 'not_found', 'That note is gone.');
  if (!(OWN_KINDS as readonly string[]).includes(row.kind) || row.created_by === 'system') {
    throw new ApiError(403, 'not_yours', 'Only notes, calls and texts you added can be changed.');
  }
  return row;
}

/** `{ body, direction? }`. The kind stays what it was. */
export async function editActivity(db: D1Database, customerId: string, activityId: string, body: Record<string, unknown>) {
  const row = await ownActivity(db, customerId, activityId);
  const merged = { body: 'body' in body ? body.body : row.body, direction: body.direction ?? parse<Record<string, unknown>>(row.meta, {}).direction };
  const a = readOwnActivity(merged, row.kind);
  const meta = { ...(a.meta ?? {}), editedAt: now() };
  const saved = await db
    .prepare('UPDATE activities SET body = ?, meta = ? WHERE id = ? RETURNING *')
    .bind(a.body, JSON.stringify(meta), activityId)
    .first<ActivityRow>();
  return toActivity(saved!);
}

export async function deleteActivity(db: D1Database, customerId: string, activityId: string) {
  await ownActivity(db, customerId, activityId);
  await db.prepare('DELETE FROM activities WHERE id = ?').bind(activityId).run();
}

/* ------------------------------------------------------------ duplicates */

interface DupRow {
  reason: 'phone' | 'email' | 'name';
  k: string;
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  created_at: string;
  visits: number;
}

export async function findDuplicates(db: D1Database) {
  const { results } = await db
    .prepare(
      `WITH d AS (
         SELECT 'phone' AS reason, phone_key AS k FROM customers WHERE phone_key IS NOT NULL GROUP BY phone_key HAVING COUNT(*) > 1
         UNION ALL
         SELECT 'email', email FROM customers WHERE email IS NOT NULL AND email != '' GROUP BY email HAVING COUNT(*) > 1
         UNION ALL
         SELECT 'name', lower(trim(name)) FROM customers GROUP BY lower(trim(name)) HAVING COUNT(*) > 1
       )
       SELECT d.reason, d.k, c.id, c.name, c.phone, c.email, c.address, c.created_at,
              (SELECT COUNT(*) FROM jobs j WHERE j.customer_id = c.id AND j.status = 'done') AS visits
       FROM d JOIN customers c ON (d.reason = 'phone' AND c.phone_key = d.k)
                               OR (d.reason = 'email' AND c.email = d.k)
                               OR (d.reason = 'name' AND lower(trim(c.name)) = d.k)
       ORDER BY d.reason, d.k, c.created_at, c.id LIMIT 600`,
    )
    .all<DupRow>();

  // One group per set of people, with every reason they match on.
  const groups = new Map<string, { reasons: string[]; customers: DupRow[] }>();
  let current: DupRow[] = [];
  const flush = () => {
    if (current.length < 2) return;
    const key = current.map((r) => r.id).sort().join(',');
    const g = groups.get(key) ?? { reasons: [], customers: current };
    if (!g.reasons.includes(current[0]!.reason)) g.reasons.push(current[0]!.reason);
    groups.set(key, g);
  };
  let lastKey = '';
  for (const r of results) {
    const k = `${r.reason}:${r.k}`;
    if (k !== lastKey) flush(), (current = []), (lastKey = k);
    current.push(r);
  }
  flush();
  return [...groups.values()].map((g) => ({
    reasons: g.reasons,
    customers: g.customers.map((r) => ({ id: r.id, name: r.name, phone: r.phone, email: r.email, address: r.address, createdAt: r.created_at, visits: Number(r.visits) })),
  }));
}

/* ------------------------------------------------------------ merge */

/**
 * Two records for one person (a Housecall Pro import plus a new booking, say)
 * become one. The older record stays. Its jobs, invoices, quote requests,
 * timeline, follow-ups and campaign history gain everything from the other;
 * its blank details are filled from the other; tags are combined; an
 * unsubscribe on either one stands. People the other one referred now point
 * at the one that stays. It all happens in one batch, so it either fully
 * happens or not at all.
 */
export async function mergeCustomers(db: D1Database, aId: string, bId: string, by: string) {
  if (aId === bId) throw new ApiError(422, 'invalid', "That's the same customer.");
  const { results } = await db.prepare('SELECT * FROM customers WHERE id IN (?, ?)').bind(aId, bId).all<CustomerRow & { unsubscribe_token: string | null; phone_key: string | null }>();
  if (results.length !== 2) throw new ApiError(404, 'not_found', 'No customer with that ID.');
  results.sort((x, y) => x.created_at.localeCompare(y.created_at) || x.id.localeCompare(y.id));
  const [keep, drop] = results as [(typeof results)[0], (typeof results)[0]];

  const tags = [...new Set([...parse<string[]>(keep.tags, []), ...parse<string[]>(drop.tags, [])])].slice(0, MAX_TAGS);
  const notes = [keep.notes, drop.notes].filter(Boolean).join('\n\n').slice(0, 5000) || null;
  const phoneFromDrop = !keep.phone && !!drop.phone;
  const sourceFromDrop = !keep.source && !!drop.source;
  // Who sent them: theirs, else the other record's, unless that points back at either of them.
  let referredBy = keep.referred_by && keep.referred_by !== drop.id ? keep.referred_by : null;
  if (!referredBy && drop.referred_by && drop.referred_by !== keep.id) {
    const loop = await db
      .prepare(
        `WITH RECURSIVE up(id, depth) AS (
           SELECT ?1, 0 UNION SELECT c.referred_by, up.depth + 1 FROM customers c JOIN up ON c.id = up.id
           WHERE c.referred_by IS NOT NULL AND up.depth < 50
         ) SELECT EXISTS (SELECT 1 FROM up WHERE id IN (?2, ?3)) AS loop`,
      )
      .bind(drop.referred_by, keep.id, drop.id)
      .first<{ loop: number }>();
    if (!loop?.loop) referredBy = drop.referred_by;
  }

  const at = now();
  const moved = (table: string) => db.prepare(`UPDATE ${table} SET customer_id = ?1 WHERE customer_id = ?2`).bind(keep.id, drop.id);
  const summary = [drop.name, drop.phone, drop.email].filter(Boolean).join(', ');
  try {
    const out = await db.batch([
      // Free the other record's unique codes so the one that stays can take them.
      db.prepare('UPDATE customers SET referral_code = NULL, unsubscribe_token = NULL WHERE id = ?').bind(drop.id),
      db
        .prepare(
          `UPDATE customers SET phone = ?, phone_key = ?, email = ?, address = ?, notes = ?, source = ?, source_detail = ?,
             attribution = ?, tags = ?, referred_by = ?, referral_code = ?, unsubscribe_token = ?,
             email_ok = ?, text_ok = ?, updated_at = ? WHERE id = ?`,
        )
        .bind(
          phoneFromDrop ? drop.phone : keep.phone,
          phoneFromDrop ? drop.phone_key : keep.phone_key,
          keep.email || drop.email,
          keep.address || drop.address,
          notes,
          sourceFromDrop ? drop.source : keep.source,
          sourceFromDrop ? drop.source_detail : keep.source_detail ?? drop.source_detail,
          keep.attribution ?? drop.attribution,
          JSON.stringify(tags),
          referredBy,
          keep.referral_code ?? drop.referral_code,
          keep.unsubscribe_token ?? drop.unsubscribe_token,
          keep.email_ok && drop.email_ok ? 1 : 0,
          keep.text_ok && drop.text_ok ? 1 : 0,
          at,
          keep.id,
        ),
      moved('jobs'),
      moved('invoices'),
      moved('leads'),
      moved('activities'),
      moved('follow_ups'),
      db.prepare('UPDATE OR IGNORE campaign_sends SET customer_id = ?1 WHERE customer_id = ?2').bind(keep.id, drop.id),
      db.prepare('DELETE FROM campaign_sends WHERE customer_id = ?').bind(drop.id),
      db.prepare('UPDATE customers SET referred_by = ?1 WHERE referred_by = ?2 AND id != ?1').bind(keep.id, drop.id),
      db
        .prepare(
          `INSERT INTO activities (id, customer_id, kind, body, meta, created_at, created_by)
           VALUES (?, ?, 'system', ?, ?, ?, ?)`,
        )
        .bind(ulid(), keep.id, `Merged in a second record for the same person: ${summary}.`, JSON.stringify({ merged: drop.id, name: drop.name, phone: drop.phone, email: drop.email, address: drop.address }), at, by),
      db.prepare('DELETE FROM customers WHERE id = ? RETURNING id').bind(drop.id),
    ]);
    if (!out.at(-1)!.results.length) throw new ApiError(409, 'changed', 'That customer changed while merging. Try again.');
  } catch (err) {
    if (err instanceof ApiError) throw err;
    // Something else still points at the other record (a table this merge doesn't know yet).
    if (/FOREIGN KEY/i.test(String(err))) throw new ApiError(409, 'in_use', "Couldn't merge: the other record is still used somewhere. Nothing was changed.");
    throw err;
  }
  return { kept: keep.id, removed: drop.id, customer: await getCustomer(db, keep.id) };
}
