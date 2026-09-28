/**
 * Remembers where a visitor first came from, so a booking or quote request
 * days later can still say "found us on Instagram". First touch wins: UTM
 * tags, the referring site (host only) and the landing page (path only), plus
 * a referral code from ?ref=, which is kept even if it arrives later.
 *
 * Stored only in this browser. Sent to the API with a booking or quote
 * request; see api/src/attribution.ts.
 *
 * Separately, every landing on a tagged link (a QR code, a bio link) is counted
 * as a visit for that link, once per browser per day: just the tags, no names.
 */
const KEY = 'ked-first-touch';

export interface FirstTouch {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  referrer?: string;
  landing?: string;
  firstSeen?: string;
  ref?: string;
}

function read(): FirstTouch | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as FirstTouch) : null;
  } catch {
    return null;
  }
}

function write(t: FirstTouch) {
  try {
    localStorage.setItem(KEY, JSON.stringify(t));
  } catch {
    // Private windows: this visit only.
  }
}

const API = import.meta.env.PUBLIC_KED_API_URL?.replace(/\/$/, '');

/** Tells the API someone arrived on a tagged link. Never blocks or fails the page. */
function countTaggedVisit(params: URLSearchParams) {
  const utmSource = params.get('utm_source')?.trim().toLowerCase();
  if (!API || !utmSource || !navigator.sendBeacon) return;
  // Only the live site counts, so staging copies and local dev don't add visits.
  if (!import.meta.env.SITE || import.meta.env.BASE_URL !== '/' || location.hostname !== new URL(import.meta.env.SITE).hostname) return;
  const utmCampaign = params.get('utm_campaign')?.trim().toLowerCase() ?? '';
  const today = new Date().toLocaleDateString('en-CA');
  const seenKey = `ked-visit:${utmSource}|${utmCampaign}`;
  try {
    if (localStorage.getItem(seenKey) === today) return;
    localStorage.setItem(seenKey, today);
  } catch {
    // Private windows: count it anyway.
  }
  try {
    navigator.sendBeacon(`${API}/v1/link-visits`, JSON.stringify({ utmSource, utmCampaign }));
  } catch {
    // Counting is a nice-to-have.
  }
}

export function recordVisit() {
  const params = new URLSearchParams(location.search);
  countTaggedVisit(params);
  const ref = params.get('ref')?.trim().slice(0, 24) || undefined;
  const existing = read();
  if (existing) {
    if (ref && !existing.ref) write({ ...existing, ref });
    return;
  }
  let referrer: string | undefined;
  try {
    const host = document.referrer ? new URL(document.referrer).host : '';
    referrer = host && host !== location.host ? host : undefined;
  } catch {
    referrer = undefined;
  }
  const t: FirstTouch = {
    utmSource: params.get('utm_source') ?? undefined,
    utmMedium: params.get('utm_medium') ?? undefined,
    utmCampaign: params.get('utm_campaign') ?? undefined,
    referrer,
    landing: location.pathname,
    firstSeen: new Date().toISOString(),
    ref,
  };
  write(JSON.parse(JSON.stringify(t)) as FirstTouch);
}

export const firstTouch = (): FirstTouch | null => read();
