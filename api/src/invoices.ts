import { localDate } from '@ked/scheduling';
import { cents, createIncome, day } from './books.ts';
import { currentRules } from './booking.ts';
import { getBrand } from './brand.ts';
import { extraLines } from './extras.ts';
import { getJob } from './jobs.ts';
import { ApiError, now, randomToken, text, ulid, type Bindings } from './lib.ts';
import { mailCustomer } from './notify.ts';

/**
 * Invoices. One live invoice per job; the lines start from the job's quote.
 *
 * Paid is read from the books rather than stored: money received on the job's
 * income entries, not counting tips or anything voided. So "Mark paid", a bank
 * deposit filed to the job, and (later) Stripe all settle an invoice the same
 * way, and voiding a payment reopens it.
 */

export const INVOICE_STATUSES = ['draft', 'sent', 'paid', 'void'] as const;
type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

interface Line {
  label: string;
  amount: number;
}

interface InvoiceRow {
  id: string;
  number: number;
  job_id: string;
  customer_id: string;
  status: 'open' | 'void';
  lines: string;
  total: number;
  due_date: string | null;
  notes: string | null;
  token: string;
  sent_at: string | null;
  viewed_at: string | null;
  voided_at: string | null;
  created_at: string;
  updated_at: string;
  paid: number;
  paid_on: string | null;
  shown: InvoiceStatus;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  job_date: string;
  service: string;
  vehicle: string | null;
}

/** Money in on the job's payments, tips and voids left out. */
const PAYMENTS = `FROM entries e JOIN entry_lines l ON l.entry_id = e.id JOIN accounts a ON a.id = l.account_id
  WHERE e.job_id = i.job_id AND e.kind = 'income' AND e.voided_by IS NULL AND a.money_account = 1 AND l.amount > 0
    AND NOT EXISTS (SELECT 1 FROM entry_lines t WHERE t.entry_id = e.id AND t.account_id = 'income-tips')`;

const SELECT = `SELECT * FROM (
  SELECT *, CASE WHEN status = 'void' THEN 'void' WHEN paid >= total THEN 'paid'
                 WHEN sent_at IS NOT NULL THEN 'sent' ELSE 'draft' END AS shown
  FROM (
    SELECT i.*, (SELECT COALESCE(SUM(l.amount), 0) ${PAYMENTS}) AS paid, (SELECT MAX(e.date) ${PAYMENTS}) AS paid_on,
           c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email,
           j.local_date AS job_date, j.service, j.vehicle
    FROM invoices i JOIN customers c ON c.id = i.customer_id JOIN jobs j ON j.id = i.job_id
  )
)`;

/** The customer's link. PAY_URL is the site's /pay/ page. */
const payUrl = (env: Bindings, token: string) => `${env.PAY_URL}?i=${token}`;

function toInvoice(env: Bindings, r: InvoiceRow) {
  return {
    id: r.id,
    number: r.number,
    jobId: r.job_id,
    customer: { id: r.customer_id, name: r.customer_name, phone: r.customer_phone, email: r.customer_email },
    status: r.shown,
    lines: JSON.parse(r.lines) as Line[],
    total: r.total,
    paid: r.paid,
    balance: Math.max(0, r.total - r.paid),
    /** Date of the latest payment, once there is one. */
    paidOn: r.paid ? r.paid_on : null,
    dueDate: r.due_date,
    notes: r.notes,
    payUrl: payUrl(env, r.token),
    sentAt: r.sent_at,
    viewedAt: r.viewed_at,
    voidedAt: r.voided_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export type Invoice = ReturnType<typeof toInvoice>;

export async function getInvoice(env: Bindings, id: string) {
  const row = await env.DB.prepare(`${SELECT} WHERE id = ?`).bind(id).first<InvoiceRow>();
  if (!row) throw new ApiError(404, 'not_found', 'No invoice with that ID.');
  return toInvoice(env, row);
}

/** `status` is one of INVOICE_STATUSES, or `unpaid` for draft and sent together. */
export async function listInvoices(env: Bindings, q: { status?: string; jobId?: string; customerId?: string }) {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (q.status === 'unpaid') where.push("shown IN ('draft', 'sent')");
  else if (q.status) {
    if (!(INVOICE_STATUSES as readonly string[]).includes(q.status)) {
      throw new ApiError(422, 'invalid', `status must be one of ${INVOICE_STATUSES.join(', ')} or unpaid.`);
    }
    where.push('shown = ?');
    binds.push(q.status);
  }
  if (q.jobId) where.push('job_id = ?'), binds.push(q.jobId);
  if (q.customerId) where.push('customer_id = ?'), binds.push(q.customerId);
  const { results } = await env.DB
    .prepare(`${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY number DESC LIMIT 200`)
    .bind(...binds)
    .all<InvoiceRow>();
  return results.map((r) => toInvoice(env, r));
}

function readLines(value: unknown): { lines: Line[]; total: number } {
  if (!Array.isArray(value) || !value.length) throw new ApiError(422, 'invalid', 'An invoice needs at least one line.');
  if (value.length > 30) throw new ApiError(422, 'invalid', 'An invoice can have up to 30 lines.');
  const lines = value.map((l: unknown, i) => {
    const o = (l ?? {}) as Record<string, unknown>;
    const label = text(o.label, `Line ${i + 1}`, 120);
    if (!label) throw new ApiError(422, 'invalid', `Line ${i + 1} needs a description.`);
    // Negative is a discount; zero would only be noise on the customer's copy.
    if (!(typeof o.amount === 'number' && Number.isInteger(o.amount) && o.amount !== 0 && Math.abs(o.amount) <= 10_000_000)) {
      throw new ApiError(422, 'invalid', `Line ${i + 1} needs an amount in whole cents.`);
    }
    return { label, amount: o.amount };
  });
  const total = lines.reduce((s, l) => s + l.amount, 0);
  if (total <= 0) throw new ApiError(422, 'invalid', 'The invoice total must be above zero.');
  return { lines, total };
}

function readDueDate(value: unknown) {
  return value === null || value === undefined || value === '' ? null : day(value, 'dueDate');
}

/**
 * The quote's lines and the add-ons the customer said yes to, plus one line
 * for any difference Jacob settled on (finalPrice) so the total is what he
 * agreed with the customer. An approved add-on raises finalPrice by its own
 * amount (extras.ts), so it never shows up as an adjustment.
 */
function linesFromJob(job: Awaited<ReturnType<typeof getJob>>, extras: Line[]): Line[] {
  const quote = job.quote.lines as Line[];
  let lines: Line[] = quote.filter((l) => l.amount !== 0).map((l) => ({ label: l.label, amount: l.amount }));
  const extrasTotal = extras.reduce((s, l) => s + l.amount, 0);
  // Inspection-only work quotes at zero: the price he set is the whole service.
  if (!lines.length && job.finalPrice && quote[0]) {
    const base = job.finalPrice - extrasTotal;
    lines = base > 0 ? [{ label: quote[0].label, amount: base }] : [];
    return [...lines, ...extras];
  }
  lines.push(...extras);
  const quoted = lines.reduce((s, l) => s + l.amount, 0);
  if (job.finalPrice !== null && job.finalPrice !== quoted) {
    const diff = job.finalPrice - quoted;
    lines.push({ label: diff < 0 ? 'Discount' : 'Adjustment', amount: diff });
  }
  return lines;
}

/**
 * The job's live invoice, or a new one from its quote. `{ lines?, dueDate?,
 * notes? }` only apply when creating. Returns `created` so the route can say
 * 201 or 200.
 */
export async function invoiceForJob(env: Bindings, jobId: string, body: Record<string, unknown>) {
  const job = await getJob(env.DB, jobId);
  const open = await env.DB.prepare("SELECT id FROM invoices WHERE job_id = ? AND status = 'open'").bind(jobId).first<{ id: string }>();
  if (open) return { invoice: await getInvoice(env, open.id), created: false };
  if (job.status === 'cancelled') throw new ApiError(409, 'job_cancelled', "That job was cancelled, so there's nothing to invoice.");

  let parsed: { lines: Line[]; total: number };
  if (body.lines !== undefined) parsed = readLines(body.lines);
  else {
    const lines = linesFromJob(job, await extraLines(env.DB, jobId));
    if (!lines.length || lines.reduce((s, l) => s + l.amount, 0) <= 0) {
      throw new ApiError(422, 'no_price', 'This job has no price yet. Set its final price, or add the lines yourself.');
    }
    parsed = readLines(lines);
  }

  const id = ulid();
  const at = now();
  try {
    await env.DB.batch([
      // Numbered in the same statement, so two at once can't share a number.
      // TENANT: numbering (and number UNIQUE) is across the whole database.
      env.DB
        .prepare(
          `INSERT INTO invoices (id, number, job_id, customer_id, lines, total, due_date, notes, token, created_at, updated_at)
           SELECT ?, COALESCE(MAX(number), 1000) + 1, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM invoices`,
        )
        .bind(
          id, jobId, job.customer.id, JSON.stringify(parsed.lines), parsed.total, readDueDate(body.dueDate),
          text(body.notes, 'Notes', 1000) ?? null, randomToken(), at, at,
        ),
      settlePrice(env.DB, jobId, parsed.total, at),
    ]);
  } catch (err) {
    // Someone else made the job's invoice a moment ago: that one wins.
    const raced = await env.DB.prepare("SELECT id FROM invoices WHERE job_id = ? AND status = 'open'").bind(jobId).first<{ id: string }>();
    if (raced) return { invoice: await getInvoice(env, raced.id), created: false };
    throw err;
  }
  return { invoice: await getInvoice(env, id), created: true };
}

/** The invoice total is the price Jacob settled on, so the job agrees with it. */
const settlePrice = (db: D1Database, jobId: string, total: number, at: string) =>
  db.prepare('UPDATE jobs SET final_price = ?, updated_at = ? WHERE id = ?').bind(total, at, jobId);

/** `lines`, `dueDate`, `notes`. A void invoice can't change. */
export async function updateInvoice(env: Bindings, id: string, body: Record<string, unknown>) {
  const inv = await getInvoice(env, id);
  if (inv.status === 'void') throw new ApiError(409, 'void', "That invoice is void. Make a new one for the job instead.");
  const fields: [string, unknown][] = [];
  const at = now();
  const also: D1PreparedStatement[] = [];
  if ('lines' in body) {
    const { lines, total } = readLines(body.lines);
    fields.push(['lines', JSON.stringify(lines)], ['total', total]);
    also.push(settlePrice(env.DB, inv.jobId, total, at));
  }
  if ('dueDate' in body) fields.push(['due_date', readDueDate(body.dueDate)]);
  if ('notes' in body) fields.push(['notes', text(body.notes, 'Notes', 1000) ?? null]);
  if (!fields.length) return inv;
  await env.DB.batch([
    env.DB
      .prepare(`UPDATE invoices SET ${fields.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .bind(...fields.map(([, v]) => v), at, id),
    ...also,
  ]);
  return getInvoice(env, id);
}

const dollars = (c: number) =>
  `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/**
 * Mark it sent and hand back what to send. Until kedservice.com's email is
 * set up, the app texts `message` from Jacob's own phone (the SMS composer),
 * which also means the customer sees it come from a number they know.
 */
export async function sendInvoice(env: Bindings, id: string) {
  const inv = await getInvoice(env, id);
  if (inv.status === 'void') throw new ApiError(409, 'void', "That invoice is void, so there's nothing to send.");
  if (inv.status === 'paid') throw new ApiError(409, 'paid', "That invoice is already paid.");
  const at = now();
  await env.DB.prepare('UPDATE invoices SET sent_at = ?, updated_at = ? WHERE id = ?').bind(at, at, id).run();
  const [sent, brand] = await Promise.all([getInvoice(env, id), getBrand(env)]);
  const message =
    `Hi ${firstName(sent.customer.name)}, thanks for choosing ${brand.name}! ` +
    `Here's your invoice for ${dollars(sent.balance)}: ${sent.payUrl}`;
  // Emailed as well when customer email is switched on; the text still goes.
  const emailed = sent.customer.email
    ? await mailCustomer(env, {
        to: sent.customer.email,
        subject: `Invoice ${sent.number} from ${brand.name}`,
        text: `${message}\n\nQuestions? Call or text ${brand.phone}.`,
      })
    : false;
  return { invoice: sent, message, emailed };
}

/** Payments stay in the books; void those first so nothing is orphaned. */
export async function voidInvoice(env: Bindings, id: string) {
  const inv = await getInvoice(env, id);
  if (inv.status === 'void') throw new ApiError(409, 'void', 'That invoice is already void.');
  if (inv.paid > 0) {
    throw new ApiError(409, 'has_payments', 'A payment is recorded against this job. Void the payment in the books first.');
  }
  const at = now();
  await env.DB.prepare("UPDATE invoices SET status = 'void', voided_at = ?, updated_at = ? WHERE id = ?").bind(at, at, id).run();
  return getInvoice(env, id);
}

/**
 * Record money received. `{ date?, amount?, depositToId, method?, tip? }`.
 * `amount` defaults to what's still owed; a tip is its own entry under Tips so
 * it never counts against the balance. Stripe's webhook will call this with
 * `depositToId: 'stripe'`.
 */
export async function recordInvoicePayment(env: Bindings, id: string, body: Record<string, unknown>, by: string) {
  const inv = await getInvoice(env, id);
  if (inv.status === 'void') throw new ApiError(409, 'void', "That invoice is void, so it can't take a payment.");
  const date = body.date === undefined ? localDate(new Date(), (await currentRules(env.DB)).rules.timezone) : day(body.date);
  const amount = body.amount === undefined ? inv.balance : body.amount;
  const tip = body.tip === undefined || body.tip === 0 ? 0 : cents(body.tip, 'tip');
  if (amount === 0 && !tip) throw new ApiError(409, 'paid', 'That invoice is already paid.');
  const common = { date, jobId: inv.jobId, depositToId: body.depositToId, method: body.method };
  const entries = [];
  if (amount !== 0) entries.push(await createIncome(env.DB, { ...common, amount, memo: `Invoice ${inv.number}` }, by));
  if (tip) entries.push(await createIncome(env.DB, { ...common, amount: tip, categoryId: 'income-tips', memo: `Tip, invoice ${inv.number}` }, by));
  const after = await getInvoice(env, id);
  const receipted = inv.status !== 'paid' && after.status === 'paid' ? await sendReceipt(env, after, tip) : false;
  return { invoice: after, entries, receipted };
}

/**
 * A thank-you and receipt the moment an invoice is paid in full, however it
 * was paid. Only for invoices the customer was sent, so settling an old or
 * imported one quietly doesn't email anybody.
 */
async function sendReceipt(env: Bindings, inv: Invoice, tip: number): Promise<boolean> {
  if (!inv.customer.email || !inv.sentAt) return false;
  const brand = await getBrand(env);
  const lines = [
    `Hi ${firstName(inv.customer.name)},`,
    '',
    `Got it, thank you! Invoice ${inv.number} is paid in full: ${dollars(inv.paid)}${tip ? `, plus your ${dollars(tip)} tip` : ''}.`,
    '',
    `Your receipt is here any time: ${inv.payUrl}`,
    '',
    `Thanks for trusting ${brand.name} with your vehicle. If you know anyone who'd like theirs looking this good, I'd be grateful for the referral.`,
    '',
    brand.owner,
  ];
  return mailCustomer(env, {
    to: inv.customer.email,
    subject: `Receipt for invoice ${inv.number} from ${brand.name}`,
    text: lines.join('\n'),
    action: { label: 'View your receipt', url: inv.payUrl },
  }).catch((err) => (console.error('receipt email failed', err), false));
}

/* ------------------------------------------------------------- public */

async function byToken(env: Bindings, token: string) {
  // Tokens are 43 URL-safe characters; anything else is a guess.
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new ApiError(404, 'not_found', 'No invoice at that link.');
  const row = await env.DB.prepare(`${SELECT} WHERE token = ?`).bind(token).first<InvoiceRow>();
  if (!row) throw new ApiError(404, 'not_found', 'No invoice at that link.');
  return row;
}

/**
 * What the customer sees at their link: first name only, no address or phone,
 * in case the link is forwarded. Opening it marks it viewed for Jacob.
 */
export async function publicInvoice(env: Bindings, token: string) {
  const r = await byToken(env, token);
  // Only the first open counts, and only once even if two tabs race.
  const firstOpen =
    !r.viewed_at &&
    (await env.DB.prepare('UPDATE invoices SET viewed_at = ? WHERE id = ? AND viewed_at IS NULL').bind(now(), r.id).run()).meta
      .changes === 1;
  const opened = firstOpen && r.shown !== 'void' && r.shown !== 'paid'
    ? { id: r.id, number: r.number, customerName: r.customer_name, balance: Math.max(0, r.total - r.paid) }
    : null;
  const view = {
    number: r.number,
    status: r.shown === 'draft' ? 'sent' : r.shown, // the customer never sees "draft"
    customerName: firstName(r.customer_name),
    service: r.service,
    vehicle: r.vehicle,
    jobDate: r.job_date,
    issued: r.created_at.slice(0, 10),
    dueDate: r.due_date,
    lines: JSON.parse(r.lines) as Line[],
    total: r.total,
    paid: r.paid,
    balance: Math.max(0, r.total - r.paid),
    notes: r.notes,
    /** True once Stripe is connected; the page then shows a Pay button. */
    payOnline: false,
  };
  return { view, opened };
}

/** Where Stripe Checkout will start. Until Jacob's Stripe is connected, it's off. */
export async function startCheckout(env: Bindings, token: string) {
  await byToken(env, token);
  throw new ApiError(503, 'payments_off', "Online payment isn't set up yet. Call or text Jacob to pay.");
}
