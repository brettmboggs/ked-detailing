/**
 * Pieces the Calendar and Customers tabs share: the full job and customer
 * shapes the API returns, time helpers in the business's zone, and the hand-off
 * between the two tabs (open a job from a customer, book a job for one).
 */
import { formatRange, type QuoteInput } from '@ked/pricing';
import { localDate } from '@ked/scheduling';
import { type Child, TZ, h, clearError, showError, dollars, ghost, small } from './core';

export type JobStatus = 'scheduled' | 'in_progress' | 'done' | 'cancelled';

export interface CalJob {
  id: string;
  status: JobStatus;
  source: 'web' | 'app';
  service: string;
  customer: { id: string; name: string; phone: string | null; email: string | null };
  vehicle: string | null;
  address: string;
  zip: string | null;
  notes: string | null;
  input: Partial<QuoteInput>;
  quote: {
    service: string;
    lines: { label: string; amount: number }[];
    total: number;
    range: [number, number] | null;
    hours: [number, number];
    inspection: boolean;
    notes: string[];
  };
  finalPrice: number | null;
  manageToken: string;
  cancelledBy: 'customer' | 'owner' | null;
  cancelReason: string | null;
  importedFrom: string | null;
  history: boolean;
  start: string;
  end: string;
  date: string;
  createdAt: string;
  updatedAt: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TimeOff {
  id: string;
  start: string;
  end: string;
  reason: string | null;
}

export interface InvoiceLite {
  id: string;
  number: number;
  status: 'draft' | 'sent' | 'paid' | 'void';
  total: number;
  paid: number;
  balance: number;
  payUrl: string;
  viewedAt: string | null;
}

/* ------------------------------------------------------------ hand-off */

/** Set before switching tabs; the tab reads and clears it when it draws. */
export const pending: { job: string | null; newJobFor: Customer | null; customer: string | null } = {
  job: null,
  newJobFor: null,
  customer: null,
};

/** Switch tabs the same way a click on the tab bar does. */
export function goTab(name: string) {
  document.querySelector<HTMLElement>(`[data-tab="${name}"]`)?.click();
}

/** Back to the top of the admin. Lenis owns scrolling, so ask it first. */
export function toTop() {
  const target = document.querySelector<HTMLElement>('[data-tabs]') ?? document.body;
  const ev = new CustomEvent('ked:scroll-to', { detail: target, cancelable: true });
  if (document.dispatchEvent(ev)) window.scrollTo(0, 0);
}

/* ------------------------------------------------------------ words */

export const STATUS: Record<JobStatus, string> = {
  scheduled: 'Booked',
  in_progress: 'Started',
  done: 'Done',
  cancelled: 'Cancelled',
};

/** Left-edge colour for a job, by status. */
export const STATUS_EDGE: Record<JobStatus, string> = {
  scheduled: 'border-gold-500',
  in_progress: 'border-spec-400',
  done: 'border-bone-400',
  cancelled: 'border-ink-600',
};

export const STATUS_TEXT: Record<JobStatus, string> = {
  scheduled: 'text-gold-400',
  in_progress: 'text-spec-400',
  done: 'text-bone-400',
  cancelled: 'text-bone-500',
};

/** "The Refresh" from "The Refresh — Small SUV or crossover". */
export const serviceName = (j: CalJob) => (j.quote.lines[0]?.label ?? 'Job').split(' — ')[0]!;

export const priceText = (j: CalJob) =>
  j.finalPrice !== null ? dollars(j.finalPrice) : j.quote.range ? formatRange(j.quote.range) : 'Price after a look';

/* ------------------------------------------------------------ time */

export const today = () => localDate(new Date(), TZ);

const clock = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
/** "9 AM", "9:30 AM". */
export const time = (iso: string) => clock.format(new Date(iso)).replace(':00', '');

/** Plain-day formatting: dates are formatted at noon UTC so no zone can shift them. */
export const dayFmt = (date: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }).format(new Date(`${date}T12:00:00Z`));

const partsFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' });
/** Minutes after local midnight. */
export function minuteOfDay(instant: Date | string) {
  const p = Object.fromEntries(partsFmt.formatToParts(new Date(instant)).map((x) => [x.type, x.value]));
  return Number(p.hour) * 60 + Number(p.minute);
}

/** "HH:MM" in the business's zone, for time inputs. */
export const hhmm = (iso: string) => {
  const m = minuteOfDay(iso);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** "9 AM – 2:30 PM", or with the day when it ends on another one. */
export function span(start: string, end: string) {
  const sameDay = localDate(start, TZ) === localDate(end, TZ);
  return sameDay ? `${time(start)} – ${time(end)}` : `${time(start)} – ${dayFmt(localDate(end, TZ), { weekday: 'short' })} ${time(end)}`;
}

export const hoursBetween = (start: string, end: string) => (new Date(end).getTime() - new Date(start).getTime()) / 36e5;

export const hoursText = (n: number) => `${Math.round(n * 10) / 10} ${n === 1 ? 'hour' : 'hours'}`;

/* ------------------------------------------------------------ links */

export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;
export const smsHref = (phone: string) => `sms:${phone.replace(/[^\d+]/g, '')}`;
export const mapHref = (address: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

export const link = (label: string, href: string, external = false) =>
  h(
    'a',
    {
      href,
      class: 'text-gold-400 underline decoration-ink-600 underline-offset-4 hover:text-gold-500 hover:decoration-gold-500',
      ...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {}),
    },
    label,
  );

/** Call, Text, Email and Map links for someone, separated by thin rules. */
export function contactLinks(c: { phone: string | null; email: string | null }, address: string | null) {
  const items: HTMLElement[] = [];
  if (c.phone) items.push(link('Call', telHref(c.phone)), link('Text', smsHref(c.phone)));
  if (c.email) items.push(link('Email', `mailto:${c.email}`));
  if (address) items.push(link('Map', mapHref(address), true));
  return h('p', { class: 'flex flex-wrap items-center gap-x-4 gap-y-2 text-sm' }, ...items);
}

/* ------------------------------------------------------------ controls */

export const textArea = 'w-full rounded-sm border border-ink-700 bg-ink-900 px-3 py-2 text-bone-50 focus:border-gold-500 focus:outline-none min-h-24';
export const goldSmall = 'btn-gold px-4 py-2.5 text-[0.78rem] disabled:opacity-50';
export const textButton = 'text-sm text-bone-400 underline decoration-ink-600 underline-offset-4 hover:text-bone-50 hover:decoration-gold-500';

/** A labelled block with a hairline above it. */
export const block = (label: string, ...children: Child[]) =>
  h('section', { class: 'border-t border-ink-800 py-6' }, h('h3', { class: `${small} mb-3` }, label), ...children);

/** A label over any control. */
export const labelled = (label: string, control: HTMLElement, cls = '') =>
  h('label', { class: `flex flex-col gap-1 ${cls}` }, h('span', { class: small }, label), control);

/**
 * A button that runs something, shows it's busy, and puts what happened next
 * to itself. Errors go to the page's error line.
 */
export function action(label: string, run: () => Promise<string | void>, cls = ghost) {
  const status = h('span', { class: 'text-sm text-bone-400', role: 'status' });
  const btn = h('button', { type: 'button', class: cls }, label) as HTMLButtonElement;
  btn.addEventListener('click', async () => {
    clearError();
    btn.disabled = true;
    status.textContent = '';
    try {
      status.textContent = (await run()) ?? '';
    } catch (err) {
      showError(err);
    } finally {
      btn.disabled = false;
    }
  });
  return { btn, status, row: h('div', { class: 'flex flex-wrap items-center gap-3' }, btn, status) };
}

/** A back link at the top of a detail page. */
export const backLink = (label: string, go: () => void) =>
  h('button', { type: 'button', class: `${textButton} mb-6`, onclick: go }, `‹ ${label}`);
