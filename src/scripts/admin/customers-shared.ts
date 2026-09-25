/**
 * What the Customers tab's files share: the CRM shapes the API returns
 * (api/src/crm-customers.ts, crm-segments.ts), where-they-came-from words,
 * tags drawn in the site's own style, and small date helpers.
 */
import type { PricingConfig } from '@ked/pricing';
import { type Child, TZ, h, api, input, dollars } from './core';
import type { CalJob, Customer } from './calendar-shared';

/** One row of the list: a customer with their numbers (crm-segments.ts CustomerStats). */
export interface Person {
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
  spend: number;
  avgTicket: number | null;
  firstVisit: string | null;
  lastVisit: string | null;
  lastService: string | null;
  nextVisit: string | null;
  services: string[];
  zip: string | null;
  referrals: number;
}

export interface CrmCustomer extends Customer {
  source: string | null;
  sourceDetail: string | null;
  attribution: Record<string, string> | null;
  tags: string[];
  referredBy: string | null;
  referralCode: string | null;
  emailOk: boolean;
  textOk: boolean;
}

export interface TimelineItem {
  type: string;
  id: string;
  at: string;
  title: string;
  body: string | null;
  amount?: number | null;
  jobId?: string | null;
  invoiceId?: string | null;
  date?: string;
  status?: string;
  meta?: Record<string, unknown> | null;
  by?: string;
  editable?: boolean;
}

export interface ProfileInvoice {
  id: string;
  number: number;
  jobId: string;
  status: 'draft' | 'sent' | 'paid' | 'void';
  total: number;
  paid: number;
  balance: number;
  paidOn: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface Profile {
  customer: CrmCustomer;
  numbers: {
    visits: number;
    spend: number;
    avgTicket: number | null;
    firstVisit: string | null;
    lastVisit: string | null;
    lastService: string | null;
    nextVisit: string | null;
    customerSince: string;
    everyDays: number | null;
    services: string[];
    zip: string | null;
    referrals: number;
    paid: number;
    tips: number;
    owed: number;
  };
  referral: {
    code: string;
    url: string;
    referredBy: { id: string; name: string } | null;
    referred: { id: string; name: string; createdAt: string; visits: number }[];
  };
  jobs: CalJob[];
  invoices: ProfileInvoice[];
  payments: { id: string; date: string; amount: number; method: string | null; jobId: string; tip: boolean }[];
  quoteRequests: { id: string; status: string; service: string; vehicle: string | null; zip: string | null; notes: string | null; range: [number, number] | null; createdAt: string }[];
  followUps: { id: string; kind: string; dueDate: string; channel: string | null; title: string; message: string | null }[];
  timeline: TimelineItem[];
}

/* ------------------------------------------------------------ words */

/** api/src/attribution.ts SOURCES, in Jacob's words. */
export const SOURCES: [string, string][] = [
  ['google', 'Google search'],
  ['maps', 'Google Maps'],
  ['instagram', 'Instagram'],
  ['facebook', 'Facebook'],
  ['nextdoor', 'Nextdoor'],
  ['referral', 'A friend sent them'],
  ['van', 'Saw the van or a sign'],
  ['repeat', 'Came back on their own'],
  ['other', 'Something else'],
];
export const sourceName = (s: string | null) => (s ? (SOURCES.find(([k]) => k === s)?.[1] ?? s) : null);

/** Service names from the live price list, so "level-2" reads "The Refresh". Loaded once. */
let services: Promise<Map<string, string>> | null = null;
export function serviceNames(): Promise<Map<string, string>> {
  services ??= api<{ config: PricingConfig }>('/pricing')
    .then(({ config }) => new Map(config.services.map((s) => [s.id, s.name])))
    .catch(() => {
      services = null;
      return new Map<string, string>();
    });
  return services;
}

/* ------------------------------------------------------------ tags */

/** Tags as small capitals divided by hairlines: VIP | BOAT OWNER. */
export function tagLine(tags: string[], cls = '') {
  if (!tags.length) return null;
  return h(
    'span',
    { class: `inline-flex flex-wrap items-center gap-y-1 ${cls}` },
    ...tags.map((t, i) =>
      h('span', { class: `text-[0.68rem] uppercase leading-none tracking-[0.16em] text-gold-400 ${i ? 'ml-2 border-l border-ink-600 pl-2' : ''}` }, t),
    ),
  );
}

/* ------------------------------------------------------------ dates */

/** YYYY-MM-DD today in St. Louis. */
export const todayLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** A plain day, formatted at noon UTC so no zone can shift it. */
export const dayText = (date: string, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }).format(new Date(`${date.slice(0, 10)}T12:00:00Z`));

/** "Jan 15" this year, "Jan 15, 2024" otherwise. */
export function shortDate(date: string | null) {
  if (!date) return null;
  const sameYear = date.slice(0, 4) === todayLocal().slice(0, 4);
  return dayText(date, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

/** An instant's day in St. Louis, YYYY-MM-DD. */
export const localDay = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

export const daysSince = (date: string) => Math.round((Date.parse(`${todayLocal()}T12:00:00Z`) - Date.parse(`${date.slice(0, 10)}T12:00:00Z`)) / 864e5);

/** "every 3 weeks", "every 5 months", "every 10 days". */
export function everyText(days: number) {
  if (days < 14) return `every ${days} ${days === 1 ? 'day' : 'days'}`;
  if (days < 70) return `every ${Math.round(days / 7)} weeks`;
  const months = Math.round(days / 30.4);
  return months >= 12 && months % 12 === 0 ? `every ${months / 12 === 1 ? 'year' : `${months / 12} years`}` : `every ${months} months`;
}

/** "3 weeks ago" style, for last visits. */
export function agoText(date: string) {
  const d = daysSince(date);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 14) return `${d} days ago`;
  if (d < 70) return `${Math.round(d / 7)} weeks ago`;
  const m = Math.round(d / 30.4);
  return m < 24 ? `${m} months ago` : `${Math.round(d / 365)} years ago`;
}

/* ------------------------------------------------------------ bits */

/** Small label over a value, for the numbers list. */
export const fact = (label: string, ...value: Child[]) =>
  h(
    'div',
    { class: 'flex items-baseline justify-between gap-6 border-b border-ink-800 py-2.5' },
    h('dt', { class: 'shrink-0 text-sm text-bone-400' }, label),
    h('dd', { class: 'min-w-0 text-right tabular-nums text-bone-50' }, ...value),
  );


/** A text-style tab bar like the Invoices tab's, with the chosen one underlined in gold. */
export function tabBar<K extends string>(items: [K, string, string?][], chosen: K, pick: (k: K) => void, label: string) {
  return h(
    'div',
    { class: 'flex gap-4 overflow-x-auto border-b border-ink-800 [scrollbar-width:none] sm:gap-6', role: 'group', 'aria-label': label },
    ...items.map(([key, name, count]) =>
      h(
        'button',
        {
          type: 'button',
          'aria-pressed': String(chosen === key),
          class:
            'shrink-0 border-b-2 border-transparent px-1 py-2 font-display text-[0.74rem] uppercase tracking-[0.16em] text-bone-400 transition-colors hover:text-bone-50 aria-pressed:border-gold-500 aria-pressed:text-bone-50',
          onclick: () => pick(key),
        },
        name,
        count !== undefined ? h('span', { class: 'ml-1.5 tabular-nums text-bone-500' }, count) : null,
      ),
    ),
  );
}

/**
 * Search for another customer and pick one. Used for "referred by" and for
 * merging a duplicate. `skip` leaves out the person being edited.
 */
export function customerPicker(skip: string, pick: (p: Person) => void, placeholder = 'Name, phone or email') {
  const box = h('input', { type: 'search', class: input, placeholder, autocomplete: 'off', 'aria-label': 'Find a customer' }) as HTMLInputElement;
  const list = h('ul', { class: 'mt-1' });
  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  box.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = box.value.trim();
      const mine = ++seq;
      if (q.length < 2) return list.replaceChildren();
      const seg = encodeURIComponent(JSON.stringify({ q, sort: 'name', limit: 8 }));
      const found = (await api<{ customers: Person[] }>(`/crm/customers?segment=${seg}`).catch(() => ({ customers: [] as Person[] }))).customers.filter((p) => p.id !== skip);
      if (mine !== seq) return;
      list.replaceChildren(
        ...(found.length
          ? found.map((p) =>
              h(
                'li',
                {},
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'flex w-full flex-wrap items-baseline justify-between gap-x-4 border-b border-ink-800 px-1 py-2 text-left hover:bg-ink-900',
                    onclick: () => pick(p),
                  },
                  h('span', { class: 'text-bone-50' }, p.name),
                  h('span', { class: 'text-sm tabular-nums text-bone-400' }, [p.phone, p.visits ? `${p.visits} visits, ${dollars(p.spend)}` : 'never booked'].filter(Boolean).join(' · ')),
                ),
              ),
            )
          : [h('li', { class: 'py-2 text-sm text-bone-500' }, 'Nobody by that name.')]),
      );
    }, 250);
  });
  return { el: h('div', {}, box, list), focus: () => box.focus() };
}
