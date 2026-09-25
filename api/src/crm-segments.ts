import { ApiError } from './lib.ts';

/**
 * Who's who: every customer with their numbers (visits, spend, last and next
 * visit), filtered by a Segment. One query, whatever the filter, so the free
 * plan's 50-queries-per-request cap is never at risk. Used by the customer
 * list, campaigns (who gets it) and insights. See docs/crm.md.
 *
 * A job's value is its final price when Jacob set one, else the quoted total.
 * Only done jobs count as visits and spend; imported history counts too.
 */

export interface Segment {
  /** Name, phone digits or email. */
  q?: string;
  /** lead: never had a job; customer: at least one done job; repeat: 2+; lapsed: done jobs, none upcoming, last one over `lapsedDays` ago. */
  lifecycle?: 'any' | 'lead' | 'customer' | 'repeat' | 'lapsed';
  lapsedDays?: number;
  minSpend?: number; // cents
  maxSpend?: number;
  minVisits?: number;
  maxVisits?: number;
  /** YYYY-MM-DD, compared with the last done visit's date. */
  lastVisitBefore?: string;
  lastVisitAfter?: string;
  /** Has nothing booked from today on. */
  noUpcoming?: boolean;
  /** Ever had one of these service ids done. */
  services?: string[];
  /** ZIP prefixes ("631" matches 63129), against their latest job's ZIP. */
  zips?: string[];
  sources?: string[];
  /** Has any of these tags. */
  tags?: string[];
  canEmail?: boolean;
  canText?: boolean;
  sort?: 'spend' | 'recent' | 'visits' | 'name' | 'newest';
  limit?: number;
}

export interface CustomerStats {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  source: string | null;
  tags: string[];
  emailOk: boolean;
  textOk: boolean;
  referralCode: string | null;
  referredBy: string | null;
  createdAt: string;
  visits: number;
  spend: number; // cents
  avgTicket: number | null;
  firstVisit: string | null; // YYYY-MM-DD
  lastVisit: string | null;
  lastService: string | null;
  nextVisit: string | null; // ISO start of the next booked job
  services: string[];
  zip: string | null;
  referrals: number; // customers who came from their code
}

/** The per-customer numbers, as a CTE other queries can join (see crm-insights.ts). */
export const STATS_CTE = `
  job_value AS (
    SELECT j.*, COALESCE(j.final_price, CAST(json_extract(j.quote, '$.total') AS INTEGER), 0) AS value
    FROM jobs j
  ),
  stats AS (
    SELECT c.id AS customer_id,
      COUNT(v.id) FILTER (WHERE v.status = 'done') AS visits,
      COALESCE(SUM(v.value) FILTER (WHERE v.status = 'done'), 0) AS spend,
      MIN(v.local_date) FILTER (WHERE v.status = 'done') AS first_visit,
      MAX(v.local_date) FILTER (WHERE v.status = 'done') AS last_visit,
      MIN(v.start_at) FILTER (WHERE v.status IN ('scheduled', 'in_progress') AND v.start_at >= ?1) AS next_visit,
      (SELECT json_group_array(DISTINCT s.service) FROM jobs s WHERE s.customer_id = c.id AND s.status = 'done') AS services,
      (SELECT l.service FROM jobs l WHERE l.customer_id = c.id AND l.status = 'done' ORDER BY l.start_at DESC LIMIT 1) AS last_service,
      (SELECT z.zip FROM jobs z WHERE z.customer_id = c.id AND z.zip IS NOT NULL ORDER BY z.start_at DESC LIMIT 1) AS zip,
      (SELECT COUNT(*) FROM customers r WHERE r.referred_by = c.id) AS referrals
    FROM customers c LEFT JOIN job_value v ON v.customer_id = c.id
    GROUP BY c.id
  )`;

const arr = (v: unknown, name: string, max = 50): string[] | undefined => {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.length > max || v.some((x) => typeof x !== 'string' || x.length > 60)) {
    throw new ApiError(422, 'invalid_segment', `${name} must be a list of short words.`);
  }
  return v.length ? (v as string[]) : undefined;
};
const num = (v: unknown, name: string) => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new ApiError(422, 'invalid_segment', `${name} must be a number.`);
  return n;
};
const day = (v: unknown, name: string) => {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new ApiError(422, 'invalid_segment', `${name} must be a date.`);
  return v;
};

/** Validates a segment from a request body or stored campaign. Unknown keys are ignored. */
export function readSegment(raw: unknown): Segment {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const lifecycles = ['any', 'lead', 'customer', 'repeat', 'lapsed'];
  const sorts = ['spend', 'recent', 'visits', 'name', 'newest'];
  if (s.lifecycle !== undefined && !lifecycles.includes(s.lifecycle as string)) throw new ApiError(422, 'invalid_segment', 'Unknown customer type.');
  if (s.sort !== undefined && !sorts.includes(s.sort as string)) throw new ApiError(422, 'invalid_segment', 'Unknown sort.');
  return {
    q: typeof s.q === 'string' && s.q.trim() ? s.q.trim().slice(0, 100) : undefined,
    lifecycle: s.lifecycle as Segment['lifecycle'],
    lapsedDays: num(s.lapsedDays, 'Lapsed days'),
    minSpend: num(s.minSpend, 'Least spent'),
    maxSpend: num(s.maxSpend, 'Most spent'),
    minVisits: num(s.minVisits, 'Fewest visits'),
    maxVisits: num(s.maxVisits, 'Most visits'),
    lastVisitBefore: day(s.lastVisitBefore, 'Last visit before'),
    lastVisitAfter: day(s.lastVisitAfter, 'Last visit after'),
    noUpcoming: s.noUpcoming === true ? true : undefined,
    services: arr(s.services, 'Services'),
    zips: arr(s.zips, 'ZIPs', 200),
    sources: arr(s.sources, 'Sources'),
    tags: arr(s.tags, 'Tags'),
    canEmail: s.canEmail === true ? true : undefined,
    canText: s.canText === true ? true : undefined,
    sort: s.sort as Segment['sort'],
    limit: Math.min(num(s.limit, 'Limit') ?? 500, 2000),
  };
}

/** Customers matching a segment, with their numbers. One query. */
export async function segmentCustomers(db: D1Database, seg: Segment, at = new Date()): Promise<CustomerStats[]> {
  const where: string[] = [];
  const binds: unknown[] = [at.toISOString()]; // ?1 in STATS_CTE
  const bind = (v: unknown) => (binds.push(v), `?${binds.length}`);

  if (seg.q) {
    const digits = seg.q.replace(/\D/g, '');
    const like = bind(`%${seg.q.toLowerCase()}%`);
    where.push(`(lower(c.name) LIKE ${like} OR lower(COALESCE(c.email, '')) LIKE ${like}${digits.length >= 3 ? ` OR c.phone_key LIKE ${bind(`%${digits}%`)}` : ''})`);
  }
  const lapsedBefore = new Date(at.getTime() - (seg.lapsedDays ?? 180) * 864e5).toISOString().slice(0, 10);
  if (seg.lifecycle === 'lead') where.push('s.visits = 0');
  if (seg.lifecycle === 'customer') where.push('s.visits >= 1');
  if (seg.lifecycle === 'repeat') where.push('s.visits >= 2');
  if (seg.lifecycle === 'lapsed') where.push(`s.visits >= 1 AND s.next_visit IS NULL AND s.last_visit < ${bind(lapsedBefore)}`);
  if (seg.minSpend !== undefined) where.push(`s.spend >= ${bind(seg.minSpend)}`);
  if (seg.maxSpend !== undefined) where.push(`s.spend <= ${bind(seg.maxSpend)}`);
  if (seg.minVisits !== undefined) where.push(`s.visits >= ${bind(seg.minVisits)}`);
  if (seg.maxVisits !== undefined) where.push(`s.visits <= ${bind(seg.maxVisits)}`);
  if (seg.lastVisitBefore) where.push(`s.last_visit < ${bind(seg.lastVisitBefore)}`);
  if (seg.lastVisitAfter) where.push(`s.last_visit >= ${bind(seg.lastVisitAfter)}`);
  if (seg.noUpcoming) where.push('s.next_visit IS NULL');
  if (seg.services) where.push(`EXISTS (SELECT 1 FROM json_each(s.services) x WHERE x.value IN (SELECT value FROM json_each(${bind(JSON.stringify(seg.services))})))`);
  if (seg.zips) where.push(`EXISTS (SELECT 1 FROM json_each(${bind(JSON.stringify(seg.zips))}) z WHERE s.zip LIKE z.value || '%')`);
  if (seg.sources) where.push(`c.source IN (SELECT value FROM json_each(${bind(JSON.stringify(seg.sources))}))`);
  if (seg.tags) where.push(`EXISTS (SELECT 1 FROM json_each(c.tags) t WHERE t.value IN (SELECT value FROM json_each(${bind(JSON.stringify(seg.tags))})))`);
  if (seg.canEmail) where.push("c.email IS NOT NULL AND c.email != '' AND c.email_ok = 1");
  if (seg.canText) where.push("c.phone_key IS NOT NULL AND c.text_ok = 1");

  const order = {
    spend: 's.spend DESC, s.visits DESC',
    recent: 'COALESCE(s.last_visit, substr(c.created_at, 1, 10)) DESC',
    visits: 's.visits DESC, s.spend DESC',
    name: 'lower(c.name)',
    newest: 'c.id DESC',
  }[seg.sort ?? 'newest'];

  const { results } = await db
    .prepare(
      `WITH ${STATS_CTE}
       SELECT c.*, s.* FROM customers c JOIN stats s ON s.customer_id = c.id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY ${order} LIMIT ${bind(seg.limit ?? 500)}`,
    )
    .bind(...binds)
    .all<Record<string, unknown>>();

  return results.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    phone: r.phone as string | null,
    email: r.email as string | null,
    address: r.address as string | null,
    source: r.source as string | null,
    tags: JSON.parse((r.tags as string) || '[]') as string[],
    emailOk: r.email_ok !== 0,
    textOk: r.text_ok !== 0,
    referralCode: r.referral_code as string | null,
    referredBy: r.referred_by as string | null,
    createdAt: r.created_at as string,
    visits: Number(r.visits),
    spend: Number(r.spend),
    avgTicket: Number(r.visits) ? Math.round(Number(r.spend) / Number(r.visits)) : null,
    firstVisit: r.first_visit as string | null,
    lastVisit: r.last_visit as string | null,
    lastService: r.last_service as string | null,
    nextVisit: r.next_visit as string | null,
    services: (JSON.parse((r.services as string) || '[]') as (string | null)[]).filter((x): x is string => !!x),
    zip: r.zip as string | null,
    referrals: Number(r.referrals),
  }));
}
