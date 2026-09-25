/**
 * The web admin's shared pieces: API calls with the owner's session, the DOM
 * builder, form fields and styles. Each tab lives in its own file next to this
 * one and registers in index.ts.
 *
 * DOM is built with `h()` and text nodes, never innerHTML: customer names and
 * notes are shown here.
 */

export interface Job {
  id: string;
  status: 'scheduled' | 'in_progress' | 'done' | 'cancelled';
  source: 'web' | 'app';
  customer: { name: string; phone: string | null; email: string | null };
  vehicle: string | null;
  address: string;
  notes: string | null;
  quote: { lines: { label: string }[]; range: [number, number] | null };
  finalPrice: number | null;
  start: string;
  date: string;
  cancelReason?: string | null;
}

export interface Lead {
  id: string;
  status: 'new' | 'contacted' | 'booked' | 'lost';
  name: string;
  phone: string | null;
  email: string | null;
  vehicle: string | null;
  zip: string | null;
  notes: string | null;
  quote: { lines: { label: string }[]; range: [number, number] | null };
  createdAt: string;
}

export interface DayHours {
  open: string;
  close: string;
}

export interface BookingRules {
  onlineBooking: boolean;
  timezone: string;
  week: (DayHours | null)[];
  slotStepMinutes: number;
  bufferMinutes: number;
  maxJobsPerDay: number;
  minNoticeHours: number;
  horizonDays: number;
}

export class Failed extends Error {
  constructor(message: string, readonly details: string[] = []) {
    super(message);
  }
}

export const API = import.meta.env.PUBLIC_KED_API_URL?.replace(/\/$/, '') ?? '';
export const KEY = 'ked-admin-session';
export const TZ = 'America/Chicago';
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/* ------------------------------------------------------------ helpers */

export type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...children: Child[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
export const dollars = (c: number) => `$${(c / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
export const when = (iso: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, ...opts }).format(new Date(iso));
export const dayTitle = (date: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(`${date}T12:00:00Z`));

export let token: string | null = null;
try {
  token = localStorage.getItem(KEY);
} catch {
  token = null;
}

export function remember(t: string | null) {
  token = t;
  try {
    if (t) localStorage.setItem(KEY, t);
    else localStorage.removeItem(KEY);
  } catch {
    // Private windows: the session lasts for this page only.
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${API}/v1${path}`, {
    method: init.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (res.status === 401 && token) {
    remember(null);
    showSignIn('Your session ended. Sign in again.');
    throw new Failed('Signed out.');
  }
  if (!res.ok) throw new Failed(body?.error?.message ?? `Something went wrong (${res.status}).`, body?.error?.details ?? []);
  return body as T;
}

export function showError(err: unknown) {
  const el = $('[data-error]');
  if (err instanceof Failed && err.message === 'Signed out.') return;
  el.replaceChildren(
    (err as Error).message,
    ...(err instanceof Failed && err.details.length ? [h('ul', { class: 'mt-2 list-disc pl-5 text-sm' }, ...err.details.map((d) => h('li', {}, d)))] : []),
  );
  el.hidden = false;
  el.scrollIntoView?.({ block: 'center' });
}

export const clearError = () => ($('[data-error]').hidden = true);

/* ------------------------------------------------------------ styling */

export const input =
  'w-full rounded-sm border border-ink-700 bg-ink-900 px-3 py-2 text-bone-50 tabular-nums focus:border-gold-500 focus:outline-none';
export const small = 'text-xs uppercase tracking-[0.14em] text-bone-500';
export const heading = 'font-display uppercase text-bone-50';
export const headingStyle = "font-variation-settings:'wdth' 76,'wght' 800;font-size:clamp(1.3rem,2.4vw,1.7rem);letter-spacing:-0.01em";
export const ghost = 'border border-ink-700 px-3 py-1.5 text-sm text-bone-200 transition-colors hover:border-gold-500 hover:text-bone-50 disabled:opacity-40';

export const sectionHead = (title: string, note?: string) =>
  h('div', { class: 'mb-4 mt-12 first:mt-0' }, h('h2', { class: heading, style: headingStyle }, title), note ? h('p', { class: 'mt-1 max-w-2xl text-sm text-bone-400' }, note) : null);

/** A labelled input bound to a getter/setter. `money` shows dollars and stores cents. */
export function field(
  label: string,
  get: () => number | string | null,
  set: (v: number | string | null) => void,
  opts: { kind?: 'money' | 'number' | 'text' | 'time'; step?: number; min?: number; blank?: string; wide?: boolean } = {},
) {
  const kind = opts.kind ?? 'number';
  const raw = get();
  const shown = raw === null || raw === undefined ? '' : kind === 'money' ? String((raw as number) / 100) : String(raw);
  const el = h('input', {
    class: input,
    type: kind === 'text' ? 'text' : kind === 'time' ? 'time' : 'number',
    step: kind === 'money' ? '0.01' : opts.step !== undefined ? String(opts.step) : undefined,
    min: opts.min !== undefined ? String(opts.min) : undefined,
    inputmode: kind === 'money' || kind === 'number' ? 'decimal' : undefined,
    placeholder: opts.blank,
    'aria-label': label,
  }) as HTMLInputElement;
  el.value = shown;
  el.addEventListener('input', () => {
    const v = el.value.trim();
    if (kind === 'text' || kind === 'time') return set(v);
    if (v === '') return set(opts.blank !== undefined ? null : 0);
    const n = Number(v);
    if (!Number.isFinite(n)) return;
    set(kind === 'money' ? Math.round(n * 100) : n);
  });
  return h('label', { class: `flex flex-col gap-1 ${opts.wide ? 'sm:col-span-2' : ''}` }, h('span', { class: small }, label), el);
}

export function checkbox(label: string, get: () => boolean, set: (v: boolean) => void) {
  const el = h('input', { type: 'checkbox', class: 'size-4 accent-[#e8b14c]' }) as HTMLInputElement;
  el.checked = get();
  el.addEventListener('change', () => set(el.checked));
  return h('label', { class: 'flex items-center gap-2 text-sm text-bone-200' }, el, label);
}

/** Save button with its own status line. */
export function saveBar(label: string, save: () => Promise<string>) {
  const status = h('p', { class: 'text-sm text-bone-400', role: 'status' });
  const btn = h('button', { type: 'button', class: 'btn-gold' }, label) as HTMLButtonElement;
  btn.addEventListener('click', async () => {
    clearError();
    btn.disabled = true;
    status.textContent = 'Saving…';
    try {
      status.textContent = await save();
    } catch (err) {
      status.textContent = '';
      showError(err);
    } finally {
      btn.disabled = false;
    }
  });
  return h('div', { class: 'sticky bottom-0 mt-10 flex flex-wrap items-center gap-4 border-t border-ink-800 bg-ink-950/95 py-4 backdrop-blur' }, btn, status);
}

/* ------------------------------------------------------------ sign in */

export function showSignIn(message?: string) {
  $('[data-loading]').hidden = true;
  $('[data-tabs]').hidden = true;
  $('[data-who]').hidden = true;
  for (const v of document.querySelectorAll<HTMLElement>('[data-view]')) v.hidden = true;
  $('[data-signin]').hidden = false;
  const status = $('[data-signin-status]');
  status.textContent = message ?? '';
  status.hidden = !message;
}
