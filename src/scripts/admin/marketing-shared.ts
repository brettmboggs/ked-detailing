/**
 * What the Marketing tab's parts share: the API's shapes, the switcher's
 * hand-off, and small controls (copy, text, a two-step "are you sure").
 */
import { type Child, h, ghost, small, clearError, showError } from './core';
import { copy, isPhone, smsHref } from './invoices-shared';

export { copy, isPhone, smsHref };

export type MarketingPart = 'campaigns' | 'links' | 'referrals' | 'reviews' | 'leads';
export interface GoOpts {
  /** Open this campaign. */
  campaignId?: string;
  /** Links: start a new link from this preset. */
  preset?: string;
}
export interface MarketingCtx {
  go: (part: MarketingPart, opts?: GoOpts) => void;
}

/** All marketing endpoints live under here (api/src/crm-campaigns.ts). */
export const M = '/crm/campaigns';

export interface Segment {
  lifecycle?: 'any' | 'lead' | 'customer' | 'repeat' | 'lapsed';
  lapsedDays?: number;
  minSpend?: number;
  minVisits?: number;
  services?: string[];
  zips?: string[];
  sources?: string[];
  noUpcoming?: boolean;
  sort?: 'spend' | 'recent' | 'visits' | 'name' | 'newest';
  limit?: number;
}

export interface Stats {
  total: number;
  queued: number;
  sent: number;
  failed: number;
  skipped: number;
  bookings: number;
  bookedValue: number;
}

export interface Campaign {
  id: string;
  name: string;
  template: string | null;
  segment: Segment;
  channel: 'email' | 'text';
  subject: string | null;
  body: string;
  status: 'draft' | 'sending' | 'sent';
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
  stats: Stats;
}

export interface Template {
  id: string;
  name: string;
  why: string;
  months: number[];
  channel: 'email' | 'text';
  subject: string;
  email: string;
  text: string;
  segment: Segment;
}

/** Where people came from (api/src/attribution.ts), in his words. */
export const SOURCE_NAMES: Record<string, string> = {
  google: 'Google search',
  maps: 'Google Maps',
  instagram: 'Instagram',
  facebook: 'Facebook',
  nextdoor: 'Nextdoor',
  referral: 'A friend',
  van: 'The van or a sign',
  repeat: 'Been here before',
  other: 'Something else',
};

/** A small uppercase label. */
export const label = (text: string, cls = '') => h('p', { class: `${small} ${cls}` }, text);

/** A short explanation under a heading. */
export const note = (...text: Child[]) => h('p', { class: 'max-w-2xl text-sm text-bone-400' }, ...text);

/** A section: a ruled heading with an optional explanation. */
export const part = (title: string, explain: string | null, ...children: Child[]) =>
  h(
    'section',
    { class: 'border-t border-ink-800 pb-10 pt-6' },
    h('h3', { class: 'font-display text-lg uppercase tracking-[0.04em] text-bone-50', style: "font-variation-settings:'wdth' 85,'wght' 700" }, title),
    explain ? h('p', { class: 'mt-1 max-w-2xl text-sm text-bone-400' }, explain) : null,
    h('div', { class: 'mt-5' }, ...children),
  );

export const linkText = 'text-sm text-gold-400 underline decoration-ink-600 underline-offset-4 hover:text-gold-500 hover:decoration-gold-500';
export const quiet = 'text-sm text-bone-400 underline decoration-ink-600 underline-offset-4 hover:text-bone-50 hover:decoration-gold-500';
export const goldSmall = 'btn-gold px-4 py-2.5 text-[0.78rem] disabled:opacity-50';

/** A button that runs something and reports back beside itself. Errors go to the page's error line. */
export function button(text: string, run: (btn: HTMLButtonElement) => Promise<string | void> | string | void, cls = ghost) {
  const status = h('span', { class: 'text-sm text-bone-400', role: 'status' });
  const btn = h('button', { type: 'button', class: cls }, text) as HTMLButtonElement;
  btn.addEventListener('click', async () => {
    clearError();
    btn.disabled = true;
    status.textContent = '';
    try {
      status.textContent = (await run(btn)) ?? '';
    } catch (err) {
      showError(err);
    } finally {
      btn.disabled = false;
    }
  });
  return { btn, status, row: h('div', { class: 'flex flex-wrap items-center gap-3' }, btn, status) };
}

/**
 * A button that asks once before doing something that can't be undone: the
 * first tap swaps it for "Yes, …" and "Keep it". No pop-ups.
 */
export function confirmButton(text: string, yes: string, run: () => Promise<void>, cls = ghost) {
  const wrap = h('span', { class: 'inline-flex flex-wrap items-center gap-3' });
  const first = h('button', { type: 'button', class: cls }, text) as HTMLButtonElement;
  const reset = () => wrap.replaceChildren(first);
  first.addEventListener('click', () => {
    const ok = h('button', { type: 'button', class: cls }, yes) as HTMLButtonElement;
    const no = h('button', { type: 'button', class: quiet, onclick: reset }, 'Cancel');
    ok.addEventListener('click', async () => {
      clearError();
      ok.disabled = true;
      try {
        await run();
      } catch (err) {
        showError(err);
        reset();
      }
    });
    wrap.replaceChildren(ok, no);
    ok.focus();
  });
  reset();
  return wrap;
}

/** Copy some text, saying so next to the button for a moment. */
export function copyButton(text: () => string, labelText = 'Copy', cls = quiet) {
  const btn = h('button', { type: 'button', class: cls }, labelText) as HTMLButtonElement;
  btn.addEventListener('click', async () => {
    const ok = await copy(text());
    btn.textContent = ok ? 'Copied' : 'Select and copy';
    setTimeout(() => (btn.textContent = labelText), 1600);
  });
  return btn;
}

/** "Sep 3" in St. Louis time. */
export const shortDate = (iso: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' }).format(new Date(iso));

/** A plain YYYY-MM-DD as "Sep 3". */
export const plainDate = (d: string, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }).format(new Date(`${d}T12:00:00Z`));

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** First word of a name. */
export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;
