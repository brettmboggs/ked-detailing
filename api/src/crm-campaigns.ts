import { Hono, type Context } from 'hono';
import type { AppEnv } from './app-env.ts';
import { requireOwner } from './auth.ts';
import { getBrand } from './brand.ts';
import { activityStatement, logActivity } from './crm-activity.ts';
import { sendMarketingEmail, type MarketingResult } from './crm-email.ts';
import { readSegment, segmentCustomers, type CustomerStats, type Segment } from './crm-segments.ts';
import { referralCode } from './customers.ts';
import { ApiError, json, now, text, ulid, type Bindings } from './lib.ts';
import { currentPricing } from './pricing.ts';

/**
 * Marketing (docs/crm.md, part 4). Mounted at /v1/crm/campaigns:
 *
 * - Campaigns: a message to a segment of customers, by email (sent here, a
 *   batch per request) or as a text list Jacob works through on his phone.
 * - Tracking links for each place he advertises, and what each one brought.
 * - The referral program: rewards, the leaderboard, each customer's link.
 * - Reviews: who to ask, and marking them asked.
 * - The playbook: where to find more work, from his own numbers.
 *
 * The free plan allows 50 database queries per request, and Resend's free
 * plan 100 emails a day. An email campaign queues everyone in one statement,
 * then sends BATCH emails per call to POST /:id/send (about 3 queries each);
 * the admin calls it again until the queue is empty, and `runCampaigns` does
 * the same from a cron.
 */
export const campaigns = new Hono<AppEnv>();
campaigns.use('*', requireOwner);

/** Emails per request. sendMarketingEmail makes about 3 queries each. */
export const BATCH = 10;
/** Campaign emails per day (UTC, like Resend's count), leaving room for follow-ups and booking mail. */
export const DAILY_EMAILS = 90;
/** Resend's free plan takes 2 requests a second. */
const SEND_GAP_MS = 520;

const who = (c: Context<AppEnv>) => c.get('owner').email ?? c.get('owner').subject;
const site = (env: Bindings) => (env.SITE_URL || 'https://www.kedservice.com').replace(/\/$/, '');
const VALUE = "COALESCE(j.final_price, CAST(json_extract(j.quote, '$.total') AS INTEGER), 0)";

/* ------------------------------------------------------------ settings */

export interface MarketingSettings {
  /** What the customer who shares their link gets, as it reads in a message. */
  referrerGets: string;
  /** What the friend they send gets. */
  friendGets: string;
  /** Where review asks send people. Null: the website's review link. */
  reviewUrl: string | null;
  /** Playbook checklist: key → when he last ticked it. */
  done: Record<string, string>;
}

const DEFAULTS: MarketingSettings = {
  referrerGets: '$20 off your next detail',
  friendGets: '$20 off their first detail',
  reviewUrl: null,
  done: {},
};

/** His marketing settings, plus the review link saved on the Website tab. One query. */
async function loadSettings(db: D1Database) {
  const { results } = await db.prepare("SELECT key, value FROM settings WHERE key IN ('marketing', 'site')").all<{ key: string; value: string }>();
  const parse = (key: string) => {
    try {
      return JSON.parse(results.find((r) => r.key === key)?.value ?? '{}') as Record<string, any>;
    } catch {
      return {};
    }
  };
  const saved = parse('marketing');
  const settings: MarketingSettings = {
    referrerGets: typeof saved.referrerGets === 'string' ? saved.referrerGets : DEFAULTS.referrerGets,
    friendGets: typeof saved.friendGets === 'string' ? saved.friendGets : DEFAULTS.friendGets,
    reviewUrl: typeof saved.reviewUrl === 'string' ? saved.reviewUrl : null,
    done: saved.done && typeof saved.done === 'object' ? saved.done : {},
  };
  const siteUrl = parse('site').reviews?.url;
  return { settings, siteReviewUrl: typeof siteUrl === 'string' ? siteUrl : null };
}

async function saveSettings(db: D1Database, s: MarketingSettings, by: string) {
  await db
    .prepare(
      `INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('marketing', ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    )
    .bind(JSON.stringify(s), now(), by)
    .run();
}

const url = (v: unknown, field: string) => {
  const s = text(v, field, 300);
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error();
  } catch {
    throw new ApiError(422, 'invalid', `${field} must be a web address starting with https://.`);
  }
  return s;
};

campaigns.get('/settings', async (c) => c.json(await loadSettings(c.env.DB)));

campaigns.put('/settings', async (c) => {
  const body = await json(c.req.raw);
  const { settings } = await loadSettings(c.env.DB);
  if ('referrerGets' in body) settings.referrerGets = text(body.referrerGets, 'What they get', 80) ?? DEFAULTS.referrerGets;
  if ('friendGets' in body) settings.friendGets = text(body.friendGets, 'What their friend gets', 80) ?? DEFAULTS.friendGets;
  if ('reviewUrl' in body) settings.reviewUrl = url(body.reviewUrl, 'Review link');
  await saveSettings(c.env.DB, settings, who(c));
  return c.json(await loadSettings(c.env.DB));
});

/* ------------------------------------------------------------ messages */

export const PLACEHOLDERS = ['first', 'name', 'last service', 'referral link', 'quote link', 'you get', 'friend gets'] as const;

interface Person {
  name: string;
  referralCode: string | null;
  lastService: string | null;
}

interface RenderCtx {
  site: string;
  services: Map<string, string>;
  settings: MarketingSettings;
  channel: 'email' | 'text';
  slug: string;
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'campaign';

const placeholderKey = (raw: string) => raw.trim().toLowerCase().replace(/\s+/g, ' ');

/** Fills {first}, {name}, {last service}, {referral link}, {quote link}, {you get}, {friend gets}. Unknown ones stay as typed. */
export function render(tpl: string, p: Person, ctx: RenderCtx): string {
  return tpl.replace(/\{([^{}\n]{1,30})\}/g, (whole, raw: string) => {
    switch (placeholderKey(raw)) {
      case 'first':
        return p.name.trim().split(/\s+/)[0] ?? p.name;
      case 'name':
        return p.name.trim();
      case 'last service':
        // "since your Knockout", not "since your The Knockout".
        return ((p.lastService && ctx.services.get(p.lastService)) || 'detail').replace(/^the\s+/i, '');
      case 'referral link':
        return p.referralCode ? `${ctx.site}/?ref=${p.referralCode}` : `${ctx.site}/`;
      case 'quote link':
        // Kept short for texts; the site records source and campaign on the first visit.
        return `${ctx.site}/quote/?utm_source=${ctx.channel}&utm_campaign=${ctx.slug}`;
      case 'you get':
        return ctx.settings.referrerGets;
      case 'friend gets':
        return ctx.settings.friendGets;
      default:
        return whole;
    }
  });
}

const unknownPlaceholders = (...texts: (string | null)[]) => [
  ...new Set(
    texts
      .flatMap((t) => [...(t ?? '').matchAll(/\{([^{}\n]{1,30})\}/g)].map((m) => m[1]!))
      .filter((k) => !(PLACEHOLDERS as readonly string[]).includes(placeholderKey(k))),
  ),
];

const needs = (texts: (string | null)[], ...keys: string[]) =>
  texts.some((t) => [...(t ?? '').matchAll(/\{([^{}\n]{1,30})\}/g)].some((m) => keys.includes(placeholderKey(m[1]!))));

/** What rendering needs from the database, skipping what the message doesn't use. At most 2 queries. */
async function renderCtx(env: Bindings, texts: (string | null)[], channel: 'email' | 'text', name: string): Promise<RenderCtx> {
  const [pricing, loaded] = await Promise.all([
    needs(texts, 'last service') ? currentPricing(env.DB) : null,
    needs(texts, 'you get', 'friend gets') ? loadSettings(env.DB) : null,
  ]);
  return {
    site: site(env),
    services: new Map((pricing?.config.services ?? []).map((s) => [s.id, s.name] as [string, string])),
    settings: loaded?.settings ?? DEFAULTS,
    channel,
    slug: slugify(name),
  };
}

/* ------------------------------------------------------------ templates */

export interface Template {
  id: string;
  name: string;
  /** Who it's for and why, in Jacob's words. */
  why: string;
  /** Months (1-12, St. Louis time) it fits; empty for any time. */
  months: number[];
  channel: 'email' | 'text';
  subject: string;
  email: string;
  text: string;
  segment: Segment;
}

// TENANT: the sign-off, and the templates below, name Jacob and the business.
const SIGN = "Jacob\nKnock Em' Down Detailing\n(314) 223-2988";

export const TEMPLATES: Template[] = [
  {
    id: 'spring-boats',
    name: 'Spring boat season',
    why: 'Everyone who has had a boat done. Send it in March, before the lake opens.',
    months: [3, 4, 5],
    channel: 'text',
    segment: { services: ['marine'] },
    subject: 'Get the boat ready before the lake opens',
    email: `Hey {first},\n\nBoat season is almost here. I'm booking spring boat details now: a full wash, the hull, the vinyl and the carpet, so it's ready on day one.\n\nThe good weekends go fast. Grab a time here: {quote link}\n\nOr just reply and I'll set it up.\n\n${SIGN}`,
    text: "Hey {first}, it's Jacob with Knock Em' Down. Boat season is almost here! I'm booking spring boat details now so it's ready for the lake. Want me to get you on the schedule? {quote link}",
  },
  {
    id: 'winter-salt',
    name: 'Winter salt and undercarriage',
    why: 'Past customers with nothing booked. Salt eats paint and the underside of a car all winter.',
    months: [12, 1, 2, 3],
    channel: 'email',
    segment: { lifecycle: 'customer', noUpcoming: true },
    subject: "The salt's out. Let's get it off your car",
    email: `Hey {first},\n\nThe road salt is out, and it eats at your paint and the underside of your car. I'm doing salt removal and undercarriage washes all winter, and I come to you.\n\nPick a time here: {quote link}\n\nOr reply and tell me what works.\n\n${SIGN}`,
    text: "Hey {first}, it's Jacob with Knock Em' Down. That road salt is rough on your car. I'm doing salt and undercarriage washes all winter, and I come to you. Want a spot? {quote link}",
  },
  {
    id: 'holiday-gift',
    name: 'Holiday gift cards',
    why: 'Everyone who has had work done. A detail is an easy gift for the person who has everything.',
    months: [11, 12],
    channel: 'email',
    segment: { lifecycle: 'customer' },
    subject: "A gift that fits in a card: a detail from Knock Em' Down",
    email: `Hey {first},\n\nStuck on a gift? A detail is one people actually use. I have gift cards for any amount or any package, and I come to them.\n\nJust reply with the amount and who it's for, and I'll send it over.\n\nThanks for a great year.\n\n${SIGN}`,
    text: "Hey {first}, it's Jacob with Knock Em' Down. I've got detail gift cards for the holidays, any amount or package. Want one for someone? Just text me back who it's for.",
  },
  {
    id: 'miss-you',
    name: "Haven't seen you in a while",
    why: "Customers whose last visit was over 6 months ago and have nothing booked.",
    months: [],
    channel: 'text',
    segment: { lifecycle: 'lapsed', lapsedDays: 180 },
    subject: "It's been a while, {first}",
    email: `Hey {first},\n\nIt's been a while since your {last service}. If the car could use some love, I'd be glad to come out again.\n\nPick a time here: {quote link}\n\nOr just reply.\n\n${SIGN}`,
    text: "Hey {first}, it's Jacob with Knock Em' Down. It's been a while since your {last service}! Want me to come out again? Here's my calendar: {quote link}",
  },
  {
    id: 'ceramic-upsell',
    name: 'Ceramic coating for Level III customers',
    why: "People who got a Level III. They already care about their paint, so they're the best fit for ceramic.",
    months: [9, 10],
    channel: 'email',
    segment: { services: ['level-3'], lifecycle: 'customer' },
    subject: 'Keep it looking like the day I finished it',
    email: `Hey {first},\n\nYou went for the full job last time, so I wanted you to hear about this first. A ceramic coating locks in that finish for years. Water beads off, dirt washes off easier, and salt and sun do a lot less damage.\n\nIf you want to talk about it, reply here or book a time: {quote link}\n\n${SIGN}`,
    text: "Hey {first}, it's Jacob with Knock Em' Down. Since you got the full detail last time, want to keep it that way for years? I'm doing ceramic coatings now. Happy to tell you more: {quote link}",
  },
  {
    id: 'referral',
    name: 'Referral ask to your best customers',
    why: 'Your 25 best repeat customers. Happy regulars are the best way to get new ones.',
    months: [],
    channel: 'text',
    segment: { lifecycle: 'repeat', sort: 'spend', limit: 25 },
    subject: 'A thank-you, and a favor',
    email: `Hey {first},\n\nThanks for being one of my regulars. It means a lot.\n\nIf a friend or neighbor needs a detail, send them your link: {referral link}\n\nThey get {friend gets}, and you get {you get}.\n\n${SIGN}`,
    text: "Hey {first}, it's Jacob with Knock Em' Down. Thanks for being a regular! If a friend needs a detail, send them your link: {referral link} They get {friend gets} and you get {you get}.",
  },
];

campaigns.get('/templates', (c) => c.json({ templates: TEMPLATES, placeholders: PLACEHOLDERS }));

/* ------------------------------------------------------------ campaigns */

interface CampaignRow {
  id: string;
  name: string;
  segment: string;
  channel: 'email' | 'text';
  subject: string | null;
  body: string;
  status: 'draft' | 'sending' | 'sent';
  template: string | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
}

interface Counts {
  total: number;
  queued: number;
  sent: number;
  failed: number;
  skipped: number;
  bookings: number;
  bookedValue: number; // cents
}

const COUNTS_SQL = `COUNT(s.customer_id) AS total,
  COUNT(*) FILTER (WHERE s.status = 'queued') AS queued,
  COUNT(*) FILTER (WHERE s.status = 'sent') AS sent,
  COUNT(*) FILTER (WHERE s.status = 'failed') AS failed,
  COUNT(*) FILTER (WHERE s.status = 'skipped') AS skipped`;

/** Jobs booked by people who got a campaign, within 30 days after they got it. */
const BOOKINGS_SQL = `SELECT s.campaign_id, COUNT(DISTINCT j.id) AS bookings, COALESCE(SUM(${VALUE}), 0) AS value
  FROM campaign_sends s
  JOIN jobs j ON j.customer_id = s.customer_id AND j.status != 'cancelled'
   AND j.created_at >= s.sent_at AND j.created_at < strftime('%Y-%m-%dT%H:%M:%fZ', s.sent_at, '+30 days')
  WHERE s.status = 'sent'`;

function toCampaign(r: CampaignRow & Partial<Record<keyof Counts, number>>, booked?: { bookings: number; value: number }) {
  let segment: unknown = {};
  try {
    segment = JSON.parse(r.segment);
  } catch {
    segment = {};
  }
  return {
    id: r.id,
    name: r.name,
    template: r.template,
    segment,
    channel: r.channel,
    subject: r.subject,
    body: r.body,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    sentAt: r.sent_at,
    stats: {
      total: Number(r.total ?? 0),
      queued: Number(r.queued ?? 0),
      sent: Number(r.sent ?? 0),
      failed: Number(r.failed ?? 0),
      skipped: Number(r.skipped ?? 0),
      bookings: Number(booked?.bookings ?? 0),
      bookedValue: Number(booked?.value ?? 0),
    },
  };
}

async function getCampaign(db: D1Database, id: string) {
  const [row, booked] = await db.batch([
    db.prepare(`SELECT c.*, ${COUNTS_SQL} FROM campaigns c LEFT JOIN campaign_sends s ON s.campaign_id = c.id WHERE c.id = ? GROUP BY c.id`).bind(id),
    db.prepare(`${BOOKINGS_SQL} AND s.campaign_id = ? GROUP BY s.campaign_id`).bind(id),
  ]);
  const r = (row!.results as (CampaignRow & Counts)[])[0];
  if (!r) throw new ApiError(404, 'not_found', 'No campaign with that ID.');
  return toCampaign(r, (booked!.results as { bookings: number; value: number }[])[0]);
}

/** Checks a campaign from a request body. `partial` for edits. */
function readCampaign(body: Record<string, unknown>, partial: boolean) {
  const out: { name?: string; segment?: string; channel?: 'email' | 'text'; subject?: string | null; body?: string } = {};
  if (!partial || 'name' in body) {
    const name = text(body.name, 'Name', 80);
    if (!name) throw new ApiError(422, 'invalid', 'Give the campaign a name.');
    out.name = name;
  }
  if (!partial || 'channel' in body) {
    if (body.channel !== 'email' && body.channel !== 'text') throw new ApiError(422, 'invalid', 'Pick email or text.');
    out.channel = body.channel;
  }
  if (!partial || 'segment' in body) out.segment = segmentJson(body.segment);
  if ('subject' in body) out.subject = text(body.subject, 'Subject', 150) ?? null;
  if (!partial || 'body' in body) {
    const b = typeof body.body === 'string' ? body.body.trim() : '';
    if (!b) throw new ApiError(422, 'invalid', 'Write the message.');
    if (b.length > 5000) throw new ApiError(422, 'invalid', 'The message is too long.');
    out.body = b;
  }
  return out;
}

/** A segment as stored: checked, without the default list length (a campaign goes to everyone who matches). */
function segmentJson(raw: unknown) {
  const seg = readSegment(raw) as Record<string, unknown>;
  if (!(raw && typeof raw === 'object' && 'limit' in raw)) delete seg.limit;
  for (const k of Object.keys(seg)) if (seg[k] === undefined) delete seg[k];
  return JSON.stringify(seg);
}

const storedSegment = (json: string): Segment => {
  const raw = JSON.parse(json) as Record<string, unknown>;
  return { ...readSegment(raw), limit: typeof raw.limit === 'number' ? Math.min(raw.limit, 2000) : 2000 };
};

campaigns.get('/', async (c) => {
  const db = c.env.DB;
  const [rows, booked] = await db.batch([
    db.prepare(`SELECT c.*, ${COUNTS_SQL} FROM campaigns c LEFT JOIN campaign_sends s ON s.campaign_id = c.id GROUP BY c.id ORDER BY c.id DESC LIMIT 200`),
    db.prepare(`${BOOKINGS_SQL} GROUP BY s.campaign_id`),
  ]);
  const byId = new Map((booked!.results as { campaign_id: string; bookings: number; value: number }[]).map((b) => [b.campaign_id, b]));
  return c.json({
    campaigns: (rows!.results as (CampaignRow & Counts)[]).map((r) => toCampaign(r, byId.get(r.id))),
    emailReady: !!c.env.RESEND_API_KEY,
  });
});

/** A new draft, blank or from a template: { template } or { name, segment, channel, subject, body }. */
campaigns.post('/', async (c) => {
  const body = await json(c.req.raw);
  let fields;
  let template: string | null = null;
  if (typeof body.template === 'string') {
    const t = TEMPLATES.find((x) => x.id === body.template);
    if (!t) throw new ApiError(422, 'invalid', 'No template with that name.');
    template = t.id;
    const channel = body.channel === 'email' || body.channel === 'text' ? body.channel : t.channel;
    fields = readCampaign({ name: t.name, segment: t.segment, channel, subject: t.subject, body: channel === 'email' ? t.email : t.text }, false);
  } else {
    fields = readCampaign(body, false);
  }
  const id = ulid();
  const at = now();
  await c.env.DB.prepare(
    `INSERT INTO campaigns (id, name, segment, channel, subject, body, status, template, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
  )
    .bind(id, fields.name, fields.segment, fields.channel, fields.subject ?? null, fields.body, template, at, at)
    .run();
  return c.json(await getCampaign(c.env.DB, id), 201);
});

/**
 * Who a message would go to and how it reads, without saving anything:
 * { segment, channel, subject, body, name?, sampleId? }.
 */
campaigns.post('/preview', async (c) => {
  const body = await json(c.req.raw);
  const channel = body.channel === 'text' ? 'text' : 'email';
  const seg = storedSegment(segmentJson(body.segment));
  const subject = typeof body.subject === 'string' ? body.subject : '';
  const message = typeof body.body === 'string' ? body.body : '';
  const [people, ctx] = await Promise.all([
    segmentCustomers(c.env.DB, seg),
    renderCtx(c.env, [subject, message], channel, typeof body.name === 'string' ? body.name : 'campaign'),
  ]);
  const canEmail = (p: CustomerStats) => !!p.email && p.emailOk;
  const canText = (p: CustomerStats) => !!p.phone && p.textOk;
  const reachable = channel === 'email' ? canEmail : canText;
  const sample = people.find((p) => p.id === body.sampleId) ?? people.find(reachable) ?? people[0];
  return c.json({
    count: people.length,
    canEmail: people.filter(canEmail).length,
    canText: people.filter(canText).length,
    people: people.slice(0, 100).map((p) => ({
      id: p.id,
      name: p.name,
      canEmail: canEmail(p),
      canText: canText(p),
      visits: p.visits,
      spend: p.spend,
      lastVisit: p.lastVisit,
    })),
    sample: sample
      ? {
          id: sample.id,
          name: sample.name,
          subject: channel === 'email' ? render(subject, sample, ctx) : null,
          body: render(message, sample, ctx),
        }
      : null,
    unknown: unknownPlaceholders(subject, message),
  });
});

/* ------------------------------------------------------------ tracking links */
// Before /:id, so these paths aren't read as campaign IDs.

interface LinkRow {
  id: string;
  name: string;
  channel: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  created_at: string;
  leads?: number;
  bookings?: number;
  revenue?: number;
}

const linkUrl = (env: Bindings, r: LinkRow) =>
  `${site(env)}/?utm_source=${encodeURIComponent(r.utm_source)}&utm_medium=${encodeURIComponent(r.utm_medium)}&utm_campaign=${encodeURIComponent(r.utm_campaign)}`;

const toLink = (env: Bindings, r: LinkRow) => ({
  id: r.id,
  name: r.name,
  channel: r.channel,
  source: r.utm_source,
  medium: r.utm_medium,
  campaign: r.utm_campaign,
  url: linkUrl(env, r),
  createdAt: r.created_at,
  leads: Number(r.leads ?? 0),
  bookings: Number(r.bookings ?? 0),
  revenue: Number(r.revenue ?? 0),
});

const tag = (v: unknown, field: string) => {
  const s = (typeof v === 'string' ? v : '').trim().toLowerCase().replace(/\s+/g, '-');
  if (!/^[a-z0-9][a-z0-9_.-]{0,39}$/.test(s)) throw new ApiError(422, 'invalid', `${field} must be a short word: letters, numbers and dashes.`);
  return s;
};

/**
 * People and jobs each link brought: leads and customers whose first visit
 * carried the link's utm_source and utm_campaign. One query.
 */
const LINKS_SQL = `
  WITH m AS (
    SELECT t.id AS link_id, c.id AS person FROM tracked_links t
    JOIN customers c ON c.attribution IS NOT NULL
      AND lower(json_extract(c.attribution, '$.utmSource')) = t.utm_source
      AND lower(json_extract(c.attribution, '$.utmCampaign')) = t.utm_campaign
    UNION
    SELECT t.id, COALESCE(l.customer_id, 'lead:' || l.id) FROM tracked_links t
    JOIN leads l ON l.attribution IS NOT NULL
      AND lower(json_extract(l.attribution, '$.utmSource')) = t.utm_source
      AND lower(json_extract(l.attribution, '$.utmCampaign')) = t.utm_campaign
  )
  SELECT t.*,
    (SELECT COUNT(*) FROM m WHERE m.link_id = t.id) AS leads,
    (SELECT COUNT(*) FROM jobs j WHERE j.status != 'cancelled' AND j.customer_id IN (SELECT person FROM m WHERE m.link_id = t.id)) AS bookings,
    (SELECT COALESCE(SUM(${VALUE}), 0) FROM jobs j WHERE j.status = 'done' AND j.customer_id IN (SELECT person FROM m WHERE m.link_id = t.id)) AS revenue
  FROM tracked_links t`;

campaigns.get('/links', async (c) => {
  const { results } = await c.env.DB.prepare(`${LINKS_SQL} ORDER BY t.id DESC`).all<LinkRow>();
  return c.json({ links: results.map((r) => toLink(c.env, r)), site: site(c.env) });
});

campaigns.post('/links', async (c) => {
  const body = await json(c.req.raw);
  const name = text(body.name, 'Name', 80);
  if (!name) throw new ApiError(422, 'invalid', 'Give the link a name, like "Van magnet".');
  const channel = tag(body.channel ?? 'other', 'Channel');
  const row: LinkRow = {
    id: ulid(),
    name,
    channel,
    utm_source: tag(body.source, 'Source'),
    utm_medium: tag(body.medium, 'Medium'),
    utm_campaign: tag(body.campaign, 'Campaign'),
    created_at: now(),
  };
  try {
    await c.env.DB.prepare(
      `INSERT INTO tracked_links (id, name, channel, utm_source, utm_medium, utm_campaign, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(row.id, row.name, row.channel, row.utm_source, row.utm_medium, row.utm_campaign, row.created_at, who(c))
      .run();
  } catch (err) {
    if (/UNIQUE/i.test(String(err))) throw new ApiError(409, 'duplicate', 'You already have a link with that source and campaign. Change the campaign word.');
    throw err;
  }
  return c.json(toLink(c.env, row), 201);
});

campaigns.patch('/links/:id', async (c) => {
  const body = await json(c.req.raw);
  const name = text(body.name, 'Name', 80);
  if (!name) throw new ApiError(422, 'invalid', "The name can't be empty.");
  const row = await c.env.DB.prepare('UPDATE tracked_links SET name = ? WHERE id = ? RETURNING *').bind(name, c.req.param('id')).first<LinkRow>();
  if (!row) throw new ApiError(404, 'not_found', 'No link with that ID.');
  return c.json(toLink(c.env, row));
});

campaigns.delete('/links/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM tracked_links WHERE id = ?').bind(c.req.param('id')).run();
  return c.body(null, 204);
});

/* ------------------------------------------------------------ referrals */

/** Gives customers without a referral code one. One statement for any number. */
async function fillReferralCodes(db: D1Database, ids: string[]) {
  if (!ids.length) return;
  const codes = ids.map((id) => ({ id, code: referralCode() }));
  await db
    .prepare(
      `UPDATE customers SET referral_code = (SELECT json_extract(value, '$.code') FROM json_each(?1) WHERE json_extract(value, '$.id') = customers.id)
       WHERE referral_code IS NULL AND id IN (SELECT json_extract(value, '$.id') FROM json_each(?1))`,
    )
    .bind(JSON.stringify(codes))
    .run();
}

campaigns.get('/referrals', async (c) => {
  const db = c.env.DB;
  const [leaders, totals, loaded] = await Promise.all([
    db
      .prepare(
        `SELECT r.id, r.name, r.phone, r.referral_code,
           COUNT(*) AS referred,
           SUM(EXISTS (SELECT 1 FROM jobs j WHERE j.customer_id = f.id AND j.status = 'done')) AS became_customers,
           SUM((SELECT COALESCE(SUM(${VALUE}), 0) FROM jobs j WHERE j.customer_id = f.id AND j.status = 'done')) AS revenue
         FROM customers f JOIN customers r ON r.id = f.referred_by
         GROUP BY r.id ORDER BY referred DESC, revenue DESC LIMIT 50`,
      )
      .all<{ id: string; name: string; phone: string | null; referral_code: string | null; referred: number; became_customers: number; revenue: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) FILTER (WHERE referred_by IS NOT NULL) AS linked,
           COUNT(*) FILTER (WHERE referred_by IS NULL AND source = 'referral') AS said_friend
         FROM customers`,
      )
      .first<{ linked: number; said_friend: number }>(),
    loadSettings(db),
  ]);
  const s = site(c.env);
  return c.json({
    referrerGets: loaded.settings.referrerGets,
    friendGets: loaded.settings.friendGets,
    leaders: leaders.results.map((r) => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      code: r.referral_code,
      link: r.referral_code ? `${s}/?ref=${r.referral_code}` : null,
      referred: Number(r.referred),
      becameCustomers: Number(r.became_customers),
      revenue: Number(r.revenue),
    })),
    linked: Number(totals?.linked ?? 0),
    saidFriend: Number(totals?.said_friend ?? 0),
    site: s,
  });
});

/** One customer's referral link, making their code if they don't have one yet. */
campaigns.get('/referrals/:customerId', async (c) => {
  const id = c.req.param('customerId');
  await fillReferralCodes(c.env.DB, [id]);
  const row = await c.env.DB.prepare('SELECT id, name, phone, referral_code FROM customers WHERE id = ?').bind(id).first<{ id: string; name: string; phone: string | null; referral_code: string }>();
  if (!row) throw new ApiError(404, 'not_found', 'No customer with that ID.');
  return c.json({ id: row.id, name: row.name, phone: row.phone, code: row.referral_code, link: `${site(c.env)}/?ref=${row.referral_code}` });
});

/* ------------------------------------------------------------ reviews */

/** Chicago calendar date, `days` from today. */
const chicagoDate = (days = 0, at = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at.getTime() + days * 864e5));

/**
 * Who to ask for a review: each customer's latest finished job in the last
 * 60 days, unless they were asked in the past year (by anyone: the Follow-ups
 * list logs its asks too) or the job's review follow-up is already done.
 */
campaigns.get('/reviews', async (c) => {
  const db = c.env.DB;
  const yearAgo = new Date(Date.now() - 365 * 864e5).toISOString();
  const [toAsk, asked, loaded, pricing] = await Promise.all([
    db
      .prepare(
        `SELECT j.id AS job_id, j.local_date, j.service, c.id AS customer_id, c.name, c.phone, c.text_ok,
           EXISTS (SELECT 1 FROM follow_ups f WHERE f.job_id = j.id AND f.kind = 'review' AND f.status = 'open') AS on_today
         FROM jobs j JOIN customers c ON c.id = j.customer_id
         WHERE j.status = 'done' AND j.local_date >= ?1 AND j.local_date <= ?2
           AND j.id = (SELECT j2.id FROM jobs j2 WHERE j2.customer_id = j.customer_id AND j2.status = 'done' ORDER BY j2.start_at DESC LIMIT 1)
           AND NOT EXISTS (SELECT 1 FROM activities a WHERE a.customer_id = c.id AND a.kind = 'review_request' AND a.created_at >= ?3)
           AND NOT EXISTS (SELECT 1 FROM follow_ups f WHERE f.job_id = j.id AND f.kind = 'review' AND f.status IN ('done', 'sent'))
         ORDER BY j.start_at DESC LIMIT 60`,
      )
      .bind(chicagoDate(-60), chicagoDate(), yearAgo)
      .all<{ job_id: string; local_date: string; service: string; customer_id: string; name: string; phone: string | null; text_ok: number; on_today: number }>(),
    db
      .prepare(
        `SELECT a.created_at, c.name FROM activities a LEFT JOIN customers c ON c.id = a.customer_id
         WHERE a.kind = 'review_request' ORDER BY a.created_at DESC LIMIT 10`,
      )
      .all<{ created_at: string; name: string | null }>(),
    loadSettings(db),
    currentPricing(db),
  ]);
  const names = new Map(pricing.config.services.map((s) => [s.id, s.name] as [string, string]));
  return c.json({
    reviewUrl: loaded.settings.reviewUrl,
    siteReviewUrl: loaded.siteReviewUrl,
    toAsk: toAsk.results.map((r) => ({
      jobId: r.job_id,
      customerId: r.customer_id,
      name: r.name,
      phone: r.text_ok ? r.phone : null,
      date: r.local_date,
      service: names.get(r.service) ?? r.service,
      onToday: !!r.on_today,
    })),
    recent: asked.results.map((r) => ({ name: r.name, at: r.created_at })),
  });
});

/** He asked for a review (by text or in person): { jobId, how?: 'text' | 'in_person' }. */
campaigns.post('/reviews/asked', async (c) => {
  const body = await json(c.req.raw);
  const jobId = text(body.jobId, 'Job', 40);
  const job = jobId ? await c.env.DB.prepare('SELECT id, customer_id FROM jobs WHERE id = ?').bind(jobId).first<{ id: string; customer_id: string }>() : null;
  if (!job) throw new ApiError(404, 'not_found', 'No job with that ID.');
  const how = body.how === 'in_person' ? 'in_person' : 'text';
  await logActivity(c.env.DB, {
    customerId: job.customer_id,
    jobId: job.id,
    kind: 'review_request',
    body: how === 'text' ? 'Asked for a review by text.' : 'Asked for a review in person.',
    meta: { how, from: 'marketing' },
    by: who(c),
  });
  return c.json({ ok: true });
});

/* ------------------------------------------------------------ playbook */

interface ChecklistItem {
  key: string;
  title: string;
  text: string;
  /** How often it's worth doing. A weekly item counts as done for 7 days. */
  every: 'once' | 'week' | 'month';
}

export const CHECKLIST: ChecklistItem[] = [
  { key: 'gbp-post', every: 'week', title: 'Post on your Google Business Profile', text: 'One photo from this week and a line with the town, like "Ceramic coat in Arnold today." Profiles that post show up higher in Google Maps.' },
  { key: 'photos', every: 'week', title: 'Before and after photos at every job', text: 'Same angle, before and after. Put the best on Google, Instagram and the Recent work row on your website.' },
  { key: 'reply-reviews', every: 'week', title: 'Answer every review', text: 'Thank them by name and say what you did ("Glad the Tahoe came out great"). Google and new customers both read your answers.' },
  { key: 'gbp-complete', every: 'once', title: 'Fill in your whole Google profile', text: 'Every service, your service area towns, hours, 20+ photos, and "mobile, we come to you" in the description.' },
  { key: 'free-listings', every: 'once', title: 'Claim your free listings', text: 'Apple Business Connect (shows in Apple Maps on iPhones), Bing Places, Yelp and Nextdoor. Same name, phone and website on all of them.' },
  { key: 'van', every: 'once', title: 'Letter the van', text: 'Name, phone number and website big enough to read from across a street, plus a QR magnet from Links & QR codes. It works at every job you do.' },
  { key: 'cards', every: 'once', title: 'Leave two cards at every job', text: 'One for them and one to pass on. Put the referral offer on the back so they have a reason to.' },
  { key: 'nextdoor', every: 'month', title: 'Post on Nextdoor', text: 'A before and after in your best ZIPs, and ask happy customers to recommend you there. Neighbors trust neighbors.' },
  { key: 'facebook-groups', every: 'month', title: 'Post in local Facebook groups', text: 'Town groups for High Ridge, House Springs, Fenton and Arnold. A photo and "I come to you" does better than an ad. Check each group\'s rules first.' },
  { key: 'dealers', every: 'once', title: 'Talk to two used car dealers', text: 'Small lots on Gravois and in Fenton need cars cleaned before they sell. Offer a flat price per car. Steady weekday work.' },
  { key: 'marina', every: 'once', title: 'Ask a marina about a boat day', text: 'Alton Marina, Grafton Harbor or a Lake of the Ozarks marina. Offer a spring on-site day: owners book slots, you detail boats right at the dock.' },
  { key: 'apartments', every: 'once', title: 'Pitch an apartment complex', text: 'Ask the office for a monthly on-site day in their lot. Residents book ahead, you do 4 to 6 cars in one trip and never drive between jobs.' },
  { key: 'offices', every: 'once', title: 'Pitch an office park', text: 'Detail cars while people work. Ask HR or the building manager. One stop, several cars, and they tell coworkers.' },
  { key: 'car-meets', every: 'month', title: 'Go to a Cars and Coffee', text: 'Bring cards and a phone full of before and afters. Car people pay for ceramic and paint correction.' },
];

interface Season {
  key: string;
  months: number[];
  title: string;
  text: string;
  template?: string;
}

const SEASONS: Season[] = [
  { key: 'boats', months: [3, 4, 5], title: 'Boat season', text: 'Boats go in the water in April and May. Text past boat customers in March, and post boat photos on Facebook.', template: 'spring-boats' },
  { key: 'spring', months: [4, 5], title: 'Spring clean', text: "Pollen and winter grime. People who skipped winter want their car back. Ask anyone you haven't seen since fall.", template: 'miss-you' },
  { key: 'summer', months: [6, 7, 8], title: 'Summer', text: 'Road trips, pool days and pets. Push interiors and boats. Book early mornings so you finish before the heat.' },
  { key: 'fall', months: [9, 10], title: 'Coat it before winter', text: 'Fall is the time for ceramic and sealants, before the salt. Ask your Level III customers first.', template: 'ceramic-upsell' },
  { key: 'gifts', months: [11, 12], title: 'Holiday gift cards', text: 'A detail is an easy gift. Email your customers in mid-November and again two weeks before Christmas.', template: 'holiday-gift' },
  { key: 'salt', months: [12, 1, 2, 3], title: 'Salt removal', text: 'Salt eats paint and the underside of cars. After each snow, send a salt wash message to past customers.', template: 'winter-salt' },
];

/** Towns around High Ridge, so the playbook can point at nearby ZIPs he hasn't worked yet. */
const NEARBY: Record<string, string> = {
  '63049': 'High Ridge',
  '63051': 'House Springs',
  '63026': 'Fenton',
  '63010': 'Arnold',
  '63052': 'Imperial',
  '63088': 'Valley Park',
  '63021': 'Ballwin',
  '63011': 'Ballwin',
  '63025': 'Eureka',
  '63129': 'Oakville',
  '63128': 'Sappington',
  '63127': 'Sunset Hills',
  '63122': 'Kirkwood',
  '63123': 'Affton',
  '63012': 'Barnhart',
};

interface ChannelAdvice {
  source: string;
  name: string;
  tryIt: string;
}

const CHANNELS: ChannelAdvice[] = [
  { source: 'maps', name: 'Google Maps', tryIt: 'Your Google profile is the cheapest customer you will get. Post every week and ask every customer for a review.' },
  { source: 'google', name: 'Google search', tryIt: 'People searching "mobile detailing near me" find your website. Reviews and a full Google profile move you up.' },
  { source: 'instagram', name: 'Instagram', tryIt: 'Post a short before and after video after good jobs, and put your Instagram tracking link in your bio.' },
  { source: 'facebook', name: 'Facebook', tryIt: 'Post before and afters in town groups (High Ridge, Fenton, Arnold, House Springs) and on your page.' },
  { source: 'nextdoor', name: 'Nextdoor', tryIt: 'A business page is free. Post in your best ZIPs and ask 3 happy customers to recommend you on it.' },
  { source: 'referral', name: 'Referrals', tryIt: 'Send your best customers their referral link, and leave two cards at every job.' },
  { source: 'van', name: 'The van and signs', tryIt: 'Letter the van and add a QR magnet. Door hangers on the street after each job work too.' },
];

/** "4410 Laclede Ave, St. Louis" → "Laclede Ave". Null when there's no house number. */
export function streetOf(address: string): string | null {
  const first = address.split(',')[0]!.trim().replace(/\s+(apt|unit|suite|ste|#)\s*\S*$/i, '');
  const m = first.match(/^\d+[a-z]?\s+(.+)$/i);
  if (!m) return null;
  const SUFFIX: Record<string, string> = { street: 'St', avenue: 'Ave', road: 'Rd', drive: 'Dr', lane: 'Ln', court: 'Ct', boulevard: 'Blvd', place: 'Pl', circle: 'Cir', parkway: 'Pkwy', terrace: 'Ter' };
  const words = m[1]!.replace(/\./g, '').split(/\s+/).filter(Boolean);
  const last = words.length - 1;
  return words
    .map((w, i) => {
      const lower = w.toLowerCase();
      if (i === last && SUFFIX[lower]) return SUFFIX[lower];
      if (/^(n|s|e|w|ne|nw|se|sw)$/i.test(w)) return w.toUpperCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

const isDone = (item: ChecklistItem, doneAt: string | undefined, at: Date) => {
  if (!doneAt) return false;
  if (item.every === 'once') return true;
  const age = (at.getTime() - new Date(doneAt).getTime()) / 864e5;
  return age < (item.every === 'week' ? 7 : 31);
};

campaigns.get('/playbook', async (c) => {
  const db = c.env.DB;
  const at = new Date();
  const since = chicagoDate(-730, at);
  const yearAgo = new Date(at.getTime() - 365 * 864e5).toISOString();
  const [zips, jobs, sources, links, loaded] = await Promise.all([
    db
      .prepare(
        `SELECT j.zip, COUNT(*) AS jobs, COUNT(DISTINCT j.customer_id) AS customers, SUM(${VALUE}) AS revenue
         FROM jobs j WHERE j.status = 'done' AND j.zip IS NOT NULL AND j.zip != '' AND j.local_date >= ?
         GROUP BY j.zip ORDER BY jobs DESC, revenue DESC`,
      )
      .bind(since)
      .all<{ zip: string; jobs: number; customers: number; revenue: number }>(),
    db
      .prepare("SELECT address, zip, customer_id, local_date FROM jobs WHERE status = 'done' AND local_date >= ? ORDER BY local_date DESC LIMIT 5000")
      .bind(since)
      .all<{ address: string; zip: string | null; customer_id: string; local_date: string }>(),
    db
      .prepare(
        `SELECT COALESCE(c.source, '') AS source, COUNT(*) AS people,
           COUNT(*) FILTER (WHERE c.created_at >= ?1) AS recent,
           SUM(EXISTS (SELECT 1 FROM jobs j WHERE j.customer_id = c.id AND j.status != 'cancelled')) AS booked
         FROM customers c GROUP BY 1`,
      )
      .bind(yearAgo)
      .all<{ source: string; people: number; recent: number; booked: number }>(),
    db.prepare('SELECT channel, COUNT(*) AS n FROM tracked_links GROUP BY channel').all<{ channel: string; n: number }>(),
    loadSettings(db),
  ]);

  const totalJobs = zips.results.reduce((s, z) => s + Number(z.jobs), 0);
  const topZips = zips.results.slice(0, 6).map((z) => ({
    zip: z.zip,
    town: NEARBY[z.zip] ?? null,
    jobs: Number(z.jobs),
    customers: Number(z.customers),
    revenue: Number(z.revenue),
    share: totalJobs ? Math.round((Number(z.jobs) / totalJobs) * 100) : 0,
  }));
  const worked = new Map(zips.results.map((z) => [z.zip, Number(z.jobs)]));
  const nearbyOpen = Object.entries(NEARBY)
    .filter(([zip]) => (worked.get(zip) ?? 0) <= 1)
    .map(([zip, town]) => ({ zip, town, jobs: worked.get(zip) ?? 0 }));

  const streets = new Map<string, { street: string; zip: string | null; jobs: number; customers: Set<string>; last: string }>();
  for (const j of jobs.results) {
    const street = streetOf(j.address);
    if (!street) continue;
    const key = `${street}|${j.zip ?? ''}`;
    const s = streets.get(key) ?? { street, zip: j.zip, jobs: 0, customers: new Set<string>(), last: j.local_date };
    s.jobs++;
    s.customers.add(j.customer_id);
    if (j.local_date > s.last) s.last = j.local_date;
    streets.set(key, s);
  }
  const topStreets = [...streets.values()]
    .filter((s) => s.jobs >= 2)
    .sort((a, b) => b.jobs - a.jobs || b.last.localeCompare(a.last))
    .slice(0, 8)
    .map((s) => ({ street: s.street, zip: s.zip, town: s.zip ? NEARBY[s.zip] ?? null : null, jobs: s.jobs, customers: s.customers.size, last: s.last }));

  const bySource = new Map(sources.results.map((s) => [s.source, s]));
  // Print pieces count with the van: people who see them in person.
  const group = (ch: string) => (['door-hangers', 'flyers', 'cards'].includes(ch) ? 'van' : ch);
  const linkChannels = new Map<string, number>();
  for (const l of links.results) linkChannels.set(group(l.channel), (linkChannels.get(group(l.channel)) ?? 0) + Number(l.n));
  const channels = CHANNELS.map((ch) => {
    const s = bySource.get(ch.source);
    const people = Number(s?.people ?? 0);
    const booked = Number(s?.booked ?? 0);
    return {
      source: ch.source,
      name: ch.name,
      people,
      recent: Number(s?.recent ?? 0),
      booked,
      state: people === 0 ? 'untried' : booked === 0 ? 'no-bookings' : 'working',
      tryIt: ch.tryIt,
      links: linkChannels.get(ch.source) ?? 0,
    };
  }).sort((a, b) => ({ untried: 0, 'no-bookings': 1, working: 2 })[a.state]! - ({ untried: 0, 'no-bookings': 1, working: 2 })[b.state]! || b.people - a.people);

  const month = Number(chicagoDate(0, at).slice(5, 7));
  const nextMonth = (month % 12) + 1;
  const seasons = SEASONS.filter((s) => s.months.includes(month) || s.months.includes(nextMonth)).map((s) => ({
    ...s,
    now: s.months.includes(month),
  }));

  return c.json({
    month,
    zips: topZips,
    nearbyOpen,
    streets: topStreets,
    channels,
    seasons,
    checklist: CHECKLIST.map((item) => ({
      ...item,
      doneAt: loaded.settings.done[item.key] ?? null,
      done: isDone(item, loaded.settings.done[item.key], at),
    })),
  });
});

/** Tick or untick a checklist item: { key, done }. */
campaigns.post('/playbook/done', async (c) => {
  const body = await json(c.req.raw);
  const item = CHECKLIST.find((x) => x.key === body.key);
  if (!item) throw new ApiError(422, 'invalid', 'No checklist item with that name.');
  const { settings } = await loadSettings(c.env.DB);
  if (body.done === false) delete settings.done[item.key];
  else settings.done[item.key] = now();
  await saveSettings(c.env.DB, settings, who(c));
  return c.json({ key: item.key, doneAt: settings.done[item.key] ?? null, done: isDone(item, settings.done[item.key], new Date()) });
});

/* ------------------------------------------------------------ one campaign */

campaigns.get('/:id', async (c) => c.json(await getCampaign(c.env.DB, c.req.param('id'))));

campaigns.patch('/:id', async (c) => {
  const f = readCampaign(await json(c.req.raw), true);
  const sets = Object.entries(f).filter(([, v]) => v !== undefined);
  if (sets.length) {
    const row = await c.env.DB.prepare(
      `UPDATE campaigns SET ${sets.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ? AND status = 'draft' RETURNING id`,
    )
      .bind(...sets.map(([, v]) => v), now(), c.req.param('id'))
      .first();
    if (!row) {
      await getCampaign(c.env.DB, c.req.param('id')); // 404 if missing
      throw new ApiError(409, 'already_sent', "This one has already gone out, so it can't be changed. Copy it into a new one instead.");
    }
  }
  return c.json(await getCampaign(c.env.DB, c.req.param('id')));
});

campaigns.delete('/:id', async (c) => {
  const row = await c.env.DB.prepare("DELETE FROM campaigns WHERE id = ? AND status = 'draft' RETURNING id").bind(c.req.param('id')).first();
  if (!row) {
    await getCampaign(c.env.DB, c.req.param('id'));
    throw new ApiError(409, 'already_sent', "This one has already gone out, so it stays in the list.");
  }
  return c.body(null, 204);
});

/**
 * Freezes who gets it: one row per person in the segment, queued if they can
 * get it on this channel, skipped (with why) if not. Set-based, whatever the
 * size. Returns false if it had already started.
 */
async function startCampaign(env: Bindings, camp: CampaignRow): Promise<boolean> {
  const db = env.DB;
  const started = await db
    .prepare("UPDATE campaigns SET status = 'sending', sent_at = ?, updated_at = ? WHERE id = ? AND status = 'draft' RETURNING id")
    .bind(now(), now(), camp.id)
    .first();
  if (!started) return false;
  const people = await segmentCustomers(db, storedSegment(camp.segment));
  const rows = people.map((p) => {
    const why =
      camp.channel === 'email'
        ? !p.email ? 'no_email' : !p.emailOk ? 'unsubscribed' : null
        : !p.phone ? 'no_phone' : !p.textOk ? 'no_texts' : null;
    return { id: p.id, status: why ? 'skipped' : 'queued', error: why };
  });
  const queued = rows.filter((r) => r.status === 'queued').map((r) => r.id);
  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT OR IGNORE INTO campaign_sends (campaign_id, customer_id, status, error)
         SELECT ?1, json_extract(value, '$.id'), json_extract(value, '$.status'), json_extract(value, '$.error') FROM json_each(?2)`,
      )
      .bind(camp.id, JSON.stringify(rows)),
  ];
  // Unsubscribe links, made now in one go, so each send is a lookup (see crm-email.ts).
  if (camp.channel === 'email') {
    stmts.push(
      db
        .prepare('UPDATE customers SET unsubscribe_token = lower(hex(randomblob(24))) WHERE unsubscribe_token IS NULL AND id IN (SELECT value FROM json_each(?))')
        .bind(JSON.stringify(queued)),
    );
  }
  await db.batch(stmts);
  if (needs([camp.subject, camp.body], 'referral link')) {
    await fillReferralCodes(db, people.filter((p) => !p.referralCode && queued.includes(p.id)).map((p) => p.id));
  }
  return true;
}

async function campaignRow(db: D1Database, id: string) {
  const row = await db.prepare('SELECT * FROM campaigns WHERE id = ?').bind(id).first<CampaignRow>();
  if (!row) throw new ApiError(404, 'not_found', 'No campaign with that ID.');
  return row;
}

/** The people on a campaign's list, with their details for rendering. One query. */
function peopleQuery(db: D1Database, campaignId: string, customerIds?: string[]) {
  return db
    .prepare(
      `SELECT s.customer_id, s.status, s.error, s.sent_at, c.name, c.phone, c.email, c.referral_code,
         (SELECT l.service FROM jobs l WHERE l.customer_id = c.id AND l.status = 'done' ORDER BY l.start_at DESC LIMIT 1) AS last_service
       FROM campaign_sends s JOIN customers c ON c.id = s.customer_id
       WHERE s.campaign_id = ?1 ${customerIds ? 'AND s.customer_id IN (SELECT value FROM json_each(?2))' : ''}
       ORDER BY s.status = 'queued' DESC, lower(c.name)`,
    )
    .bind(...(customerIds ? [campaignId, JSON.stringify(customerIds)] : [campaignId]));
}

interface SendPerson {
  customer_id: string;
  status: string;
  error: string | null;
  sent_at: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  referral_code: string | null;
  last_service: string | null;
}

const asPerson = (r: SendPerson): Person => ({ name: r.name, referralCode: r.referral_code, lastService: r.last_service });

async function emailsToday(db: D1Database) {
  const midnight = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
  const row = await db.prepare("SELECT COUNT(*) AS n FROM activities WHERE kind = 'email' AND created_at >= ?").bind(midnight).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

export interface BatchResult {
  sent: number;
  failed: number;
  skipped: number;
  /** Nothing more can go today (Resend's daily limit). */
  dailyLimit: boolean;
  emailsLeftToday: number;
}

/**
 * Sends the next batch of a started email campaign. Rows are claimed first
 * (a claim mark in `error`, stale after 5 minutes), so two requests at once
 * can't email the same person twice.
 */
export async function sendBatch(env: Bindings, camp: CampaignRow, size = BATCH): Promise<BatchResult> {
  const db = env.DB;
  const out: BatchResult = { sent: 0, failed: 0, skipped: 0, dailyLimit: false, emailsLeftToday: 0 };
  const left = Math.max(0, DAILY_EMAILS - (await emailsToday(db)));
  out.emailsLeftToday = left;
  if (!left) return { ...out, dailyLimit: true };

  const claim = `claim:${now()}`;
  const stale = `claim:${new Date(Date.now() - 5 * 60e3).toISOString()}`;
  const { results: claimed } = await db
    .prepare(
      `UPDATE campaign_sends SET error = ?1 WHERE campaign_id = ?2 AND rowid IN (
         SELECT rowid FROM campaign_sends WHERE campaign_id = ?2 AND status = 'queued' AND (error IS NULL OR error < ?3)
         ORDER BY rowid LIMIT ?4) RETURNING customer_id`,
    )
    .bind(claim, camp.id, stale, Math.min(size, left))
    .all<{ customer_id: string }>();
  if (!claimed.length) return out;

  const [{ results: people }, ctx, brand] = await Promise.all([
    peopleQuery(db, camp.id, claimed.map((r) => r.customer_id)).all<SendPerson>(),
    renderCtx(env, [camp.subject, camp.body], 'email', camp.name),
    getBrand(env),
  ]);
  const results: { id: string; status: string; error: string | null; at: string | null }[] = [];
  let last = 0;
  for (const p of people) {
    const wait = last + SEND_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    const r: MarketingResult = await sendMarketingEmail(env, p.customer_id, {
      subject: render(camp.subject ?? camp.name, asPerson(p), ctx),
      text: render(camp.body, asPerson(p), ctx),
      meta: { campaignId: camp.id },
      brand,
    });
    if (r === 'sent') out.sent++;
    else if (r === 'failed') out.failed++;
    else if (r !== 'not_configured') out.skipped++;
    results.push(
      r === 'sent'
        ? { id: p.customer_id, status: 'sent', error: null, at: now() }
        : r === 'failed'
          ? { id: p.customer_id, status: 'failed', error: 'failed', at: null }
          : r === 'not_configured'
            ? { id: p.customer_id, status: 'queued', error: null, at: null }
            : { id: p.customer_id, status: 'skipped', error: r, at: null },
    );
  }
  await db.batch([
    db
      .prepare(
        `UPDATE campaign_sends SET status = json_extract(r.value, '$.status'), error = json_extract(r.value, '$.error'),
           sent_at = json_extract(r.value, '$.at')
         FROM json_each(?2) r WHERE campaign_sends.campaign_id = ?1 AND campaign_sends.customer_id = json_extract(r.value, '$.id')`,
      )
      .bind(camp.id, JSON.stringify(results)),
    finishStatement(db, camp.id),
  ]);
  out.emailsLeftToday = Math.max(0, left - out.sent);
  return out;
}

/** Marks a campaign sent once nobody is left in its queue. */
const finishStatement = (db: D1Database, id: string) =>
  db
    .prepare(
      `UPDATE campaigns SET status = 'sent', updated_at = ?2 WHERE id = ?1 AND status = 'sending'
         AND NOT EXISTS (SELECT 1 FROM campaign_sends WHERE campaign_id = ?1 AND status = 'queued')`,
    )
    .bind(id, now());

/**
 * Start a campaign, or send its next email batch. Email: queues everyone the
 * first time, then sends up to BATCH per call; call again while
 * `campaign.stats.queued` > 0. Text: makes the list to work through.
 */
campaigns.post('/:id/send', async (c) => {
  let camp = await campaignRow(c.env.DB, c.req.param('id'));
  let size = BATCH;
  if (camp.channel === 'email' && !c.env.RESEND_API_KEY) {
    throw new ApiError(409, 'email_not_set_up', "Email isn't set up yet, so nothing was sent. Brett needs to add the email key. You can send this one as a text list instead.");
  }
  if (camp.status === 'draft') {
    await startCampaign(c.env, camp);
    camp = await campaignRow(c.env.DB, camp.id);
    size = BATCH - 4; // queueing used about a dozen queries of this request's 50
  }
  let batch: BatchResult | null = null;
  if (camp.channel === 'email' && camp.status === 'sending') batch = await sendBatch(c.env, camp, size);
  if (camp.channel === 'text') await c.env.DB.batch([finishStatement(c.env.DB, camp.id)]);
  return c.json({ campaign: await getCampaign(c.env.DB, camp.id), batch });
});

/** Put failed emails back in the queue to try again. */
campaigns.post('/:id/retry', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE campaign_sends SET status = 'queued', error = NULL WHERE campaign_id = ? AND status = 'failed'").bind(id),
    c.env.DB.prepare("UPDATE campaigns SET status = 'sending', updated_at = ? WHERE id = ? AND status = 'sent' AND EXISTS (SELECT 1 FROM campaign_sends WHERE campaign_id = ? AND status = 'queued')").bind(now(), id, id),
  ]);
  return c.json(await getCampaign(c.env.DB, id));
});

/** Everyone on a started campaign, with the text to send each (text campaigns). */
campaigns.get('/:id/people', async (c) => {
  const camp = await campaignRow(c.env.DB, c.req.param('id'));
  const [{ results }, ctx] = await Promise.all([
    peopleQuery(c.env.DB, camp.id).all<SendPerson>(),
    renderCtx(c.env, [camp.subject, camp.body], camp.channel, camp.name),
  ]);
  return c.json({
    people: results.map((r) => ({
      customerId: r.customer_id,
      name: r.name,
      phone: r.phone,
      email: r.email,
      status: r.status,
      reason: r.error?.startsWith('claim:') ? null : r.error,
      sentAt: r.sent_at,
      message: camp.channel === 'text' ? render(camp.body, asPerson(r), ctx) : null,
    })),
  });
});

/**
 * Text campaigns: Jacob sent (or un-sent) one from his phone.
 * { customerId, texted?: boolean, message? } — the message goes on their timeline.
 */
campaigns.post('/:id/texted', async (c) => {
  const id = c.req.param('id');
  const body = await json(c.req.raw);
  const customerId = text(body.customerId, 'Customer', 40);
  if (!customerId) throw new ApiError(422, 'invalid', 'Which customer?');
  const db = c.env.DB;
  if (body.texted === false) {
    await db.batch([
      db.prepare("UPDATE campaign_sends SET status = 'queued', sent_at = NULL WHERE campaign_id = ? AND customer_id = ? AND status = 'sent'").bind(id, customerId),
      db.prepare("UPDATE campaigns SET status = 'sending', updated_at = ? WHERE id = ? AND status = 'sent' AND channel = 'text'").bind(now(), id),
    ]);
  } else {
    const row = await db
      .prepare(
        `UPDATE campaign_sends SET status = 'sent', sent_at = ?, error = NULL
         WHERE campaign_id = ? AND customer_id = ? AND status = 'queued'
           AND EXISTS (SELECT 1 FROM campaigns WHERE id = campaign_sends.campaign_id AND channel = 'text') RETURNING customer_id`,
      )
      .bind(now(), id, customerId)
      .first();
    if (row) {
      const message = text(body.message, 'Message', 2000);
      await db.batch([
        activityStatement(db, { customerId, kind: 'text', body: message ?? null, meta: { campaignId: id }, by: who(c) }),
        finishStatement(db, id),
      ]);
    }
  }
  return c.json(await getCampaign(db, id));
});

/**
 * Cron: the next batch of the oldest email campaign still sending. For the
 * daily trigger in index.ts (a scheduled run has the same 50-query cap).
 */
export async function runCampaigns(env: Bindings) {
  if (!env.RESEND_API_KEY) return null;
  const camp = await env.DB.prepare(
    `SELECT c.* FROM campaigns c WHERE c.status = 'sending' AND c.channel = 'email'
       AND EXISTS (SELECT 1 FROM campaign_sends s WHERE s.campaign_id = c.id AND s.status = 'queued')
     ORDER BY c.sent_at LIMIT 1`,
  ).first<CampaignRow>();
  return camp ? sendBatch(env, camp) : null;
}
