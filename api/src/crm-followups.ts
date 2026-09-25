import { Hono } from 'hono';
import { addDays, localDate } from '@ked/scheduling';
import { defaultConfig, type PricingConfig } from '@ked/pricing';
import type { AppEnv } from './app-env.ts';
import { requireOwner, type Owner } from './auth.ts';
import { activityStatement } from './crm-activity.ts';
import { sendEmail } from './crm-email.ts';
import { STATS_CTE } from './crm-segments.ts';
import { ApiError, json, now, text, ulid, type Bindings } from './lib.ts';

/**
 * Follow-ups: the daily rules that decide who to contact (thank-you and
 * review ask, booking reminder, rebook, win-back, quote chase), Jacob's own
 * "call Bob back Tuesday" notes, the to-do list, one-tap texts and automatic
 * emails. Mounted at /v1/crm/follow-ups. See docs/crm.md.
 *
 * Texts are never sent by the system: a follow-up carries the message, and the
 * admin opens Messages with it filled in. Email goes out automatically where
 * the rule allows it, the customer has an address and hasn't unsubscribed,
 * and Resend is set up (RESEND_API_KEY). Anything else stays open for Jacob.
 *
 * The free plan allows 50 D1 queries and 50 outside requests per invocation,
 * cron included. So the rules are set-based (one SELECT each, one INSERT for
 * all of them through json_each), and emails go in one claimed batch of at
 * most SENDS_PER_RUN with one write for all the results. A run is about a
 * dozen queries whatever the size of the customer list.
 */
export const followups = new Hono<AppEnv>();
followups.use('*', requireOwner);

/* ----------------------------------------------------------- settings */

export const RULES = ['thank_you', 'reminder', 'rebook', 'winback', 'quote_chase'] as const;
export type RuleName = (typeof RULES)[number];
/** 'review' is the first thank-you, with the review ask; 'thank_you' is for people already asked. */
export const TEMPLATES = ['review', 'thank_you', 'reminder', 'rebook', 'winback', 'quote_chase'] as const;
export type TemplateName = (typeof TEMPLATES)[number];
const KINDS = ['rebook', 'review', 'winback', 'quote_chase', 'thank_you', 'reminder', 'custom'] as const;
type Kind = (typeof KINDS)[number];
const CHANNELS = ['text', 'email', 'call'] as const;
type Channel = (typeof CHANNELS)[number];

/** What a template may say. Unknown {words} are refused on save, so a typo shows up before it goes out. */
export const PLACEHOLDERS = [
  'first name', 'service', 'last visit', 'since', 'date', 'time', 'address',
  'review link', 'quote link', 'manage link', 'offer',
] as const;

export interface FollowUpSettings {
  /** Where "leave a review" goes. Blank uses the website's review link. */
  reviewUrl: string;
  /** Each rule on or off, and whether it may email (else it's a text for Jacob). */
  rules: Record<RuleName, { on: boolean; email: boolean }>;
  /** Months between visits, by package id; 'other' covers the rest (imported jobs too). */
  intervals: Record<string, number>;
  /** After this many visits, their own average gap is used instead of the package's. */
  regularAfter: number;
  /** No visit for this many months, nothing booked: win-back instead of rebook. */
  lapsedMonths: number;
  /** Optional line in the win-back message, e.g. "$20 off if you book this month." */
  winbackOffer: string;
  /** A quote request still new or contacted this many days later gets chased. */
  quoteChaseDays: number;
  /** At most this many new rebook and win-back follow-ups a day, best customers first. The rest wait. */
  newPerDay: { rebook: number; winback: number };
  /** Resend's free plan allows 100 a day; this leaves room for booking confirmations. */
  emailsPerDay: number;
  /** When a reminder is emailed, still put a text on Jacob's list. */
  reminderAlsoText: boolean;
  templates: Record<TemplateName, { subject: string; body: string }>;
}

/** The site's review page (src/data/site.ts `reviewsUrl`), until Jacob saves his Google link. */
export const FALLBACK_REVIEW_URL = 'https://reviews.birdeye.com/knock-em-down-auto-marine-detailing-167601558157721';
const PHONE = '(314) 223-2988';

export const DEFAULT_SETTINGS: FollowUpSettings = {
  reviewUrl: '',
  rules: {
    thank_you: { on: true, email: true },
    reminder: { on: true, email: true },
    rebook: { on: true, email: true },
    winback: { on: true, email: true },
    quote_chase: { on: true, email: false },
  },
  intervals: { 'level-1': 3, 'level-2': 5, 'level-3': 6, 'level-4': 12, ceramic: 12, marine: 3, other: 4 },
  regularAfter: 3,
  lapsedMonths: 6,
  winbackOffer: '',
  quoteChaseDays: 2,
  newPerDay: { rebook: 10, winback: 5 },
  emailsPerDay: 80,
  reminderAlsoText: false,
  templates: {
    review: {
      subject: 'Thanks from Knock Em\' Down',
      body:
        "Hi {first name}, thanks for having me out for the {service}. Hope you're loving how it turned out.\n\n" +
        'If you have a minute, a quick Google review helps a small local business like mine more than you know: {review link}\n\n' +
        'Thanks again,\nJacob',
    },
    thank_you: {
      subject: 'Thanks again, {first name}',
      body: 'Hi {first name}, thanks again for having me out for the {service}. Always good to see you. Text me anytime you need anything.\n\nJacob',
    },
    reminder: {
      subject: 'See you tomorrow, {first name}',
      body:
        "Hi {first name}, just a reminder I'll be at {address} tomorrow, {date} at {time}, for your {service}.\n\n" +
        `Need to move it? {manage link}\n\nSee you then,\nJacob\n${PHONE}`,
    },
    rebook: {
      subject: 'Time for your next detail?',
      body:
        "Hi {first name}, it's Jacob with Knock Em' Down. It's been {since} since your last {service}, so you're about due for the next one.\n\n" +
        'Pick a time here: {quote link}\nOr just text me back.\n\nJacob',
    },
    winback: {
      subject: 'Been a while, {first name}',
      body:
        "Hi {first name}, it's Jacob with Knock Em' Down. It's been a while since I took care of your car, and I'd love to get it looking right again.\n\n" +
        '{offer}\n\nPick a time here: {quote link}\nOr just text me back.\n\nJacob',
    },
    quote_chase: {
      subject: 'Your detailing quote',
      body:
        "Hi {first name}, it's Jacob with Knock Em' Down. I saw your quote for a {service}. Still want to get it on the calendar? " +
        'You can pick a time here: {quote link}\nOr just text me back with any questions.\n\nJacob',
    },
  },
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Stored settings over the defaults, field by field; anything missing or bad falls back. */
export function mergeSettings(raw: unknown): FollowUpSettings {
  const s = clone(DEFAULT_SETTINGS);
  if (!raw || typeof raw !== 'object') return s;
  const r = raw as Record<string, any>;
  const num = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
  if (typeof r.reviewUrl === 'string') s.reviewUrl = r.reviewUrl;
  for (const k of RULES) {
    const x = r.rules?.[k];
    if (x && typeof x.on === 'boolean') s.rules[k].on = x.on;
    if (x && typeof x.email === 'boolean') s.rules[k].email = x.email;
  }
  if (r.intervals && typeof r.intervals === 'object') {
    for (const [k, v] of Object.entries(r.intervals)) if (num(v, 0.25, 36)) s.intervals[k] = v as number;
  }
  if (num(r.regularAfter, 2, 50)) s.regularAfter = r.regularAfter;
  if (num(r.lapsedMonths, 1, 60)) s.lapsedMonths = r.lapsedMonths;
  if (typeof r.winbackOffer === 'string') s.winbackOffer = r.winbackOffer;
  if (num(r.quoteChaseDays, 1, 30)) s.quoteChaseDays = r.quoteChaseDays;
  if (num(r.newPerDay?.rebook, 0, 200)) s.newPerDay.rebook = r.newPerDay.rebook;
  if (num(r.newPerDay?.winback, 0, 200)) s.newPerDay.winback = r.newPerDay.winback;
  if (num(r.emailsPerDay, 0, 100)) s.emailsPerDay = r.emailsPerDay;
  if (typeof r.reminderAlsoText === 'boolean') s.reminderAlsoText = r.reminderAlsoText;
  for (const k of TEMPLATES) {
    const t = r.templates?.[k];
    if (t && typeof t.subject === 'string' && t.subject.trim()) s.templates[k].subject = t.subject;
    if (t && typeof t.body === 'string' && t.body.trim()) s.templates[k].body = t.body;
  }
  return s;
}

/** A full settings object from the admin. Throws 422 with every problem listed. */
export function validateSettings(body: Record<string, unknown>): FollowUpSettings {
  const errors: string[] = [];
  const b = body as Record<string, any>;
  const whole = (v: unknown, lo: number, hi: number, what: string) => {
    if (!(typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi)) errors.push(`${what} must be a number from ${lo} to ${hi}.`);
  };
  if (typeof b.reviewUrl !== 'string') errors.push('The review link must be text.');
  else if (b.reviewUrl.trim() && !/^https:\/\/\S+$/.test(b.reviewUrl.trim())) errors.push('The review link must start with https://');
  else if (b.reviewUrl.length > 500) errors.push('The review link is too long.');
  for (const k of RULES) {
    const x = b.rules?.[k];
    if (!x || typeof x.on !== 'boolean' || typeof x.email !== 'boolean') errors.push(`Say whether the ${k.replace('_', ' ')} rule is on and may email.`);
  }
  if (!b.intervals || typeof b.intervals !== 'object' || Array.isArray(b.intervals)) errors.push('Intervals must be a list of months by package.');
  else {
    const entries = Object.entries(b.intervals as Record<string, unknown>);
    if (entries.length > 40) errors.push('Too many intervals.');
    for (const [k, v] of entries) {
      if (!/^[a-z0-9-]{1,40}$/.test(k)) errors.push(`"${k}" isn't a package.`);
      whole(v, 0.25, 36, `Months for ${k}`);
    }
  }
  whole(b.regularAfter, 2, 50, 'Visits before someone counts as a regular');
  whole(b.lapsedMonths, 1, 60, 'Months before someone counts as gone quiet');
  if (typeof b.winbackOffer !== 'string' || b.winbackOffer.length > 300) errors.push('The win-back offer must be under 300 characters.');
  whole(b.quoteChaseDays, 1, 30, 'Days before chasing a quote');
  whole(b.newPerDay?.rebook, 0, 200, 'New rebook reminders a day');
  whole(b.newPerDay?.winback, 0, 200, 'New win-back notes a day');
  whole(b.emailsPerDay, 0, 100, 'Emails a day');
  if (typeof b.reminderAlsoText !== 'boolean') errors.push('Say whether reminders also go on your text list.');
  for (const k of TEMPLATES) {
    const t = b.templates?.[k];
    if (!t || typeof t.subject !== 'string' || typeof t.body !== 'string') {
      errors.push(`The ${k.replace('_', ' ')} message is missing.`);
      continue;
    }
    if (!t.subject.trim() || t.subject.length > 150) errors.push(`The ${k.replace('_', ' ')} subject must be 1 to 150 characters.`);
    if (!t.body.trim() || t.body.length > 2000) errors.push(`The ${k.replace('_', ' ')} message must be 1 to 2,000 characters.`);
    for (const m of `${t.subject}\n${t.body}`.matchAll(/\{([^{}]*)\}/g)) {
      if (!(PLACEHOLDERS as readonly string[]).includes(m[1]!.trim().toLowerCase())) {
        errors.push(`The ${k.replace('_', ' ')} message has {${m[1]}}, which isn't something it can fill in.`);
      }
    }
  }
  if (errors.length) throw new ApiError(422, 'invalid_settings', 'Some follow-up settings need fixing.', errors);
  const clean = mergeSettings(b);
  clean.reviewUrl = (b.reviewUrl as string).trim();
  clean.winbackOffer = (b.winbackOffer as string).trim();
  // Only what was sent: an interval left out is dropped, not kept from before.
  clean.intervals = { other: DEFAULT_SETTINGS.intervals.other!, ...(b.intervals as Record<string, number>) };
  return clean;
}

/** Everything the rules need from settings, in one query. */
async function loadSettings(db: D1Database) {
  const { results } = await db
    .prepare("SELECT key, value, updated_at FROM settings WHERE key IN ('crm', 'booking')")
    .all<{ key: string; value: string; updated_at: string }>();
  const row = (k: string) => results.find((r) => r.key === k);
  const parse = (v: string | undefined) => {
    try {
      return v ? JSON.parse(v) : null;
    } catch {
      return null;
    }
  };
  const booking = parse(row('booking')?.value) as { timezone?: string } | null;
  return {
    settings: mergeSettings(parse(row('crm')?.value)),
    updatedAt: row('crm')?.updated_at ?? null,
    timezone: booking?.timezone || 'America/Chicago',
  };
}

/**
 * Saves into the shared 'crm' settings row with json_patch, so other CRM
 * parts' keys in the same row are left alone.
 */
async function saveSettings(db: D1Database, s: FollowUpSettings, by: string) {
  const at = now();
  await db
    .prepare(
      `INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('crm', ?1, ?2, ?3)
       ON CONFLICT (key) DO UPDATE SET value = json_patch(json_remove(settings.value, '$.intervals'), excluded.value),
         updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    )
    .bind(JSON.stringify(s), at, by)
    .run();
  return at;
}

/* -------------------------------------------------------------- words */

/** Fills {placeholders}; a line left empty (no offer) disappears. */
export function fill(template: string, values: Partial<Record<(typeof PLACEHOLDERS)[number], string>>) {
  return template
    .replace(/\{([^{}]*)\}/g, (all, name: string) => {
      const v = values[name.trim().toLowerCase() as keyof typeof values];
      return v ?? '';
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || 'there';

const LEVEL: Record<string, string> = {
  'level-1': 'Level I', 'level-2': 'Level II', 'level-3': 'Level III', 'level-4': 'Level IV',
  ceramic: 'ceramic coating', marine: 'boat detail',
};

/** "Level I" for Jacob's list. */
const levelName = (service: string | null) => (service && LEVEL[service]) || 'detail';

/** "Tune-Up" for the customer, from Jacob's own package names. */
function serviceWords(pricing: PricingConfig, service: string | null, label?: string | null) {
  const named = pricing.services.find((s) => s.id === service)?.name ?? (label ? label.split(' — ')[0] : null);
  return (named ?? 'detail').replace(/^the\s+/i, '');
}

const plainDay = (date: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }).format(new Date(`${date}T12:00:00Z`));
/** "June 12", or "June 12, 2025" when it isn't this year. */
const shortDay = (date: string, today: string) =>
  plainDay(date, date.slice(0, 4) === today.slice(0, 4) ? { month: 'long', day: 'numeric' } : { month: 'long', day: 'numeric', year: 'numeric' });

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
function addMonths(date: string, months: number) {
  const whole = Math.floor(months);
  const d = new Date(`${date}T12:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + whole);
  d.setUTCDate(Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
  return addDays(d.toISOString().slice(0, 10), Math.round((months - whole) * 30.44));
}

/** "3 months", "about a month", "5 weeks". */
function sinceWords(days: number) {
  if (days < 25) return `${Math.max(1, Math.round(days / 7))} week${Math.round(days / 7) === 1 ? '' : 's'}`;
  const m = Math.round(days / 30.44);
  if (m <= 1) return 'about a month';
  if (m < 18) return `${m} months`;
  return 'over a year';
}

const everyWords = (days: number) => (days < 50 ? `every ${Math.round(days / 7)} weeks or so` : `every ${Math.round(days / 30.44)} months or so`);

const siteUrl = (env: Bindings) => (env.SITE_URL || 'https://www.kedservice.com').replace(/\/$/, '');
/** The API's own address, for one-click unsubscribe. The site is static, so it can't take the POST. */
const apiUrl = (env: Bindings) =>
  ((env as { API_URL?: string }).API_URL || 'https://ked-api.ked-api.workers.dev').replace(/\/$/, '');

/* -------------------------------------------------------------- rules */

interface Person {
  customerId: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  emailOk: boolean;
  textOk: boolean;
}

interface NewFollowUp {
  id: string;
  customerId: string | null;
  leadId: string | null;
  jobId: string | null;
  kind: Kind;
  dueDate: string;
  channel: Channel | null;
  title: string;
  message: string;
  subject: string | null;
  emailState: 'queued' | null;
  ruleKey: string;
}

export interface RunResult {
  today: string;
  created: Record<Kind, number>;
  emailed: number;
  emailFailed: number;
  /** Waiting because of the daily cap or the per-run limit; they go on a later run. */
  emailWaiting: number;
  emailConfigured: boolean;
}

/** At most this many emails per run: the free plan allows 50 outside requests per invocation. */
const SENDS_PER_RUN = 30;

/**
 * How to reach someone for this follow-up. Automatic email when allowed;
 * otherwise a text if they take texts, then a hand-sent email, then a call.
 */
function route(p: Person, canAutoEmail: boolean, marketing: boolean): { channel: Channel | null; auto: boolean } {
  if (canAutoEmail && p.email && (!marketing || p.emailOk)) return { channel: 'email', auto: true };
  if (p.phone && p.textOk) return { channel: 'text', auto: false };
  if (p.email && (!marketing || p.emailOk)) return { channel: 'email', auto: false };
  if (p.phone) return { channel: 'call', auto: false };
  return { channel: null, auto: false };
}

/**
 * The daily rules. Runs from the Worker's cron every morning (see `scheduled`
 * in index.ts), and from POST /crm/follow-ups/run. Safe to run any number of
 * times: every rule's follow-up has a rule_key, one per key ever, and an email
 * is claimed before it's sent.
 */
export async function runDaily(env: Bindings, at = new Date()): Promise<RunResult> {
  const db = env.DB;
  const [{ settings: s, timezone }, pricingRow] = await Promise.all([
    loadSettings(db),
    db.prepare('SELECT config FROM pricing_configs ORDER BY version DESC LIMIT 1').first<{ config: string }>(),
  ]);
  const pricing = pricingRow ? (JSON.parse(pricingRow.config) as PricingConfig) : defaultConfig;
  const today = localDate(at, timezone);
  const yesterday = addDays(today, -1);
  const tomorrow = addDays(today, 1);
  const configured = !!env.RESEND_API_KEY;
  const quoteLink = `${siteUrl(env)}/quote/`;
  const reviewLink = s.reviewUrl || FALLBACK_REVIEW_URL;
  const lapsedBefore = addMonths(today, -s.lapsedMonths);
  const chaseBefore = new Date(at.getTime() - s.quoteChaseDays * 864e5).toISOString();
  const chaseAfter = new Date(at.getTime() - (s.quoteChaseDays + 14) * 864e5).toISOString();

  // One read per rule, in one round trip. Each skips what already has a follow-up.
  const PERSON = 'c.id AS cid, c.name, c.phone, c.email, c.email_ok, c.text_ok';
  type P = { cid: string; name: string; phone: string | null; email: string | null; email_ok: number; text_ok: number };
  const [thanks, reminders, regulars, quotes] = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        `SELECT j.id, j.service, j.local_date, j.quote, ${PERSON},
                EXISTS (SELECT 1 FROM follow_ups r WHERE r.customer_id = c.id AND r.kind = 'review') AS asked
         FROM jobs j JOIN customers c ON c.id = j.customer_id
         WHERE j.status = 'done' AND j.history = 0 AND j.local_date BETWEEN ?1 AND ?2
           AND NOT EXISTS (SELECT 1 FROM follow_ups f WHERE f.rule_key = 'thanks:' || j.id)
         ORDER BY j.start_at`,
      )
      .bind(addDays(today, -3), yesterday),
    db
      .prepare(
        `SELECT j.id, j.service, j.local_date, j.start_at, j.address, j.quote, j.manage_token, ${PERSON}
         FROM jobs j JOIN customers c ON c.id = j.customer_id
         WHERE j.status = 'scheduled' AND j.local_date = ?1
           AND NOT EXISTS (SELECT 1 FROM follow_ups f WHERE f.rule_key = 'reminder:' || j.id || ':' || j.local_date)
         ORDER BY j.start_at`,
      )
      .bind(tomorrow),
    // Rebook and win-back: customers with done visits and nothing booked,
    // who don't already have one open or one for this same last visit.
    db
      .prepare(
        `WITH ${STATS_CTE}
         SELECT ${PERSON}, s.visits, s.spend, s.first_visit, s.last_visit, s.last_service,
                (SELECT l.quote FROM jobs l WHERE l.customer_id = c.id AND l.status = 'done' ORDER BY l.start_at DESC LIMIT 1) AS last_quote
         FROM customers c JOIN stats s ON s.customer_id = c.id
         WHERE s.visits >= 1 AND s.next_visit IS NULL AND s.last_visit < ?2
           AND NOT EXISTS (SELECT 1 FROM follow_ups f WHERE f.customer_id = c.id AND f.kind IN ('rebook', 'winback')
                           AND (f.status = 'open' OR f.rule_key IN ('rebook:' || c.id || ':' || s.last_visit, 'winback:' || c.id || ':' || s.last_visit)))
         ORDER BY s.spend DESC, s.visits DESC`,
      )
      .bind(at.toISOString(), today),
    db
      .prepare(
        `SELECT l.id, l.name AS lead_name, l.phone AS lead_phone, l.email AS lead_email, l.quote, l.created_at,
                c.id AS cid, c.name, c.phone, c.email, COALESCE(c.email_ok, 1) AS email_ok, COALESCE(c.text_ok, 1) AS text_ok
         FROM leads l LEFT JOIN customers c ON c.id = l.customer_id
         WHERE l.status IN ('new', 'contacted') AND l.created_at <= ?1 AND l.created_at >= ?2
           AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.customer_id = l.customer_id AND j.created_at >= l.created_at AND j.status != 'cancelled')
           AND NOT EXISTS (SELECT 1 FROM follow_ups f WHERE f.rule_key = 'quote:' || l.id)
         ORDER BY l.created_at`,
      )
      .bind(chaseBefore, chaseAfter),
  ]);

  const person = (r: P): Person => ({
    customerId: r.cid, name: r.name, phone: r.phone, email: r.email, emailOk: r.email_ok !== 0, textOk: r.text_ok !== 0,
  });
  const label = (quote: unknown) => {
    try {
      return (JSON.parse(String(quote)) as { lines?: { label: string }[] }).lines?.[0]?.label ?? null;
    } catch {
      return null;
    }
  };

  const out: NewFollowUp[] = [];
  const add = (
    p: Person,
    f: { kind: Kind; ruleKey: string; title: string; template: TemplateName; values: Record<string, string>; rule: RuleName; marketing: boolean; jobId?: string | null; leadId?: string | null },
  ) => {
    const r = route(p, configured && s.rules[f.rule].email, f.marketing);
    if (!r.channel) return false;
    const t = s.templates[f.template];
    const values = { 'first name': firstName(p.name), 'quote link': quoteLink, 'review link': reviewLink, offer: s.winbackOffer, ...f.values };
    out.push({
      id: ulid(),
      customerId: p.customerId,
      leadId: f.leadId ?? null,
      jobId: f.jobId ?? null,
      kind: f.kind,
      dueDate: today,
      channel: r.channel,
      title: f.title,
      message: fill(t.body, values),
      subject: fill(t.subject, values),
      emailState: r.auto ? 'queued' : null,
      ruleKey: f.ruleKey,
    });
    return true;
  };

  if (s.rules.thank_you.on) {
    const seen = new Set<string>();
    for (const row of thanks!.results as (P & { id: string; service: string; local_date: string; quote: string; asked: number })[]) {
      if (seen.has(row.cid)) continue; // two jobs in a row: one thank-you
      seen.add(row.cid);
      const first = !row.asked;
      add(person(row), {
        kind: first ? 'review' : 'thank_you',
        ruleKey: `thanks:${row.id}`,
        title: first
          ? `Finished a ${levelName(row.service)} on ${shortDay(row.local_date, today)}: thank them and ask for a review`
          : `Finished a ${levelName(row.service)} on ${shortDay(row.local_date, today)}: say thanks`,
        template: first ? 'review' : 'thank_you',
        values: { service: serviceWords(pricing, row.service, label(row.quote)) },
        rule: 'thank_you',
        marketing: true,
        jobId: row.id,
      });
    }
  }

  if (s.rules.reminder.on) {
    for (const row of reminders!.results as (P & { id: string; service: string; local_date: string; start_at: string; address: string; quote: string; manage_token: string })[]) {
      const p = person(row);
      const clock = new Date(row.start_at).toLocaleString('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' }).replace(':00', '');
      const values = {
        service: serviceWords(pricing, row.service, label(row.quote)),
        date: plainDay(row.local_date, { weekday: 'long', month: 'long', day: 'numeric' }),
        time: clock,
        address: row.address,
        'manage link': `${env.MANAGE_URL}?b=${row.manage_token}`,
      };
      const title = `Booked tomorrow at ${clock}: ${levelName(row.service)}`;
      const made = add(p, { kind: 'reminder', ruleKey: `reminder:${row.id}:${row.local_date}`, title, template: 'reminder', values, rule: 'reminder', marketing: false, jobId: row.id });
      const emailed = made && out[out.length - 1]!.emailState === 'queued';
      if (emailed && s.reminderAlsoText && p.phone && p.textOk) {
        const t = s.templates.reminder;
        const v = { 'first name': firstName(p.name), ...values };
        out.push({
          id: ulid(), customerId: p.customerId, leadId: null, jobId: row.id, kind: 'reminder', dueDate: today, channel: 'text',
          title: `${title} (they got the email too)`, message: fill(t.body, v), subject: null, emailState: null,
          ruleKey: `reminder-text:${row.id}:${row.local_date}`,
        });
      }
    }
  }

  let rebooks = 0;
  let winbacks = 0;
  for (const row of regulars!.results as (P & { visits: number; spend: number; first_visit: string; last_visit: string; last_service: string | null; last_quote: string | null })[]) {
    const p = person(row);
    const since = daysBetween(row.last_visit, today);
    const service = serviceWords(pricing, row.last_service, label(row.last_quote));
    if (row.last_visit < lapsedBefore) {
      if (!s.rules.winback.on || winbacks >= s.newPerDay.winback) continue;
      const made = add(p, {
        kind: 'winback', ruleKey: `winback:${row.cid}:${row.last_visit}`,
        title: `Hasn't booked in ${sinceWords(since)}: last one ${shortDay(row.last_visit, today)}`,
        template: 'winback', values: { service, 'last visit': shortDay(row.last_visit, today), since: sinceWords(since) }, rule: 'winback', marketing: true,
      });
      if (made) winbacks++;
      continue;
    }
    if (!s.rules.rebook.on || rebooks >= s.newPerDay.rebook) continue;
    // A regular's own rhythm beats the package's; clamped so one odd gap can't run away.
    const own = row.visits >= s.regularAfter ? Math.min(365, Math.max(14, daysBetween(row.first_visit, row.last_visit) / (row.visits - 1))) : null;
    const months = s.intervals[row.last_service ?? ''] ?? s.intervals.other ?? 4;
    const due = own !== null ? addDays(row.last_visit, Math.round(own)) : addMonths(row.last_visit, months);
    if (due > today) continue;
    const made = add(p, {
      kind: 'rebook', ruleKey: `rebook:${row.cid}:${row.last_visit}`,
      title: `Due for a ${levelName(row.last_service)}: last one ${shortDay(row.last_visit, today)}${own !== null ? `, usually ${everyWords(own)}` : ''}`,
      template: 'rebook', values: { service, 'last visit': shortDay(row.last_visit, today), since: sinceWords(since) }, rule: 'rebook', marketing: true,
    });
    if (made) rebooks++;
  }

  if (s.rules.quote_chase.on) {
    for (const row of quotes!.results as (P & { id: string; lead_name: string; lead_phone: string | null; lead_email: string | null; quote: string; created_at: string })[]) {
      const p: Person = {
        customerId: row.cid ?? null, name: row.lead_name, phone: row.lead_phone ?? row.phone, email: row.lead_email ?? row.email,
        emailOk: row.email_ok !== 0, textOk: row.text_ok !== 0,
      };
      const service = (label(row.quote) ?? 'detail').split(' — ')[0]!.replace(/^the\s+/i, '');
      add(p, {
        kind: 'quote_chase', ruleKey: `quote:${row.id}`,
        title: `Asked for a quote ${shortDay(localDate(row.created_at, timezone), today)} and hasn't booked`,
        template: 'quote_chase', values: { service }, rule: 'quote_chase', marketing: true, leadId: row.id,
      });
    }
  }

  const created = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<Kind, number>;
  if (out.length) {
    const stamp = now();
    const { results } = await db
      .prepare(
        `INSERT OR IGNORE INTO follow_ups (id, customer_id, lead_id, job_id, kind, due_date, status, channel, title, message,
                                           subject, email_state, rule_key, created_at, updated_at)
         SELECT json_extract(x.value, '$.id'), json_extract(x.value, '$.customerId'), json_extract(x.value, '$.leadId'),
                json_extract(x.value, '$.jobId'), json_extract(x.value, '$.kind'), json_extract(x.value, '$.dueDate'), 'open',
                json_extract(x.value, '$.channel'), json_extract(x.value, '$.title'), json_extract(x.value, '$.message'),
                json_extract(x.value, '$.subject'), json_extract(x.value, '$.emailState'), json_extract(x.value, '$.ruleKey'), ?2, ?2
         FROM json_each(?1) x
         RETURNING kind`,
      )
      .bind(JSON.stringify(out), stamp)
      .all<{ kind: Kind }>();
    for (const r of results) created[r.kind]++;
  }

  const mail = await sendQueued(env, s, today, at);
  return { today, created, ...mail, emailConfigured: configured };
}

/* -------------------------------------------------------------- email */

/**
 * Sends queued follow-up emails: claim a batch (so a second run can't take the
 * same ones), send, then record every result in one statement each for the
 * follow-ups and the timeline. Marketing ones get the same unsubscribe footer
 * and headers as sendMarketingEmail; reminders are service email and don't.
 */
async function sendQueued(env: Bindings, s: FollowUpSettings, today: string, at: Date) {
  const db = env.DB;
  const none = { emailed: 0, emailFailed: 0, emailWaiting: 0 };
  if (!env.RESEND_API_KEY) return none;
  const dayAgo = new Date(at.getTime() - 864e5).toISOString();
  const [sentRow, waitingRow] = await db.batch<{ n: number }>([
    db.prepare("SELECT COUNT(*) AS n FROM activities WHERE kind = 'email' AND created_by = 'system' AND created_at >= ?").bind(dayAgo),
    db.prepare("SELECT COUNT(*) AS n FROM follow_ups WHERE email_state = 'queued' AND status = 'open' AND due_date <= ?").bind(today),
  ]);
  const waiting = waitingRow!.results[0]?.n ?? 0;
  const room = Math.max(0, Math.min(SENDS_PER_RUN, s.emailsPerDay - (sentRow!.results[0]?.n ?? 0)));
  if (!waiting || !room) return { ...none, emailWaiting: waiting };

  const stamp = now();
  const { results: claimed } = await db
    .prepare(
      `UPDATE follow_ups SET email_state = 'sending', updated_at = ?1
       WHERE id IN (SELECT id FROM follow_ups WHERE email_state = 'queued' AND status = 'open' AND due_date <= ?2
                    ORDER BY due_date, id LIMIT ?3)
         AND email_state = 'queued'
       RETURNING id`,
    )
    .bind(stamp, today, room)
    .all<{ id: string }>();
  if (!claimed.length) return { ...none, emailWaiting: waiting };

  const ids = JSON.stringify(claimed.map((r) => r.id));
  // Who they go to, with an unsubscribe token made for anyone without one.
  const [, rows] = await db.batch<{
    id: string; kind: Kind; subject: string | null; message: string | null; customer_id: string | null; lead_id: string | null;
    job_id: string | null; email: string | null; email_ok: number; unsubscribe_token: string | null;
  }>([
    db
      .prepare(
        `UPDATE customers SET unsubscribe_token = lower(hex(randomblob(24)))
         WHERE unsubscribe_token IS NULL
           AND id IN (SELECT f.customer_id FROM follow_ups f WHERE f.id IN (SELECT value FROM json_each(?1)))`,
      )
      .bind(ids),
    db
      .prepare(
        `SELECT f.id, f.kind, f.subject, f.message, f.customer_id, f.lead_id, f.job_id,
                COALESCE(c.email, l.email) AS email, COALESCE(c.email_ok, 1) AS email_ok, c.unsubscribe_token
         FROM follow_ups f LEFT JOIN customers c ON c.id = f.customer_id LEFT JOIN leads l ON l.id = f.lead_id
         WHERE f.id IN (SELECT value FROM json_each(?1))`,
      )
      .bind(ids),
  ]);

  const site = siteUrl(env);
  const api = apiUrl(env);
  const results = await Promise.all(
    rows!.results.map(async (r) => {
      const marketing = r.kind !== 'reminder';
      if (!r.email) return { r, ok: false, note: 'No email address.' };
      if (marketing && !r.email_ok) return { r, ok: false, note: 'They unsubscribed from emails.' };
      if (marketing && !r.unsubscribe_token) return { r, ok: false, note: 'No unsubscribe link, so it was held back.' };
      const subject = r.subject || "Knock Em' Down Detailing";
      const body = r.message ?? '';
      let textBody = body;
      let headers: Record<string, string> | undefined;
      if (marketing) {
        const token = encodeURIComponent(r.unsubscribe_token!);
        const page = `${site}/unsubscribe/?t=${token}`;
        textBody = `${body.trimEnd()}\n\n--\nKnock Em' Down Auto & Marine Detailing, St. Louis\nDon't want these emails? ${page}`;
        headers = {
          'List-Unsubscribe': `<${api}/v1/crm/public/unsubscribe/${token}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        };
      }
      const ok = await sendEmail(env, { to: r.email, subject, text: textBody, headers });
      return { r, ok, note: ok ? null : 'The email service refused it.' };
    }),
  );

  const done = now();
  const outcome = results.map(({ r, ok, note }) => ({ id: r.id, ok: ok ? 1 : 0, note }));
  const timeline = results
    .filter((x) => x.ok)
    .flatMap(({ r }) => {
      const base = { id: ulid(), customerId: r.customer_id, leadId: r.lead_id, jobId: r.job_id };
      const rows = [{ ...base, kind: 'email', body: `${r.subject ?? ''}\n\n${r.message ?? ''}`, meta: JSON.stringify({ followUpId: r.id, rule: r.kind }) }];
      if (r.kind === 'review') {
        rows.push({ ...base, id: ulid(), kind: 'review_request', body: 'Asked for a Google review by email.', meta: JSON.stringify({ followUpId: r.id }) });
      }
      return rows;
    });
  // Two statements for the whole batch: settle the follow-ups, then add every
  // email to its customer's timeline (the same row sendMarketingEmail writes).
  await db.batch([
    db
      .prepare(
        `UPDATE follow_ups SET
           email_state = CASE WHEN json_extract(o.value, '$.ok') = 1 THEN 'sent' ELSE 'failed' END,
           status = CASE WHEN json_extract(o.value, '$.ok') = 1 THEN 'sent' ELSE status END,
           channel = CASE WHEN json_extract(o.value, '$.ok') = 1 THEN 'email' ELSE 'text' END,
           email_note = json_extract(o.value, '$.note'),
           sent_at = CASE WHEN json_extract(o.value, '$.ok') = 1 THEN ?2 ELSE NULL END,
           done_at = CASE WHEN json_extract(o.value, '$.ok') = 1 THEN ?2 ELSE done_at END,
           updated_at = ?2
         FROM json_each(?1) o WHERE follow_ups.id = json_extract(o.value, '$.id')`,
      )
      .bind(JSON.stringify(outcome), done),
    db
      .prepare(
        `INSERT INTO activities (id, customer_id, lead_id, job_id, kind, body, meta, created_at, created_by)
         SELECT json_extract(a.value, '$.id'), json_extract(a.value, '$.customerId'), json_extract(a.value, '$.leadId'),
                json_extract(a.value, '$.jobId'), json_extract(a.value, '$.kind'), json_extract(a.value, '$.body'),
                json_extract(a.value, '$.meta'), ?2, 'system'
         FROM json_each(?1) a`,
      )
      .bind(JSON.stringify(timeline), done),
  ]);
  const emailed = outcome.filter((o) => o.ok).length;
  return { emailed, emailFailed: outcome.length - emailed, emailWaiting: Math.max(0, waiting - outcome.length) };
}

/* -------------------------------------------------------------- list */

interface Row {
  id: string;
  customer_id: string | null;
  lead_id: string | null;
  job_id: string | null;
  kind: Kind;
  due_date: string;
  status: 'open' | 'done' | 'skipped' | 'sent';
  channel: Channel | null;
  title: string;
  message: string | null;
  subject: string | null;
  email_state: string | null;
  email_note: string | null;
  sent_at: string | null;
  rule_key: string | null;
  created_at: string;
  updated_at: string;
  done_at: string | null;
  c_name: string | null;
  c_phone: string | null;
  c_email: string | null;
  c_email_ok: number | null;
  c_text_ok: number | null;
  l_name: string | null;
  l_phone: string | null;
  l_email: string | null;
}

const SELECT = `SELECT f.*, c.name AS c_name, c.phone AS c_phone, c.email AS c_email, c.email_ok AS c_email_ok, c.text_ok AS c_text_ok,
                       l.name AS l_name, l.phone AS l_phone, l.email AS l_email
                FROM follow_ups f LEFT JOIN customers c ON c.id = f.customer_id LEFT JOIN leads l ON l.id = f.lead_id`;

function toFollowUp(r: Row) {
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    channel: r.channel,
    /** Why: "Due for a Level I: last one June 12". */
    title: r.title,
    message: r.message,
    subject: r.subject,
    dueDate: r.due_date,
    /** Who. Quote chases have both; the customer is the CRM person made from the quote. */
    customer: r.customer_id
      ? { id: r.customer_id, name: r.c_name ?? r.l_name ?? '', phone: r.c_phone ?? r.l_phone, email: r.c_email ?? r.l_email, emailOk: r.c_email_ok !== 0, textOk: r.c_text_ok !== 0 }
      : r.lead_id
        ? { id: null, name: r.l_name ?? '', phone: r.l_phone, email: r.l_email, emailOk: true, textOk: true }
        : null,
    leadId: r.lead_id,
    jobId: r.job_id,
    /** Automatic email: queued, sending, sent or failed (with why), else null. */
    email: r.email_state ? { state: r.email_state, note: r.email_note, sentAt: r.sent_at } : null,
    auto: r.rule_key !== null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    doneAt: r.done_at,
  };
}
export type FollowUp = ReturnType<typeof toFollowUp>;

async function listFollowUps(env: Bindings, q: { customerId?: string }) {
  const { timezone, settings } = await loadSettings(env.DB);
  const at = new Date();
  const today = localDate(at, timezone);
  const weekAgo = new Date(at.getTime() - 7 * 864e5).toISOString();
  const dayAgo = new Date(at.getTime() - 864e5).toISOString();
  const [rows, sent] = await env.DB.batch<Record<string, unknown>>([
    q.customerId
      ? env.DB.prepare(`${SELECT} WHERE f.customer_id = ?1 ORDER BY f.due_date DESC, f.id DESC LIMIT 200`).bind(q.customerId)
      : env.DB
          .prepare(`${SELECT} WHERE f.status = 'open' OR f.updated_at >= ?1 ORDER BY f.due_date, f.id LIMIT 1000`)
          .bind(weekAgo),
    env.DB.prepare("SELECT COUNT(*) AS n FROM activities WHERE kind = 'email' AND created_by = 'system' AND created_at >= ?").bind(dayAgo),
  ]);
  const all = (rows!.results as unknown as Row[]).map(toFollowUp);
  const email = {
    configured: !!env.RESEND_API_KEY,
    sentLastDay: Number((sent!.results[0] as { n: number }).n),
    perDay: settings.emailsPerDay,
  };
  if (q.customerId) return { today, followUps: all, email };
  return {
    today,
    /** Open and due today or before: the "People to contact today" list. */
    due: all.filter((f) => f.status === 'open' && f.dueDate <= today),
    /** Open, due later (snoozed ones and Jacob's own for later days). */
    upcoming: all.filter((f) => f.status === 'open' && f.dueDate > today),
    /** Sent automatically in the last 7 days. */
    sent: all.filter((f) => f.status === 'sent').reverse(),
    /** Done or skipped in the last 7 days. */
    done: all.filter((f) => f.status === 'done' || f.status === 'skipped').reverse(),
    email,
  };
}

async function getFollowUp(db: D1Database, id: string) {
  const row = await db.prepare(`${SELECT} WHERE f.id = ?`).bind(id).first<Row>();
  if (!row) throw new ApiError(404, 'not_found', 'No follow-up with that ID.');
  return toFollowUp(row);
}

/* ----------------------------------------------------------- changes */

const who = (o: Owner) => o.email ?? o.subject;
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

/** Finishes an open follow-up; logs what Jacob did on the customer's timeline. */
async function finish(env: Bindings, id: string, status: 'done' | 'skipped', how: Channel | null, by: string) {
  const f = await getFollowUp(env.DB, id);
  if (f.status !== 'open') throw new ApiError(409, 'not_open', 'That one is already taken care of.');
  if (f.email?.state === 'sending') throw new ApiError(409, 'sending', 'That email is going out right now.');
  const stamp = now();
  const stmts = [
    env.DB
      .prepare("UPDATE follow_ups SET status = ?1, channel = COALESCE(?2, channel), done_at = ?3, updated_at = ?3, email_state = CASE WHEN email_state = 'queued' THEN NULL ELSE email_state END WHERE id = ?4 AND status = 'open'")
      .bind(status, how, stamp, id),
  ];
  const customerId = f.customer?.id ?? null;
  if (status === 'done' && how && (customerId || f.leadId)) {
    const kind = how === 'text' ? 'text' : how === 'call' ? 'call' : 'email';
    const body = how === 'call' ? `Called: ${f.title}` : f.message ?? f.title;
    stmts.push(activityStatement(env.DB, { customerId, leadId: f.leadId, jobId: f.jobId, kind, body, meta: { followUpId: id, rule: f.kind }, by }));
    if (f.kind === 'review' && how !== 'call') {
      stmts.push(activityStatement(env.DB, { customerId, leadId: f.leadId, jobId: f.jobId, kind: 'review_request', body: `Asked for a Google review by ${how}.`, meta: { followUpId: id }, by }));
    }
  }
  const [res] = await env.DB.batch(stmts);
  if (res!.meta.changes !== 1) throw new ApiError(409, 'not_open', 'That one is already taken care of.');
  return getFollowUp(env.DB, id);
}

async function createManual(env: Bindings, body: Record<string, unknown>) {
  const title = text(body.title, 'What to do', 200);
  if (!title) throw new ApiError(422, 'invalid', 'Say what to do, like "Call Bob back about the boat".');
  const dueDate = body.dueDate ?? localDate(new Date(), (await loadSettings(env.DB)).timezone);
  if (!isDate(dueDate)) throw new ApiError(422, 'invalid', 'Pick a day.');
  const message = text(body.message, 'Message', 2000) ?? null;
  const channel = body.channel ?? null;
  if (channel !== null && !(CHANNELS as readonly unknown[]).includes(channel)) throw new ApiError(422, 'invalid', 'channel must be text, email or call.');
  let customerId: string | null = null;
  let leadId: string | null = null;
  if (body.customerId !== undefined && body.customerId !== null) {
    const c = await env.DB.prepare('SELECT id FROM customers WHERE id = ?').bind(String(body.customerId)).first<{ id: string }>();
    if (!c) throw new ApiError(404, 'not_found', 'No customer with that ID.');
    customerId = c.id;
  }
  if (body.leadId !== undefined && body.leadId !== null) {
    const l = await env.DB.prepare('SELECT id, customer_id FROM leads WHERE id = ?').bind(String(body.leadId)).first<{ id: string; customer_id: string | null }>();
    if (!l) throw new ApiError(404, 'not_found', 'No quote request with that ID.');
    leadId = l.id;
    customerId ??= l.customer_id;
  }
  const id = ulid();
  const stamp = now();
  await env.DB
    .prepare(
      `INSERT INTO follow_ups (id, customer_id, lead_id, kind, due_date, status, channel, title, message, created_at, updated_at)
       VALUES (?, ?, ?, 'custom', ?, 'open', ?, ?, ?, ?, ?)`,
    )
    .bind(id, customerId, leadId, dueDate, channel, title, message, stamp, stamp)
    .run();
  return getFollowUp(env.DB, id);
}

async function editFollowUp(env: Bindings, id: string, body: Record<string, unknown>) {
  const f = await getFollowUp(env.DB, id);
  if (f.status !== 'open') throw new ApiError(409, 'not_open', "That one is finished, so it can't be changed.");
  if (f.email?.state === 'sending') throw new ApiError(409, 'sending', 'That email is going out right now.');
  const sets: [string, unknown][] = [];
  if ('message' in body) sets.push(['message', text(body.message, 'Message', 2000) ?? null]);
  if ('subject' in body) sets.push(['subject', text(body.subject, 'Subject', 150) ?? null]);
  if ('title' in body) {
    const t = text(body.title, 'What to do', 200);
    if (!t) throw new ApiError(422, 'invalid', "What to do can't be empty.");
    sets.push(['title', t]);
  }
  if ('dueDate' in body) {
    if (!isDate(body.dueDate)) throw new ApiError(422, 'invalid', 'Pick a day.');
    sets.push(['due_date', body.dueDate]);
  }
  if ('channel' in body) {
    if (body.channel !== null && !(CHANNELS as readonly unknown[]).includes(body.channel)) throw new ApiError(422, 'invalid', 'channel must be text, email or call.');
    sets.push(['channel', body.channel]);
    // Choosing to text it himself takes it out of the email queue.
    if (body.channel !== 'email' && f.email?.state === 'queued') sets.push(['email_state', null]);
  }
  if (!sets.length) return f;
  await env.DB
    .prepare(`UPDATE follow_ups SET ${sets.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ? AND status = 'open'`)
    .bind(...sets.map(([, v]) => v), now(), id)
    .run();
  return getFollowUp(env.DB, id);
}

async function snooze(env: Bindings, id: string, body: Record<string, unknown>) {
  const f = await getFollowUp(env.DB, id);
  if (f.status !== 'open') throw new ApiError(409, 'not_open', 'That one is already taken care of.');
  let until: string;
  if (body.until !== undefined) {
    if (!isDate(body.until)) throw new ApiError(422, 'invalid', 'Pick a day.');
    until = body.until;
  } else {
    const days = body.days;
    if (!(typeof days === 'number' && Number.isInteger(days) && days >= 1 && days <= 90)) throw new ApiError(422, 'invalid', 'Snooze for 1 to 90 days.');
    const { timezone } = await loadSettings(env.DB);
    until = addDays(localDate(new Date(), timezone), days);
  }
  return editFollowUp(env, id, { dueDate: until });
}

async function reopen(env: Bindings, id: string) {
  const f = await getFollowUp(env.DB, id);
  if (f.status === 'open') return f;
  if (f.status === 'sent') throw new ApiError(409, 'sent', 'That email already went out.');
  await env.DB.prepare("UPDATE follow_ups SET status = 'open', done_at = NULL, updated_at = ? WHERE id = ?").bind(now(), id).run();
  return getFollowUp(env.DB, id);
}

/* ------------------------------------------------------------ routes */

followups.get('/', async (c) => c.json(await listFollowUps(c.env, { customerId: c.req.query('customerId') })));

followups.post('/', async (c) => c.json(await createManual(c.env, await json(c.req.raw)), 201));

/** "Check now": runs the daily rules and sends what's due. Safe to repeat. */
followups.post('/run', async (c) => {
  // Tests only (the test Worker counts queries): run as if it were another moment.
  const body = c.env.COUNT_QUERIES === '1' ? await json(c.req.raw).catch(() => ({}) as Record<string, unknown>) : {};
  const at = typeof body.at === 'string' && !Number.isNaN(Date.parse(body.at)) ? new Date(body.at) : new Date();
  return c.json(await runDaily(c.env, at));
});

followups.get('/settings', async (c) => {
  const { settings, updatedAt } = await loadSettings(c.env.DB);
  const { results } = await c.env.DB.prepare('SELECT config FROM pricing_configs ORDER BY version DESC LIMIT 1').all<{ config: string }>();
  const pricing = results[0] ? (JSON.parse(results[0].config) as PricingConfig) : defaultConfig;
  return c.json({
    settings,
    defaults: DEFAULT_SETTINGS,
    updatedAt,
    placeholders: PLACEHOLDERS,
    /** Packages to set intervals for, in Jacob's names. */
    services: pricing.services.map((s) => ({ id: s.id, name: s.name, level: LEVEL[s.id] ?? null })),
    fallbackReviewUrl: FALLBACK_REVIEW_URL,
    email: { configured: !!c.env.RESEND_API_KEY },
  });
});

followups.put('/settings', async (c) => {
  const settings = validateSettings(await json(c.req.raw));
  const updatedAt = await saveSettings(c.env.DB, settings, who(c.get('owner')));
  return c.json({ settings, updatedAt });
});

followups.get('/:id', async (c) => c.json(await getFollowUp(c.env.DB, c.req.param('id'))));
followups.patch('/:id', async (c) => c.json(await editFollowUp(c.env, c.req.param('id'), await json(c.req.raw))));

followups.post('/:id/done', async (c) => {
  const body = await json(c.req.raw).catch(() => ({}) as Record<string, unknown>);
  const how = body.how ?? null;
  if (how !== null && !(CHANNELS as readonly unknown[]).includes(how)) throw new ApiError(422, 'invalid', 'how must be text, email or call.');
  return c.json(await finish(c.env, c.req.param('id'), 'done', how as Channel | null, who(c.get('owner'))));
});
/** "I texted them": done, with the message on their timeline as a text. */
followups.post('/:id/texted', async (c) => c.json(await finish(c.env, c.req.param('id'), 'done', 'text', who(c.get('owner')))));
followups.post('/:id/skip', async (c) => c.json(await finish(c.env, c.req.param('id'), 'skipped', null, who(c.get('owner')))));
followups.post('/:id/snooze', async (c) => c.json(await snooze(c.env, c.req.param('id'), await json(c.req.raw))));
followups.post('/:id/reopen', async (c) => c.json(await reopen(c.env, c.req.param('id'))));

