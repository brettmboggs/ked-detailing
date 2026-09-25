import { text } from './lib.ts';

/**
 * Where a lead or customer came from. The customer picks `source` on /quote
 * ("How did you hear about us?"); the page also sends what the browser saw on
 * their first visit (UTM tags, the referring site, the landing page, a
 * referral code from ?ref=). Everything is optional and cleaned here, so a
 * missing or odd value never blocks a booking.
 */
export const SOURCES = [
  'google', // Google search
  'maps', // Google Maps / the Business Profile
  'instagram',
  'facebook',
  'nextdoor',
  'referral', // a friend or family member
  'van', // saw the van or a sign
  'repeat', // been a customer before
  'other',
] as const;
export type Source = (typeof SOURCES)[number];

export interface Attribution {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  referrer?: string; // host only, e.g. www.google.com
  landing?: string; // path only
  firstSeen?: string; // ISO date of the first visit
  ref?: string; // a customer's referral code
}

export interface Touch {
  source: Source | null;
  sourceDetail: string | null;
  attribution: Attribution | null;
}

const short = (v: unknown, max: number) => {
  const s = typeof v === 'string' ? v.trim().slice(0, max) : '';
  return s || undefined;
};

/** Reads `source`, `sourceDetail` and `attribution` from a request body. Never throws on shape. */
export function readTouch(body: Record<string, unknown>): Touch {
  const raw = typeof body.source === 'string' ? body.source.trim().toLowerCase() : '';
  const a = body.attribution && typeof body.attribution === 'object' ? (body.attribution as Record<string, unknown>) : {};
  const attribution: Attribution = {
    utmSource: short(a.utmSource, 60),
    utmMedium: short(a.utmMedium, 60),
    utmCampaign: short(a.utmCampaign, 100),
    referrer: short(a.referrer, 120)?.replace(/^https?:\/\//, '').split('/')[0],
    landing: short(a.landing, 200)?.split('?')[0],
    firstSeen: short(a.firstSeen, 30),
    ref: short(a.ref, 24)?.toUpperCase().replace(/[^A-Z0-9]/g, ''),
  };
  for (const k of Object.keys(attribution) as (keyof Attribution)[]) if (!attribution[k]) delete attribution[k];
  const picked = (SOURCES as readonly string[]).includes(raw) ? (raw as Source) : null;
  return {
    source: picked ?? inferSource(attribution),
    sourceDetail: text(body.sourceDetail, 'Where you heard about us', 120) ?? null,
    attribution: Object.keys(attribution).length ? attribution : null,
  };
}

/** A best guess when the customer didn't say: a referral code, UTM tags, then the referring site. */
export function inferSource(a: Attribution): Source | null {
  if (a.ref) return 'referral';
  const s = `${a.utmSource ?? ''} ${a.referrer ?? ''}`.toLowerCase();
  if (/instagram|ig\b/.test(s)) return 'instagram';
  if (/facebook|fb\b|messenger/.test(s)) return 'facebook';
  if (/nextdoor/.test(s)) return 'nextdoor';
  if (/maps\.google|gbp|business ?profile|google.*maps/.test(s)) return 'maps';
  if (/google|bing|duckduckgo|yahoo/.test(s)) return 'google';
  return null;
}

export const touchJson = (a: Attribution | null) => (a ? JSON.stringify(a) : null);
