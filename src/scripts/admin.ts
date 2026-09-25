import { formatRange, quote, validateConfig, type PricingConfig } from '@ked/pricing';

/**
 * The web admin (src/pages/admin.astro). Everything goes through the API with
 * the owner's session, so the server's rules still decide what's valid; the
 * checks here only save a round trip.
 *
 * DOM is built with `h()` and text nodes, never innerHTML: customer names and
 * notes are shown here.
 */

interface Job {
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

interface Lead {
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

interface DayHours {
  open: string;
  close: string;
}

interface BookingRules {
  onlineBooking: boolean;
  timezone: string;
  week: (DayHours | null)[];
  slotStepMinutes: number;
  bufferMinutes: number;
  maxJobsPerDay: number;
  minNoticeHours: number;
  horizonDays: number;
}

class Failed extends Error {
  constructor(message: string, readonly details: string[] = []) {
    super(message);
  }
}

const API = import.meta.env.PUBLIC_KED_API_URL?.replace(/\/$/, '') ?? '';
const KEY = 'ked-admin-session';
const TZ = 'America/Chicago';
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/* ------------------------------------------------------------ helpers */

type Child = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...children: Child[]) {
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

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const dollars = (c: number) => `$${(c / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const when = (iso: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, ...opts }).format(new Date(iso));
const dayTitle = (date: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(`${date}T12:00:00Z`));

let token: string | null = null;
try {
  token = localStorage.getItem(KEY);
} catch {
  token = null;
}

function remember(t: string | null) {
  token = t;
  try {
    if (t) localStorage.setItem(KEY, t);
    else localStorage.removeItem(KEY);
  } catch {
    // Private windows: the session lasts for this page only.
  }
}

async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
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

function showError(err: unknown) {
  const el = $('[data-error]');
  if (err instanceof Failed && err.message === 'Signed out.') return;
  el.replaceChildren(
    (err as Error).message,
    ...(err instanceof Failed && err.details.length ? [h('ul', { class: 'mt-2 list-disc pl-5 text-sm' }, ...err.details.map((d) => h('li', {}, d)))] : []),
  );
  el.hidden = false;
  el.scrollIntoView?.({ block: 'center' });
}

const clearError = () => ($('[data-error]').hidden = true);

/* ------------------------------------------------------------ styling */

const input =
  'w-full rounded-sm border border-ink-700 bg-ink-900 px-3 py-2 text-bone-50 tabular-nums focus:border-gold-500 focus:outline-none';
const small = 'text-xs uppercase tracking-[0.14em] text-bone-500';
const heading = 'font-display uppercase text-bone-50';
const headingStyle = "font-variation-settings:'wdth' 76,'wght' 800;font-size:clamp(1.3rem,2.4vw,1.7rem);letter-spacing:-0.01em";
const ghost = 'border border-ink-700 px-3 py-1.5 text-sm text-bone-200 transition-colors hover:border-gold-500 hover:text-bone-50 disabled:opacity-40';

const sectionHead = (title: string, note?: string) =>
  h('div', { class: 'mb-4 mt-12 first:mt-0' }, h('h2', { class: heading, style: headingStyle }, title), note ? h('p', { class: 'mt-1 max-w-2xl text-sm text-bone-400' }, note) : null);

/** A labelled input bound to a getter/setter. `money` shows dollars and stores cents. */
function field(
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

function checkbox(label: string, get: () => boolean, set: (v: boolean) => void) {
  const el = h('input', { type: 'checkbox', class: 'size-4 accent-[#e8b14c]' }) as HTMLInputElement;
  el.checked = get();
  el.addEventListener('change', () => set(el.checked));
  return h('label', { class: 'flex items-center gap-2 text-sm text-bone-200' }, el, label);
}

/** Save button with its own status line. */
function saveBar(label: string, save: () => Promise<string>) {
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

function showSignIn(message?: string) {
  $('[data-loading]').hidden = true;
  $('[data-tabs]').hidden = true;
  $('[data-who]').hidden = true;
  for (const v of document.querySelectorAll<HTMLElement>('[data-view]')) v.hidden = true;
  $('[data-signin]').hidden = false;
  const status = $('[data-signin-status]');
  status.textContent = message ?? '';
  status.hidden = !message;
}

async function signInFromLink() {
  const match = location.hash.match(/^#login=([A-Za-z0-9_-]+)$/);
  if (!match) return;
  // Take the token out of the address bar and history straight away.
  history.replaceState(null, '', location.pathname);
  try {
    const session = await api<{ token: string; email: string }>('/auth/email/verify', { method: 'POST', body: { token: match[1] } });
    remember(session.token);
    try {
      localStorage.setItem(`${KEY}-email`, session.email);
    } catch {
      // fine
    }
  } catch (err) {
    showSignIn((err as Error).message);
    throw err;
  }
}

/* ------------------------------------------------------------ views */

const views: Record<string, () => Promise<void>> = {
  bookings: renderBookings,
  leads: renderLeads,
  prices: renderPrices,
  hours: renderHours,
};

async function open(name: string) {
  clearError();
  for (const t of document.querySelectorAll<HTMLElement>('[data-tab]')) t.setAttribute('aria-selected', String(t.dataset.tab === name));
  for (const v of document.querySelectorAll<HTMLElement>('[data-view]')) v.hidden = v.dataset.view !== name;
  const view = $(`[data-view="${name}"]`);
  view.replaceChildren(h('p', { class: 'text-bone-400' }, 'Loading…'));
  try {
    await views[name]!();
  } catch (err) {
    view.replaceChildren();
    showError(err);
  }
}

async function renderBookings() {
  const view = $('[data-view="bookings"]');
  const from = new Date(Date.now() - 864e5).toISOString();
  const to = new Date(Date.now() + 45 * 864e5).toISOString();
  const { jobs } = await api<{ jobs: Job[] }>(`/jobs?from=${from}&to=${to}`);
  const live = jobs.filter((j) => j.status !== 'cancelled');
  if (!live.length) {
    view.replaceChildren(sectionHead('Bookings'), h('p', { class: 'text-bone-400' }, 'Nothing booked in the next six weeks.'));
    return;
  }
  const byDay = new Map<string, Job[]>();
  for (const j of live) byDay.set(j.date, [...(byDay.get(j.date) ?? []), j]);

  view.replaceChildren(
    sectionHead('Bookings', 'The next six weeks. "Booked online" means the customer picked the time on the website: text them to confirm.'),
    ...[...byDay].map(([date, list]) =>
      h(
        'div',
        { class: 'mb-8' },
        h('h3', { class: 'mb-2 font-display text-sm uppercase tracking-[0.14em] text-gold-400' }, dayTitle(date)),
        h('ul', { class: 'border-t border-ink-800' }, ...list.map(jobRow)),
      ),
    ),
  );
}

function jobRow(j: Job) {
  const price = j.finalPrice !== null ? dollars(j.finalPrice) : j.quote.range ? formatRange(j.quote.range) : 'Price on site';
  const confirm = h('button', { type: 'button', class: ghost }, 'Copy confirmation text') as HTMLButtonElement;
  confirm.addEventListener('click', async () => {
    try {
      const { message } = await api<{ message: string }>(`/jobs/${j.id}/confirmation`, { method: 'POST' });
      await navigator.clipboard.writeText(message);
      confirm.textContent = 'Copied. Paste it in a text.';
    } catch (err) {
      showError(err);
    }
  });
  return h(
    'li',
    { class: 'grid gap-2 border-b border-ink-800 py-4 sm:grid-cols-[7rem_1fr_auto] sm:items-start sm:gap-6' },
    h('p', { class: 'font-semibold tabular-nums text-bone-50' }, when(j.start, { hour: 'numeric', minute: '2-digit' })),
    h(
      'div',
      { class: 'flex flex-col gap-0.5' },
      h('p', { class: 'text-bone-50' }, j.customer.name, j.source === 'web' ? h('span', { class: 'ml-3 text-xs uppercase tracking-[0.14em] text-gold-400' }, 'Booked online') : null),
      h('p', { class: 'text-sm text-bone-200' }, [j.quote.lines[0]?.label, j.vehicle].filter(Boolean).join(' · ')),
      h('p', { class: 'text-sm text-bone-400' }, j.address),
      j.customer.phone ? h('a', { class: 'text-sm text-gold-400 hover:text-gold-500', href: `tel:${j.customer.phone}` }, j.customer.phone) : null,
      j.notes ? h('p', { class: 'mt-1 text-sm italic text-bone-400' }, j.notes) : null,
    ),
    h('div', { class: 'flex flex-col items-start gap-2 sm:items-end' }, h('p', { class: 'tabular-nums text-bone-200' }, price), j.status === 'scheduled' ? confirm : h('p', { class: small }, j.status.replace('_', ' '))),
  );
}

async function renderLeads() {
  const view = $('[data-view="leads"]');
  const { leads } = await api<{ leads: Lead[] }>('/leads');
  const open = leads.filter((l) => l.status === 'new' || l.status === 'contacted');
  view.replaceChildren(
    sectionHead('Quote requests', 'People who priced a job on the website and asked Jacob to get back to them. Mark each one as you go.'),
    open.length ? h('ul', { class: 'border-t border-ink-800' }, ...open.map(leadRow)) : h('p', { class: 'text-bone-400' }, 'No open quote requests.'),
  );
}

function leadRow(l: Lead) {
  const set = (status: Lead['status']) => async () => {
    try {
      await api(`/leads/${l.id}`, { method: 'PATCH', body: { status } });
      await renderLeads();
    } catch (err) {
      showError(err);
    }
  };
  return h(
    'li',
    { class: 'grid gap-3 border-b border-ink-800 py-4 sm:grid-cols-[1fr_auto] sm:gap-6' },
    h(
      'div',
      { class: 'flex flex-col gap-0.5' },
      h('p', { class: 'text-bone-50' }, l.name, h('span', { class: `ml-3 text-xs uppercase tracking-[0.14em] ${l.status === 'new' ? 'text-gold-400' : 'text-bone-500'}` }, l.status)),
      h('p', { class: 'text-sm text-bone-200' }, [l.quote.lines[0]?.label, l.vehicle, l.zip && `ZIP ${l.zip}`].filter(Boolean).join(' · ')),
      h('p', { class: 'text-sm tabular-nums text-bone-200' }, l.quote.range ? `Estimate ${formatRange(l.quote.range)}` : 'Needs a look to price'),
      h('p', { class: 'flex flex-wrap gap-x-4 text-sm' },
        l.phone ? h('a', { class: 'text-gold-400 hover:text-gold-500', href: `tel:${l.phone}` }, l.phone) : null,
        l.email ? h('a', { class: 'text-gold-400 hover:text-gold-500', href: `mailto:${l.email}` }, l.email) : null,
      ),
      l.notes ? h('p', { class: 'mt-1 whitespace-pre-line text-sm italic text-bone-400' }, l.notes) : null,
      h('p', { class: 'text-xs text-bone-500' }, `Sent ${when(l.createdAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`),
    ),
    h(
      'div',
      { class: 'flex flex-wrap items-start gap-2 sm:justify-end' },
      l.status === 'new' ? h('button', { type: 'button', class: ghost, onclick: set('contacted') }, 'Contacted') : null,
      h('button', { type: 'button', class: ghost, onclick: set('booked') }, 'Booked'),
      h('button', { type: 'button', class: ghost, onclick: set('lost') }, 'Lost'),
    ),
  );
}

/* ------------------------------------------------------------ prices */

async function renderPrices() {
  const view = $('[data-view="prices"]');
  const { config, updatedAt } = await api<{ config: PricingConfig; updatedAt: string | null }>('/pricing');
  const cfg: PricingConfig = structuredClone(config);

  const preview = h('div', { class: 'overflow-x-auto' });
  const refresh = () => {
    const vehicle = cfg.services.filter((s) => s.craft === 'vehicle' && !s.inspectionOnly);
    const cell = (serviceId: string, vehicleClass: string) => {
      try {
        const q = quote(cfg, { service: serviceId, vehicleClass });
        return q.range ? formatRange(q.range) : '—';
      } catch {
        return '—';
      }
    };
    preview.replaceChildren(
      h(
        'table',
        { class: 'w-full min-w-[40rem] border-collapse text-left text-sm' },
        h('thead', {}, h('tr', { class: 'border-b border-ink-800' }, h('th', { class: `${small} py-2 pr-4 font-normal` }, 'Package'), ...cfg.vehicleClasses.map((c) => h('th', { class: `${small} py-2 pr-4 font-normal` }, c.label)))),
        h('tbody', {}, ...vehicle.map((s) => h('tr', { class: 'border-b border-ink-800' }, h('td', { class: 'py-2 pr-4 text-bone-50' }, s.name), ...cfg.vehicleClasses.map((c) => h('td', { class: 'py-2 pr-4 tabular-nums text-bone-200' }, cell(s.id, c.id)))))),
      ),
    );
  };
  // Every field edits cfg, then the preview recomputes.
  // Loosely typed on purpose: each setter narrows its own value (`as number`, String(v)).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bind = (get: () => any, set: (v: any) => void): [() => any, (v: any) => void] => [get, (v) => (set(v), refresh())];
  const grid = (...children: Child[]) => h('div', { class: 'grid grid-cols-2 gap-3 sm:grid-cols-4' }, ...children);
  const block = (title: string, ...children: Child[]) => h('div', { class: 'border-t border-ink-800 py-5' }, h('p', { class: 'mb-3 font-semibold text-bone-50' }, title), ...children);

  const packages = cfg.services.map((s) =>
    block(
      `${s.level ? `${s.level}: ` : ''}${s.name}`,
      s.inspectionOnly
        ? h('p', { class: 'text-sm text-bone-400' }, 'Priced after Jacob sees it, so there are no numbers to set.')
        : grid(
            field(s.craft === 'boat' ? 'Price per foot ($)' : 'Price, sedan ($)', ...bind(() => s.base, (v) => (s.base = v as number)), { kind: 'money' }),
            field(s.craft === 'boat' ? 'Hours per foot, low' : 'Hours, low', ...bind(() => s.hours[0], (v) => (s.hours[0] = v as number)), { step: 0.05, min: 0 }),
            field(s.craft === 'boat' ? 'Hours per foot, high' : 'Hours, high', ...bind(() => s.hours[1], (v) => (s.hours[1] = v as number)), { step: 0.05, min: 0 }),
            field('Range either side (%)', ...bind(() => Math.round(s.spread * 100), (v) => (s.spread = (v as number) / 100)), { step: 1, min: 0 }),
          ),
    ),
  );

  const sizes = cfg.vehicleClasses.map((c) =>
    block(c.label, grid(
      field('Name', ...bind(() => c.label, (v) => (c.label = String(v))), { kind: 'text' }),
      field('Examples', ...bind(() => c.examples, (v) => (c.examples = String(v))), { kind: 'text' }),
      field('Times the sedan price', ...bind(() => c.multiplier, (v) => (c.multiplier = v as number)), { step: 0.05, min: 0 }),
    )),
  );

  const conditions = cfg.conditions.map((q) =>
    block(`${q.question} (${q.craft === 'boat' ? 'boats' : 'cars'})`, ...q.options.map((o, i) =>
      grid(
        field(i === 0 ? 'Answer (costs nothing)' : 'Answer', ...bind(() => o.label, (v) => (o.label = String(v))), { kind: 'text' }),
        field(q.craft === 'boat' && o.scalesWithSize ? 'Adds per foot ($)' : 'Adds ($)', ...bind(() => o.add, (v) => (o.add = v as number)), { kind: 'money' }),
        field('Extra hours', ...bind(() => o.hours, (v) => (o.hours = v as number)), { step: 0.05, min: 0 }),
        h('div', { class: 'flex items-end pb-2' }, checkbox('Bigger vehicle costs more', ...bind(() => o.scalesWithSize, (v) => (o.scalesWithSize = v)))),
      ),
    )),
  );

  const addOns = cfg.addOns.map((a) =>
    block(a.label, grid(
      field('Name', ...bind(() => a.label, (v) => (a.label = String(v))), { kind: 'text' }),
      field('Price ($)', ...bind(() => a.price, (v) => (a.price = v as number)), { kind: 'money' }),
      field('Hours', ...bind(() => a.hours, (v) => (a.hours = v as number)), { step: 0.05, min: 0 }),
      h('div', { class: 'flex items-end pb-2' }, checkbox('Bigger vehicle costs more', ...bind(() => a.scalesWithSize, (v) => (a.scalesWithSize = v)))),
      field('What it is', ...bind(() => a.description, (v) => (a.description = String(v))), { kind: 'text', wide: true }),
    )),
  );

  const travel = [
    ...cfg.travel.zones.map((z) =>
      block(z.label, grid(
        field('Area name', ...bind(() => z.label, (v) => (z.label = String(v))), { kind: 'text' }),
        field('Travel fee ($)', ...bind(() => z.fee, (v) => (z.fee = v as number)), { kind: 'money' }),
        field('ZIP codes (comma-separated; 3 digits covers a region)', ...bind(() => z.zips.join(', '), (v) => (z.zips = String(v).split(/[\s,]+/).filter(Boolean))), { kind: 'text', wide: true }),
      )),
    ),
    block('Everywhere else', grid(
      field('Fee outside those areas ($)', ...bind(() => cfg.travel.outsideFee, (v) => (cfg.travel.outsideFee = v as number | null)), { kind: 'money', blank: 'Jacob confirms' }),
      field('Smallest job ($)', ...bind(() => cfg.minimum, (v) => (cfg.minimum = v as number)), { kind: 'money' }),
      field('Round shown prices to ($)', ...bind(() => cfg.roundTo, (v) => (cfg.roundTo = v as number)), { kind: 'money' }),
    )),
  ];

  refresh();
  view.replaceChildren(
    sectionHead('What customers see', 'The estimate range for each package and size, worked out live from the numbers below. Nothing changes on the website until you save.'),
    preview,
    sectionHead('Packages', 'Car prices are for a sedan. Other sizes multiply it (see Sizes).'),
    ...packages,
    sectionHead('Sizes'),
    ...sizes,
    sectionHead('Condition questions', 'What each answer adds to the price and the time.'),
    ...conditions,
    sectionHead('Add-ons'),
    ...addOns,
    sectionHead('Travel and minimums'),
    ...travel,
    h('p', { class: 'mt-6 text-xs text-bone-500' }, updatedAt ? `Last saved ${when(updatedAt, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}.` : 'These are still the sample prices.'),
    saveBar('Save prices', async () => {
      const problems = validateConfig(cfg);
      if (problems.length) throw new Failed('Some prices need fixing before they can be saved.', problems);
      await api('/pricing', { method: 'PUT', body: cfg });
      return 'Saved. The website shows the new prices in about a minute.';
    }),
  );
}

/* ------------------------------------------------------------ hours */

async function renderHours() {
  const view = $('[data-view="hours"]');
  const { rules } = await api<{ rules: BookingRules }>('/settings/booking');
  const r: BookingRules = structuredClone(rules);

  const dayRow = (i: number) => {
    const times = h('div', { class: 'grid grid-cols-2 gap-3' });
    const drawTimes = () => {
      const d = r.week[i];
      times.replaceChildren(
        ...(d
          ? [
              field('Start', () => d.open, (v) => (d.open = String(v)), { kind: 'time' }),
              field('Finish', () => d.close, (v) => (d.close = String(v)), { kind: 'time' }),
            ]
          : [h('p', { class: 'col-span-2 self-end pb-2 text-sm text-bone-500' }, 'Closed')]),
      );
    };
    drawTimes();
    const last = r.week.find(Boolean) ?? { open: '08:00', close: '17:00' };
    return h(
      'div',
      { class: 'grid items-end gap-3 border-t border-ink-800 py-4 sm:grid-cols-[10rem_1fr]' },
      checkbox(DAYS[i]!, () => r.week[i] !== null, (on) => {
        r.week[i] = on ? { ...(r.week[i] ?? last) } : null;
        drawTimes();
      }),
      times,
    );
  };

  view.replaceChildren(
    sectionHead('Online booking'),
    checkbox('Customers can book online', () => r.onlineBooking, (v) => (r.onlineBooking = v)),
    h('p', { class: 'mt-2 text-sm text-bone-400' }, 'Off: the website still gives quotes and sends you requests, but nobody can pick a time.'),
    sectionHead('Working days', 'Tick the days you work. Online bookings only land inside these hours.'),
    ...r.week.map((_, i) => dayRow(i)),
    sectionHead('Limits'),
    h(
      'div',
      { class: 'grid grid-cols-2 gap-3 sm:grid-cols-4' },
      field('Most jobs in a day', () => r.maxJobsPerDay, (v) => (r.maxJobsPerDay = v as number), { step: 1, min: 1 }),
      field('Minutes between jobs', () => r.bufferMinutes, (v) => (r.bufferMinutes = v as number), { step: 15, min: 0 }),
      field('Hours of notice', () => r.minNoticeHours, (v) => (r.minNoticeHours = v as number), { step: 1, min: 0 }),
      field('Days ahead people can book', () => r.horizonDays, (v) => (r.horizonDays = v as number), { step: 1, min: 1 }),
      field('Start times every (minutes)', () => r.slotStepMinutes, (v) => (r.slotStepMinutes = v as number), { step: 15, min: 15 }),
    ),
    saveBar('Save hours', async () => {
      await api('/settings/booking', { method: 'PUT', body: r });
      return 'Saved. Online booking uses these now, and the website shows them in a few minutes.';
    }),
  );
}

/* ------------------------------------------------------------ start */

export async function initAdmin() {
  if (!API) {
    $('[data-loading]').textContent = "This page needs the API, and it isn't configured on this build.";
    return;
  }

  $('[data-signin-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = ($('#admin-email') as HTMLInputElement).value.trim();
    try {
      await api('/auth/email', { method: 'POST', body: { email } });
      showSignIn(`If ${email} is allowed in, a sign-in link is on its way. Open it on this device.`);
    } catch (err) {
      showSignIn((err as Error).message);
    }
  });

  $('[data-sign-out]').addEventListener('click', async () => {
    await api('/auth/session', { method: 'DELETE' }).catch(() => undefined);
    remember(null);
    showSignIn('Signed out.');
  });

  for (const t of document.querySelectorAll<HTMLElement>('[data-tab]')) t.addEventListener('click', () => open(t.dataset.tab!));

  try {
    await signInFromLink();
  } catch {
    return;
  }
  if (!token) return showSignIn();

  $('[data-loading]').hidden = true;
  $('[data-signin]').hidden = true;
  $('[data-tabs]').hidden = false;
  $('[data-who]').hidden = false;
  try {
    $('[data-who-email]').textContent = localStorage.getItem(`${KEY}-email`) ?? '';
  } catch {
    // fine
  }
  await open('bookings');
}
