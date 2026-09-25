import { currentRules } from './booking.ts';
import { getBrand } from './brand.ts';
import { sendEmail } from './crm-email.ts';
import type { EmailAction } from './email-html.ts';
import { getJob } from './jobs.ts';
import { manageUrl } from './manage.ts';
import { ApiError, list, now, text, ulid, type Bindings } from './lib.ts';

/**
 * Telling Jacob (and customers) what happened.
 *
 * Jacob: a push to every phone he's signed in on (Expo, free, works today),
 * plus an email to ALERT_EMAIL once the EMAIL binding exists. Cloudflare sends
 * to a verified address of his own for free, so that part costs nothing
 * either; it just needs kedservice.com on Cloudflare first.
 *
 * Customers: booking confirmations and invoice links by email. Sending to
 * addresses that aren't verified in the account needs Cloudflare's Workers
 * Paid plan ($5/month), so it stays off until CUSTOMER_EMAIL is "on".
 *
 * All of it is best effort: called through waitUntil, it never fails the
 * booking or save that triggered it. Every alert is stored first, so a failed
 * push still shows in the app.
 */

const PUSH_URL = 'https://exp.host/--/api/v2/push/send';
// TENANT: the sender name on Jacob's own alerts. Customer email takes the
// business's details from brand.ts.
const BUSINESS = "Knock Em' Down Detailing";

interface Alert {
  type: 'booking' | 'lead' | 'invoice_opened' | 'rescheduled' | 'cancelled' | 'extra_approved' | 'extra_declined';
  refId: string;
  title: string;
  body: string;
}

interface Mail {
  to: string;
  subject: string;
  text: string;
  /** Customer email only: the button, when it isn't the first customer link in the text. */
  action?: EmailAction;
}

/* ------------------------------------------------------------ devices */

/** `{ token }` from expo-notifications' getExpoPushTokenAsync. Re-registering just refreshes it. */
export async function registerDevice(db: D1Database, body: Record<string, unknown>, subject: string) {
  const token = text(body.token, 'token', 200);
  if (!token || !/^Expo(nent)?PushToken\[[^\]]+\]$/.test(token)) {
    throw new ApiError(422, 'invalid', 'token must be an Expo push token.');
  }
  const at = now();
  await db
    .prepare(
      `INSERT INTO devices (token, subject, created_at, seen_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (token) DO UPDATE SET subject = excluded.subject, seen_at = excluded.seen_at`,
    )
    .bind(token, subject, at, at)
    .run();
  return { token };
}

/** On sign-out, so a phone he's given away stops getting alerts. */
export async function removeDevice(db: D1Database, token: string) {
  await db.prepare('DELETE FROM devices WHERE token = ?').bind(token).run();
}

export async function listAlerts(db: D1Database) {
  const { results } = await db
    .prepare('SELECT * FROM alerts ORDER BY created_at DESC LIMIT 50')
    .all<{ id: string; type: string; ref_id: string | null; title: string; body: string; pushed: number; emailed: number; created_at: string }>();
  return results.map((a) => ({
    id: a.id, type: a.type, refId: a.ref_id, title: a.title, body: a.body,
    pushed: a.pushed, emailed: a.emailed === 1, createdAt: a.created_at,
  }));
}

/* ----------------------------------------------------------- delivery */

async function push(env: Bindings, alert: Alert): Promise<number> {
  const { results } = await env.DB.prepare('SELECT token FROM devices').all<{ token: string }>();
  if (!results.length) return 0;
  const res = await fetch(env.EXPO_PUSH_URL || PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(
      results.map((d) => ({
        to: d.token,
        title: alert.title,
        body: alert.body,
        sound: 'default',
        // The app routes a tap to the job, lead or invoice.
        data: { type: alert.type, id: alert.refId },
      })),
    ),
  });
  if (!res.ok) throw new Error(`Expo push: HTTP ${res.status}`);
  const { data } = (await res.json()) as { data: { status: string; details?: { error?: string } }[] };
  // Uninstalled or signed-out phones: stop sending to them.
  const gone = results.filter((_, i) => data[i]?.details?.error === 'DeviceNotRegistered');
  if (gone.length) await env.DB.batch(gone.map((d) => env.DB.prepare('DELETE FROM devices WHERE token = ?').bind(d.token)));
  return data.filter((d) => d.status === 'ok').length;
}

async function mail(env: Bindings, m: Mail): Promise<boolean> {
  if (!env.EMAIL || !env.MAIL_FROM) return false;
  await env.EMAIL.send({ to: m.to, from: { name: BUSINESS, email: env.MAIL_FROM }, subject: m.subject, text: m.text });
  return true;
}

/** Store it, then push and email. Failures are logged and recorded, never thrown. */
async function alert(env: Bindings, a: Alert, email?: Mail) {
  const id = ulid();
  await env.DB
    .prepare('INSERT INTO alerts (id, type, ref_id, title, body, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, a.type, a.refId, a.title, a.body, now())
    .run();
  const [pushed, emailed] = await Promise.all([
    push(env, a).catch((err) => (console.error('push failed', err), 0)),
    env.ALERT_EMAIL && email
      ? Promise.all(
          list(env.ALERT_EMAIL).map((to) => mail(env, { ...email, to }).catch((err) => (console.error(`alert email to ${to} failed`, err), false))),
        ).then((sent) => sent.some(Boolean))
      : false,
  ]);
  await env.DB.prepare('UPDATE alerts SET pushed = ?, emailed = ? WHERE id = ?').bind(pushed, emailed ? 1 : 0, id).run();
}

/** Customer email: through Resend when it's set up (free), else Cloudflare if switched on. Returns whether it went. */
export async function mailCustomer(env: Bindings, m: Mail): Promise<boolean> {
  if (env.RESEND_API_KEY) return sendEmail(env, { to: m.to, subject: m.subject, text: m.text, action: m.action });
  if (env.CUSTOMER_EMAIL !== 'on') return false;
  return mail(env, m).catch((err) => (console.error('customer email failed', err), false));
}

/* -------------------------------------------------------------- words */

const dollars = (c: number) => `$${Math.round(c / 100).toLocaleString('en-US')}`;

async function when(env: Bindings, iso: string) {
  const { rules } = await currentRules(env.DB);
  return new Date(iso).toLocaleString('en-US', {
    timeZone: rules.timezone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

type QuoteSummary = { lines: { label: string }[]; range: [number, number] | null };
const what = (q: QuoteSummary) => q.lines[0]?.label ?? 'A detail';
const price = (q: QuoteSummary) =>
  q.range ? (q.range[0] === q.range[1] ? dollars(q.range[0]) : `${dollars(q.range[0])}–${dollars(q.range[1])}`) : 'price to confirm';

/* ------------------------------------------------------------- events */

/** A customer booked on the website: tell Jacob, and confirm to them. */
export async function bookingMade(env: Bindings, jobId: string) {
  const job = await getJob(env.DB, jobId);
  const at = await when(env, job.start);
  const service = what(job.quote);
  const lines = [
    `${job.customer.name} booked ${service}`,
    `When: ${at}`,
    `Where: ${job.address}`,
    job.vehicle && `Vehicle: ${job.vehicle}`,
    `Phone: ${job.customer.phone ?? 'none given'}`,
    `Estimate: ${price(job.quote)}`,
    job.notes && `Notes: ${job.notes}`,
  ].filter(Boolean);
  await alert(
    env,
    { type: 'booking', refId: job.id, title: `New booking: ${job.customer.name}`, body: `${service}, ${at}. Text them to confirm.` },
    { to: '', subject: `New booking: ${job.customer.name}, ${at}`, text: lines.join('\n') },
  );
  if (job.customer.email) {
    const brand = await getBrand(env);
    await mailCustomer(env, {
      to: job.customer.email,
      subject: `You're booked with ${brand.name}`,
      text: [
        `Hi ${job.customer.name.split(' ')[0]},`,
        '',
        `You're booked for ${service} on ${at}, at ${job.address}.`,
        `Estimate: ${price(job.quote)}. ${brand.owner} confirms the final price when he sees the vehicle.`,
        '',
        `To see, move or cancel it: ${manageUrl(env, job.manageToken)}`,
        '',
        `Anything else, call or text ${brand.phone}.`,
        '',
        brand.name,
      ].join('\n'),
    });
  }
}

/** A quote request from the website (couldn't be booked online, or they chose not to). */
export async function leadMade(env: Bindings, leadId: string) {
  const lead = await env.DB
    .prepare('SELECT name, phone, email, vehicle, zip, notes, quote FROM leads WHERE id = ?')
    .bind(leadId)
    .first<{ name: string; phone: string | null; email: string | null; vehicle: string | null; zip: string | null; notes: string | null; quote: string }>();
  if (!lead) return;
  const quote = JSON.parse(lead.quote) as QuoteSummary;
  const service = what(quote);
  await alert(
    env,
    { type: 'lead', refId: leadId, title: `Quote request: ${lead.name}`, body: `${service}, ${price(quote)}. Reach out today.` },
    {
      to: '',
      subject: `Quote request: ${lead.name}`,
      text: [
        `${lead.name} asked about ${service}`,
        `Estimate: ${price(quote)}`,
        lead.vehicle && `Vehicle: ${lead.vehicle}`,
        lead.zip && `ZIP: ${lead.zip}`,
        `Phone: ${lead.phone ?? 'none given'}`,
        lead.email && `Email: ${lead.email}`,
        lead.notes && `Notes: ${lead.notes}`,
      ].filter(Boolean).join('\n'),
    },
  );
}

/** The customer opened their invoice link for the first time. Push only; not worth an email. */
export async function invoiceOpened(env: Bindings, invoice: { id: string; number: number; customerName: string; balance: number }) {
  await alert(env, {
    type: 'invoice_opened',
    refId: invoice.id,
    title: `${invoice.customerName} opened invoice ${invoice.number}`,
    body: `${dollars(invoice.balance)} still due.`,
  });
}

/** The customer moved their booking through their link. */
export async function bookingMoved(env: Bindings, jobId: string, from: string) {
  const job = await getJob(env.DB, jobId);
  const [was, now] = await Promise.all([when(env, from), when(env, job.start)]);
  await alert(
    env,
    { type: 'rescheduled', refId: job.id, title: `${job.customer.name} moved their booking`, body: `Now ${now} (was ${was}).` },
    { to: '', subject: `Moved: ${job.customer.name}, now ${now}`, text: `${job.customer.name} moved their booking.\nNow: ${now}\nWas: ${was}\nWhere: ${job.address}` },
  );
}

/** The customer cancelled through their link. */
export async function bookingCancelled(env: Bindings, jobId: string, reason: string | null) {
  const job = await getJob(env.DB, jobId);
  const at = await when(env, job.start);
  await alert(
    env,
    { type: 'cancelled', refId: job.id, title: `${job.customer.name} cancelled`, body: `${at}${reason ? `: "${reason}"` : ''}. That time is open again.` },
    { to: '', subject: `Cancelled: ${job.customer.name}, ${at}`, text: `${job.customer.name} cancelled ${at}.${reason ? `\nReason: ${reason}` : ''}` },
  );
}

/** The customer answered an add-on on their link. A yes is emailed too: it's money. */
export async function extraAnswered(env: Bindings, a: { jobId: string; customerName: string; label: string; amount: number; yes: boolean }) {
  const price = dollars(a.amount);
  await alert(
    env,
    a.yes
      ? { type: 'extra_approved', refId: a.jobId, title: `${a.customerName} said yes to ${a.label}`, body: `${price} added to the job.` }
      : { type: 'extra_declined', refId: a.jobId, title: `${a.customerName} said no to ${a.label}`, body: `${price}. Nothing changed on the job.` },
    a.yes ? { to: '', subject: `Yes: ${a.customerName} added ${a.label} (${price})`, text: `${a.customerName} said yes to ${a.label} for ${price}. It's on the job and its invoice.` } : undefined,
  );
}
