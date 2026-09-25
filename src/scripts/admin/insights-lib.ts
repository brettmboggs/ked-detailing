/**
 * Shared pieces for the Insights tab (insights.ts and insights-*.ts): the
 * shape of GET /crm/insights, number formats, report blocks (a heading with
 * what it means and how it's counted, figure rows, tables) and the one chart
 * form the tab uses, monthly columns. Charts are inline SVG built with
 * createElementNS; words go in with textContent, never innerHTML.
 */
import { type Child, h, small, heading, headingStyle } from './core';

/* -------------------------------------------------------------- types */

export interface Totals {
  revenue: number;
  jobs: number;
  avgTicket: number | null;
  workDays: number;
  perDay: number | null;
  hours: number;
  perHour: number | null;
  addonRate: number | null;
  customers: number;
  cancelled: number;
  cancelledByCustomer: number;
  cancelledValue: number;
  cancelRate: number | null;
  online: number;
  phone: number;
}

export interface BooksTotals {
  hasBooks: boolean;
  collected: number;
  tips: number;
  expenses: number;
  advertising: number;
  profit: number;
}

export interface Segment {
  lifecycle?: string;
  lapsedDays?: number;
  zips?: string[];
  noUpcoming?: boolean;
}

export interface Action {
  id: string;
  type: 'reviews' | 'rebook' | 'area' | 'pricing' | 'schedule' | 'channel' | 'referral' | 'upsell' | 'leads';
  title: string;
  detail: string;
  impact: number | null;
  impactNote: string | null;
  target: { tab: string; label: string; segment?: Segment };
}

export interface Source {
  source: string;
  label: string;
  leads: number;
  leadsBooked: number;
  conversion: number | null;
  leadsPrev: number | null;
  newCustomers: number;
  newCustomersPrev: number | null;
  revenue: number;
  customers: number;
  avgLifetimeSpend: number | null;
  repeatRate: number | null;
  spend: number;
  costPerLead: number | null;
  costPerCustomer: number | null;
  newCustomerValue: number;
  returnOnSpend: number | null;
}

export interface SpendRow {
  id: string;
  month: string;
  source: string;
  amount: number;
  note: string | null;
}

export interface Insights {
  period: { from: string; to: string; days: number; compare: { from: string; to: string } | null; today: string };
  money: {
    cur: Totals;
    prev: Totals | null;
    books: BooksTotals;
    booksPrev: BooksTotals | null;
    byMonth: { month: string; jobs: number; revenue: number }[];
    seasonality: { month: number; years: number; avgRevenue: number | null }[] | null;
    weekdays: { day: number; name: string; jobs: number; revenue: number; openDays: number; closed: boolean; jobsPerDay: number | null; fill: number | null }[];
    services: { service: string; name: string; level: string; craft: string; jobs: number; revenue: number; share: number | null; avgTicket: number | null; addonJobs: number; addonRate: number | null }[];
    craft: { boats: { jobs: number; revenue: number }; cars: { jobs: number; revenue: number } };
    craftPrev: { boats: { jobs: number; revenue: number }; cars: { jobs: number; revenue: number } } | null;
    sizes: { id: string; label: string; jobs: number; revenue: number; avgTicket: number | null }[];
    addOns: { id: string; label: string; jobs: number; revenue: number; rate: number | null }[];
  };
  customers: {
    total: number;
    leadsOnly: number;
    new: number;
    newPrev: number | null;
    served: number;
    returning: number;
    repeat: number;
    repeatRate: number | null;
    back6: { base: number; back: number; rate: number | null };
    back12: { base: number; back: number; rate: number | null };
    avgVisits: number | null;
    lifetimeValue: number | null;
    avgDaysBetween: number | null;
    lapsed: { count: number; atRisk: number; days: number };
    overdue: { count: number; value: number };
    top: { id: string; name: string; spend: number; visits: number; lifetimeSpend: number; lifetimeVisits: number; lastVisit: string | null; nextVisit: string | null; source: string; zip: string | null }[];
    top20: { count: number; of: number; revenue: number; share: number | null };
    cohorts: { quarter: string; customers: number; cameBack: number; rate: number | null; avgSpend: number | null }[];
  };
  sources: Source[];
  leads: { leads: number; booked: number; conversion: number | null; prev: { leads: number; booked: number } | null };
  referrers: { id: string; name: string; referrals: number; referredRevenue: number }[];
  zips: {
    zip: string; town: string | null; miles: number | null; zone: string | null; travelFee: number | null; customers: number;
    repeatRate: number | null; avgTicket: number | null; lifetimeRevenue: number; periodJobs: number; periodRevenue: number; perHour: number | null;
  }[];
  towns: { town: string; customers: number; revenue: number; avgTicket: number | null; zips: string[] }[];
  nearby: { zip: string; town: string; miles: number | null; customers: number; near: string; nearMiles: number }[];
  pipeline: {
    next30: { jobs: number; revenue: number; hours: number; openHours: number; openDays: number; slots: number; from: string; to: string; use: number | null; hoursUse: number | null };
    emptyDays: string[];
    openQuotes: { count: number; value: number; oldestDays: number | null };
    period: { jobs: number; hours: number; openHours: number; openDays: number; use: number | null };
    maxJobsPerDay: number;
  };
  spend: { rows: SpendRow[]; total: number; booksAdvertising: number; notSplit: number };
  actions: Action[];
}

export interface Summary {
  id: string;
  weekStart: string;
  weekEnd: string;
  source: 'claude' | 'rules';
  model: string | null;
  body: string;
  note: string | null;
  emailed: boolean;
  createdAt: string;
}

/* ------------------------------------------------------------ formats */

/** Whole dollars: a report reads cleaner without cents. */
export const usd = (c: number) => `${c < 0 ? '−' : ''}$${Math.round(Math.abs(c) / 100).toLocaleString('en-US')}`;
export const pct = (r: number | null) => (r === null ? '—' : `${Math.round(r * 100)}%`);
export const num = (n: number | null, digits = 0) => (n === null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: digits }));
export const orDash = (c: number | null) => (c === null ? '—' : usd(c));

export const shortDay = (d: string, year = false) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}) }).format(new Date(`${d}T12:00:00Z`));
export const range = (a: string, b: string) => {
  const y = a.slice(0, 4) !== b.slice(0, 4);
  return `${shortDay(a, y)} to ${shortDay(b, true)}`;
};
export const monthLabel = (m: string, long = false) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: long ? 'long' : 'short', year: 'numeric' }).format(new Date(`${m}-15T12:00:00Z`));
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * "+12% vs Aug 1 to Aug 25", or nothing when there's nothing to compare.
 * `upIsGood` false turns a rise red (cancellations).
 */
export function delta(cur: number | null, prev: number | null | undefined, compare: Insights['period']['compare'], upIsGood = true): Child {
  if (!compare || prev === null || prev === undefined || cur === null) return null;
  if (prev === 0 && cur === 0) return h('span', { class: 'text-bone-500' }, 'Same as before');
  if (prev === 0) return h('span', { class: 'text-bone-400' }, 'None before');
  const change = (cur - prev) / Math.abs(prev);
  const good = change === 0 ? null : change > 0 === upIsGood;
  const sign = change > 0 ? '+' : change < 0 ? '−' : '±';
  return h(
    'span',
    { class: good === false ? 'text-red-300' : good ? 'text-bone-200' : 'text-bone-400' },
    `${sign}${Math.abs(Math.round(change * 100))}%`,
    // The picker line names the earlier period; here "before" is enough.
    h('span', { class: 'text-bone-500' }, ' vs before'),
  );
}

/* ------------------------------------------------------------ blocks */

/**
 * A report section: the heading, one line on what it means (the sentence
 * Jacob should take away), and a folded note on how each number is counted.
 */
export function section(title: string, means: Child, counted: string[], ...body: Child[]) {
  return h(
    'section',
    { class: 'mt-16 first:mt-0' },
    h('h2', { class: `${heading} border-b border-ink-700 pb-2`, style: headingStyle }, title),
    means ? h('p', { class: 'mt-4 max-w-3xl border-l-2 border-gold-600 pl-3 text-bone-50' }, means) : null,
    ...body,
    counted.length
      ? h(
          'details',
          { class: 'mt-6 max-w-3xl text-sm text-bone-400' },
          h('summary', { class: `${small} cursor-pointer select-none py-1 hover:text-bone-200` }, 'How these are counted'),
          h('ul', { class: 'mt-2 flex flex-col gap-1.5 border-l border-ink-700 pl-4' }, ...counted.map((c) => h('li', {}, c))),
        )
      : null,
  );
}

/** A small heading inside a section. */
export const part = (title: string, note?: Child) =>
  h('div', { class: 'mt-10' }, h('h3', { class: 'font-display text-sm uppercase tracking-[0.14em] text-gold-400' }, title), note ? h('p', { class: 'mt-1 max-w-2xl text-sm text-bone-400' }, note) : null);

export interface Figure {
  label: string;
  value: string;
  change?: Child;
  sub?: Child;
}

/**
 * A row of figures ruled like a printed statement: hairlines between, no
 * boxes. Two across on a phone, four on a wide screen.
 */
export function figures(items: (Figure | null | false)[]) {
  const list = items.filter((x): x is Figure => !!x);
  return h(
    'dl',
    { class: 'mt-6 grid grid-cols-2 gap-x-6 lg:grid-cols-4' },
    ...list.map((f) =>
      h(
        'div',
        { class: 'min-w-0 border-t border-ink-700 pb-5 pt-3' },
        h('dt', { class: small }, f.label),
        h('dd', { class: 'mt-1 font-display text-bone-50', style: "font-variation-settings:'wdth' 80,'wght' 750;font-size:clamp(1.35rem,3.4vw,1.9rem);line-height:1.1" }, f.value),
        f.change ? h('dd', { class: 'mt-1 text-xs' }, f.change) : null,
        f.sub ? h('dd', { class: 'mt-1 text-xs text-bone-400' }, f.sub) : null,
      ),
    ),
  );
}

export interface Col<T> {
  label: string;
  cell: (row: T) => Child;
  /** Right-aligned numbers. */
  num?: boolean;
  /** Hidden on a phone. */
  wide?: boolean;
}

/** A plain ruled table that scrolls sideways inside itself on a phone, never the page. */
export function table<T>(cols: Col<T>[], rows: T[], opts: { empty?: string; onRow?: (row: T) => void; rowLabel?: (row: T) => string } = {}) {
  if (!rows.length) return h('p', { class: 'mt-3 text-sm text-bone-400' }, opts.empty ?? 'Nothing here yet.');
  const cls = (c: Col<T>) => `${c.num ? 'text-right tabular-nums' : 'text-left'} ${c.wide ? 'hidden sm:table-cell' : ''}`;
  return h(
    'div',
    { class: 'mt-3 max-w-full overflow-x-auto' },
    h(
      'table',
      { class: 'w-full border-collapse text-sm' },
      h('thead', {}, h('tr', { class: 'border-b border-ink-700' }, ...cols.map((c) => h('th', { class: `${small} ${cls(c)} whitespace-nowrap py-2 pr-4 font-normal last:pr-0`, scope: 'col' }, c.label)))),
      h(
        'tbody',
        {},
        ...rows.map((r) => {
          const tr = h('tr', { class: `border-b border-ink-800 ${opts.onRow ? 'cursor-pointer hover:bg-ink-900 focus-visible:bg-ink-900' : ''}` }, ...cols.map((c) => h('td', { class: `${cls(c)} py-2 pr-4 align-top text-bone-200 last:pr-0` }, c.cell(r))));
          if (opts.onRow) {
            tr.tabIndex = 0;
            tr.setAttribute('role', 'link');
            if (opts.rowLabel) tr.setAttribute('aria-label', opts.rowLabel(r));
            tr.addEventListener('click', () => opts.onRow!(r));
            tr.addEventListener('keydown', (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                opts.onRow!(r);
              }
            });
          }
          return tr;
        }),
      ),
    ),
  );
}

/** A thin bar inside a table cell: share of the biggest, gold. */
export function inlineBar(value: number, max: number, label: string) {
  const w = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return h(
    'span',
    { class: 'flex items-center gap-2' },
    h('span', { class: 'relative block h-2 w-20 shrink-0 bg-ink-800 sm:w-32', 'aria-hidden': 'true' }, h('span', { class: 'absolute inset-y-0 left-0 bg-gold-500', style: `width:${Math.round(w * 100)}%` })),
    h('span', { class: 'tabular-nums' }, label),
  );
}

/** A meter: how much of a limit is used. The track is the same bar, one step lighter. */
export function meter(use: number | null, label: string) {
  const w = use === null ? 0 : Math.max(0, Math.min(1, use));
  return h(
    'div',
    { class: 'mt-4 max-w-xl' },
    h('div', { class: 'relative h-3 bg-ink-700', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(w * 100)), 'aria-label': label },
      h('div', { class: 'absolute inset-y-0 left-0 bg-gold-500', style: `width:${Math.round(w * 100)}%` })),
    h('p', { class: 'mt-2 text-sm text-bone-200' }, label),
  );
}

/* ------------------------------------------------------------ chart */

const SVG = 'http://www.w3.org/2000/svg';
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** Round a max up to a clean tick step: 1, 2 or 5 times a power of ten. */
function niceStep(max: number, ticks = 3) {
  const raw = max / ticks;
  const pow = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

export interface Column {
  key: string;
  /** Under the column; blank to skip. */
  tick: string;
  value: number;
  /** In the highlighted set (gold); the rest are context (gray). */
  on: boolean;
  /** Tooltip lines: the value first, then what it is. */
  tip: [string, string];
}

/**
 * Columns over time, one series. The months that matter are gold, the rest
 * gray (emphasis, not categories). Hover or focus a column for its numbers;
 * the table under the chart has every value too.
 */
export function columns(cols: Column[], opts: { label: string; money?: boolean }) {
  // Drawn at about the size it shows, so the labels stay readable on a phone.
  const W = Math.round(Math.max(320, Math.min(720, (typeof window === 'undefined' ? 720 : window.innerWidth) - 40)));
  const H = W < 500 ? 170 : 200;
  const pad = { l: 44, r: 4, t: 10, b: 24 };
  const max = Math.max(1, ...cols.map((c) => c.value));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const band = (W - pad.l - pad.r) / Math.max(1, cols.length);
  const bw = Math.min(24, Math.max(3, band - 2));
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / top);

  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': opts.label, class: 'block h-auto overflow-visible' });
  for (let v = 0; v <= top + 1e-9; v += step) {
    root.append(svg('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: 'stroke-ink-800', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' }));
    const t = svg('text', { x: pad.l - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'fill-bone-500 text-[11px] tabular-nums' });
    t.textContent = opts.money ? usd(v) : num(v);
    root.append(t);
  }

  const tip = h('div', { class: 'pointer-events-none absolute z-10 hidden whitespace-nowrap border border-ink-700 bg-ink-950 px-2.5 py-1.5 text-xs shadow-lg', role: 'status' });
  const wrap = h('div', { class: 'relative mt-4' });
  const show = (c: Column, x: number, rect: SVGRectElement) => {
    tip.replaceChildren(h('div', { class: 'font-semibold tabular-nums text-bone-50' }, c.tip[0]), h('div', { class: 'text-bone-400' }, c.tip[1]));
    tip.classList.remove('hidden');
    const box = wrap.getBoundingClientRect();
    const r = rect.getBoundingClientRect();
    const left = Math.min(Math.max(0, r.left - box.left + r.width / 2 - tip.offsetWidth / 2), box.width - tip.offsetWidth);
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(0, r.top - box.top - tip.offsetHeight - 6)}px`;
    rect.classList.add('opacity-80');
    void x;
  };
  const hide = (rect: SVGRectElement) => {
    tip.classList.add('hidden');
    rect.classList.remove('opacity-80');
  };

  cols.forEach((c, i) => {
    const cx = pad.l + band * i + band / 2;
    const h0 = y(0);
    const hv = y(c.value);
    if (c.value > 0) {
      // Square at the baseline, 4px round at the data end.
      const r = Math.min(4, bw / 2, h0 - hv);
      const x0 = cx - bw / 2;
      const d = `M${x0},${h0} V${hv + r} Q${x0},${hv} ${x0 + r},${hv} H${x0 + bw - r} Q${x0 + bw},${hv} ${x0 + bw},${hv + r} V${h0} Z`;
      root.append(svg('path', { d, class: c.on ? 'fill-gold-500' : 'fill-bone-500' }));
    }
    if (c.tick) {
      const t = svg('text', { x: cx, y: H - 6, 'text-anchor': 'middle', class: 'fill-bone-500 text-[11px]' });
      t.textContent = c.tick;
      root.append(t);
    }
    // The hit area is the whole band, full height: easier than the bar itself.
    const hit = svg('rect', { x: pad.l + band * i, y: pad.t, width: band, height: H - pad.t - pad.b, fill: 'transparent', tabindex: 0, 'aria-label': `${c.tip[1]}: ${c.tip[0]}`, class: 'outline-none focus-visible:stroke-gold-400' }) as SVGRectElement;
    hit.addEventListener('pointerenter', () => show(c, cx, hit));
    hit.addEventListener('pointerleave', () => hide(hit));
    hit.addEventListener('focus', () => show(c, cx, hit));
    hit.addEventListener('blur', () => hide(hit));
    root.append(hit);
  });
  root.append(svg('line', { x1: pad.l, x2: W - pad.r, y1: y(0), y2: y(0), class: 'stroke-ink-600', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' }));
  wrap.append(root, tip);
  return wrap;
}

/** Key for an emphasis chart: what gold means and what gray means. */
export const chartKey = (on: string, off: string) =>
  h(
    'p',
    { class: 'mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-bone-400' },
    h('span', { class: 'inline-flex items-center gap-1.5' }, h('span', { class: 'inline-block size-2.5 bg-gold-500', 'aria-hidden': 'true' }), on),
    h('span', { class: 'inline-flex items-center gap-1.5' }, h('span', { class: 'inline-block size-2.5 bg-bone-500', 'aria-hidden': 'true' }), off),
  );

/** "See the numbers": the chart as a table, folded. */
export const numbersFor = (content: HTMLElement) =>
  h('details', { class: 'mt-2' }, h('summary', { class: `${small} cursor-pointer select-none py-1 hover:text-bone-200` }, 'See the numbers'), content);
