/**
 * Remembers where a visitor first came from, so a booking or quote request
 * days later can still say "found us on Instagram". First touch wins: UTM
 * tags, the referring site (host only) and the landing page (path only), plus
 * a referral code from ?ref=, which is kept even if it arrives later.
 *
 * Stored only in this browser. Sent to the API with a booking or quote
 * request; see api/src/attribution.ts.
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

export function recordVisit() {
  const params = new URLSearchParams(location.search);
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
