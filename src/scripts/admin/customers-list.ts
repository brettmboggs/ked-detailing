/**
 * The customer list as a CRM: quick views (best customers, regulars, people
 * who haven't been back, new, never booked), filters, sorting and a CSV
 * export. The numbers come from GET /v1/crm/customers?segment=… (one query on
 * the server, crm-segments.ts).
 */
import { API, token, h, api, input, small, sectionHead, dollars, checkbox, clearError, showError, Failed } from './core';
import { textButton } from './calendar-shared';
import { type Person, SOURCES, serviceNames, shortDate, sourceName, tagLine, tabBar, todayLocal, localDay } from './customers-shared';

type ViewKey = 'everyone' | 'best' | 'regulars' | 'lapsed' | 'new' | 'leads';
type Sort = 'spend' | 'recent' | 'visits' | 'name' | 'newest';

const VIEWS: { key: ViewKey; name: string; seg: Record<string, unknown>; sort: Sort; tip: string }[] = [
  { key: 'everyone', name: 'Everyone', seg: {}, sort: 'recent', tip: 'Everyone who booked or asked for a quote. Most recent visit first.' },
  { key: 'best', name: 'Best customers', seg: { lifecycle: 'customer' }, sort: 'spend', tip: 'Who spent the most. Treat these people well: first pick of dates, a thank-you text, a small extra on their next detail.' },
  { key: 'regulars', name: 'Regulars', seg: { lifecycle: 'repeat' }, sort: 'visits', tip: 'They came back at least twice. Ask each one to book their next visit before you leave.' },
  { key: 'lapsed', name: "Haven't been back", seg: { lifecycle: 'lapsed' }, sort: 'spend', tip: 'Had a job with you, nothing booked, and the last one was over 6 months ago. Text them: "It\'s been a while, want me to come by?"' },
  { key: 'new', name: 'New this month', seg: {}, sort: 'newest', tip: 'New people this month. A thank-you text after their first job is how a one-time customer becomes a regular.' },
  { key: 'leads', name: 'Never booked', seg: { lifecycle: 'lead' }, sort: 'newest', tip: 'Asked for a quote but never booked. Call or text them: many just need a nudge or a date.' },
];

const SORTS: [Sort, string][] = [
  ['spend', 'Most spent'],
  ['recent', 'Last visit'],
  ['visits', 'Most visits'],
  ['name', 'Name A to Z'],
  ['newest', 'Newest'],
];

/** Kept while Jacob opens someone and comes back. */
const state = {
  view: 'everyone' as ViewKey,
  sort: null as Sort | null,
  q: '',
  source: '',
  tag: '',
  zip: '',
  service: '',
  minSpend: '',
  maxSpend: '',
  minVisits: '',
  maxVisits: '',
  canEmail: false,
  canText: false,
  open: false,
};

const FILTER_KEYS = ['source', 'tag', 'zip', 'service', 'minSpend', 'maxSpend', 'minVisits', 'maxVisits', 'canEmail', 'canText'] as const;
const filterCount = () => FILTER_KEYS.filter((k) => !!state[k]).length;
const monthStart = () => `${todayLocal().slice(0, 7)}-01`;

function segment(): Record<string, unknown> {
  const v = VIEWS.find((x) => x.key === state.view)!;
  const dollarsToCents = (s: string) => (s.trim() === '' ? undefined : Math.round(Number(s) * 100));
  const num = (s: string) => (s.trim() === '' ? undefined : Number(s));
  const zips = state.zip.split(/[\s,]+/).map((z) => z.replace(/\D/g, '')).filter(Boolean);
  return {
    ...v.seg,
    // On the server too, so the CSV export matches the list.
    createdAfter: state.view === 'new' ? monthStart() : undefined,
    sort: state.sort ?? v.sort,
    q: state.q || undefined,
    sources: state.source ? [state.source] : undefined,
    tags: state.tag ? [state.tag] : undefined,
    zips: zips.length ? zips : undefined,
    services: state.service ? [state.service] : undefined,
    minSpend: dollarsToCents(state.minSpend),
    maxSpend: dollarsToCents(state.maxSpend),
    minVisits: num(state.minVisits),
    maxVisits: num(state.maxVisits),
    canEmail: state.canEmail || undefined,
    canText: state.canText || undefined,
  };
}

/** "New this month": added this month and not an older customer brought in by an import. */
const isNew = (p: Person) => localDay(p.createdAt) >= monthStart() && (!p.firstVisit || p.firstVisit >= monthStart());

export async function drawList(view: HTMLElement, go: { open: (id: string) => void; duplicates: () => void }) {
  const [tags, names] = await Promise.all([
    api<{ tags: { tag: string; count: number }[] }>('/crm/customers/tags').then((r) => r.tags).catch(() => []),
    serviceNames(),
  ]);

  const results = h('div', { 'aria-live': 'polite' });
  const summary = h('p', { class: 'mt-4 text-sm text-bone-200' });
  const tip = h('p', { class: 'mt-1 max-w-3xl text-sm text-bone-400' });
  let seq = 0;

  const load = async () => {
    const mine = ++seq;
    const seg = segment();
    let people = (await api<{ customers: Person[] }>(`/crm/customers?segment=${encodeURIComponent(JSON.stringify(seg))}`)).customers;
    if (mine !== seq) return;
    const capped = people.length >= 500;
    if (state.view === 'new') people = people.filter(isNew);
    const total = people.reduce((s, p) => s + p.spend, 0);
    const visits = people.reduce((s, p) => s + p.visits, 0);
    summary.replaceChildren(
      h('span', { class: 'font-semibold text-bone-50' }, `${people.length}${capped ? '+' : ''} ${people.length === 1 ? 'person' : 'people'}`),
      total ? ` · ${dollars(total)} spent in all` : '',
      visits ? ` · ${dollars(Math.round(total / visits / 100) * 100)} a visit on average` : '',
    );
    tip.textContent = VIEWS.find((v) => v.key === state.view)!.tip;
    results.replaceChildren(
      people.length
        ? h('div', {}, headerRow(), h('ul', { class: 'border-t border-ink-800 sm:border-t-0' }, ...people.map((p) => row(p, names, () => go.open(p.id)))))
        : h('p', { class: 'border-t border-ink-800 py-6 text-bone-400' }, emptyText()),
      capped ? h('p', { class: 'mt-3 text-sm text-bone-500' }, 'Showing the first 500. Search or filter to find someone else.') : '',
    );
  };
  const reload = () => void load().catch(showError);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const reloadSoon = () => (clearTimeout(timer), (timer = setTimeout(reload, 250)));

  /* ---------------------------------------------------------- controls */

  const search = h('input', { type: 'search', class: input, placeholder: 'Name, phone or email', 'aria-label': 'Find a customer', autocomplete: 'off' }) as HTMLInputElement;
  search.value = state.q;
  search.addEventListener('input', () => ((state.q = search.value.trim()), reloadSoon()));

  const sortSel = select(SORTS, state.sort ?? VIEWS.find((v) => v.key === state.view)!.sort, 'Sort by');
  sortSel.addEventListener('change', () => ((state.sort = sortSel.value as Sort), reload()));

  const views = h('div', { class: 'mt-6' });
  const drawViews = () =>
    views.replaceChildren(
      tabBar(VIEWS.map((v) => [v.key, v.name] as [ViewKey, string]), state.view, (k) => {
        state.view = k;
        state.sort = null;
        sortSel.value = VIEWS.find((v) => v.key === k)!.sort;
        drawViews();
        reload();
      }, 'Show'),
    );
  drawViews();

  const filtersBtn = h('button', { type: 'button', class: textButton, 'aria-expanded': String(state.open) }) as HTMLButtonElement;
  const panel = h('div', { class: 'mt-4 border-t border-ink-800 pt-4' });
  const drawFiltersBtn = () => {
    const n = filterCount();
    filtersBtn.textContent = `${state.open ? 'Hide filters' : 'More filters'}${n ? ` (${n} on)` : ''}`;
    filtersBtn.setAttribute('aria-expanded', String(state.open));
    panel.hidden = !state.open;
  };
  filtersBtn.addEventListener('click', () => ((state.open = !state.open), drawFiltersBtn()));

  const bind = (el: HTMLInputElement | HTMLSelectElement, key: (typeof FILTER_KEYS)[number], soon = false) => {
    el.value = String(state[key]);
    el.addEventListener(el instanceof HTMLSelectElement ? 'change' : 'input', () => {
      (state as Record<string, unknown>)[key] = el.value;
      drawFiltersBtn();
      soon ? reloadSoon() : reload();
    });
    return el;
  };
  const numberBox = (key: (typeof FILTER_KEYS)[number], label: string, placeholder: string) =>
    bind(h('input', { type: 'number', min: '0', step: '1', inputmode: 'numeric', class: input, placeholder, 'aria-label': label }) as HTMLInputElement, key, true);

  const sourceSel = bind(select([['', 'Anywhere'], ...SOURCES], state.source, 'Heard about us from'), 'source');
  const tagSel = bind(select([['', 'Any tag'], ...tags.map((t) => [t.tag, `${t.tag} (${t.count})`] as [string, string])], state.tag, 'Tag'), 'tag');
  const serviceSel = bind(select([['', 'Any service'], ...[...names].map(([id, name]) => [id, name] as [string, string])], state.service, 'Had this service'), 'service');
  const zip = bind(h('input', { type: 'text', inputmode: 'numeric', class: input, placeholder: '63122, 631', 'aria-label': 'ZIP codes' }) as HTMLInputElement, 'zip', true);

  const lbl = (label: string, ...controls: HTMLElement[]) =>
    h('label', { class: 'flex flex-col gap-1' }, h('span', { class: small }, label), controls.length > 1 ? h('span', { class: 'grid grid-cols-[1fr_auto_1fr] items-center gap-2' }, controls[0]!, h('span', { class: 'text-sm text-bone-500' }, 'to'), controls[1]!) : controls[0]!);

  const emailBox = checkbox('Can get email', () => state.canEmail, (v) => ((state.canEmail = v), drawFiltersBtn(), reload()));
  const textBox = checkbox('OK to text', () => state.canText, (v) => ((state.canText = v), drawFiltersBtn(), reload()));

  const clear = h('button', {
    type: 'button',
    class: textButton,
    onclick: () => {
      for (const k of FILTER_KEYS) (state as Record<string, unknown>)[k] = typeof state[k] === 'boolean' ? false : '';
      void drawList(view, go).catch(showError);
    },
  }, 'Clear filters');

  panel.append(
    h(
      'div',
      { class: 'grid gap-4 sm:grid-cols-2 lg:grid-cols-4' },
      lbl('Heard about us from', sourceSel),
      lbl('Tag', tagSel),
      lbl('Had this service', serviceSel),
      lbl('ZIP code (or start of one)', zip),
      lbl('Spent ($)', numberBox('minSpend', 'Spent at least', 'Any'), numberBox('maxSpend', 'Spent at most', 'Any')),
      lbl('Visits', numberBox('minVisits', 'At least this many visits', 'Any'), numberBox('maxVisits', 'At most this many visits', 'Any')),
      h('div', { class: 'flex flex-col justify-end gap-2 pb-1' }, emailBox, textBox),
      h('div', { class: 'flex items-end pb-1' }, clear),
    ),
  );
  drawFiltersBtn();

  /* ---------------------------------------------------------- export */

  const exportStatus = h('span', { class: 'text-sm text-bone-400', role: 'status' });
  const exportBtn = h('button', { type: 'button', class: textButton }, 'Download as a spreadsheet') as HTMLButtonElement;
  exportBtn.addEventListener('click', async () => {
    clearError();
    exportBtn.disabled = true;
    exportStatus.textContent = 'Getting it ready…';
    try {
      await download(`/crm/customers/export?segment=${encodeURIComponent(JSON.stringify(segment()))}`);
      exportStatus.textContent = state.view === 'new' ? 'Downloaded. It has everyone matching your filters, not only new people.' : 'Downloaded.';
    } catch (err) {
      exportStatus.textContent = '';
      showError(err);
    } finally {
      exportBtn.disabled = false;
    }
  });

  view.replaceChildren(
    sectionHead('Customers', 'Everyone who booked or asked for a quote, with what they spent. Tap a name to see everything about them.'),
    h(
      'div',
      { class: 'flex flex-col gap-3 sm:flex-row sm:items-end' },
      h('label', { class: 'flex flex-1 flex-col gap-1 sm:max-w-md' }, h('span', { class: small }, 'Find'), search),
      h('label', { class: 'flex flex-col gap-1 sm:w-48' }, h('span', { class: small }, 'Sort by'), sortSel),
    ),
    views,
    h('div', { class: 'flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2' }, h('div', {}, summary, tip), h('div', { class: 'mt-4 flex flex-wrap items-center gap-x-5 gap-y-2' }, filtersBtn, exportBtn, h('button', { type: 'button', class: textButton, onclick: go.duplicates }, 'Find duplicates'), exportStatus)),
    panel,
    h('div', { class: 'mt-6' }, results),
  );
  await load();
}

function emptyText() {
  if (filterCount() || state.q) return 'Nobody matches. Try fewer filters.';
  return {
    everyone: 'No customers yet. They show up here once someone books or asks for a quote.',
    best: 'No finished jobs yet.',
    regulars: 'Nobody has come back twice yet.',
    lapsed: "Everyone's been back recently or has something booked. Nice.",
    new: 'Nobody new this month yet.',
    leads: 'Everyone who asked for a quote has booked.',
  }[state.view];
}

/* ------------------------------------------------------------ rows */

const COLS = 'sm:grid-cols-[minmax(0,1fr)_6.5rem_3.5rem_7rem_7rem] lg:grid-cols-[minmax(0,1fr)_7rem_4rem_8rem_8rem_10rem]';

function headerRow() {
  const c = 'text-xs uppercase tracking-[0.14em] text-bone-500';
  return h(
    'div',
    { class: `hidden gap-x-4 border-b border-ink-800 px-1 pb-2 sm:grid ${COLS}`, 'aria-hidden': 'true' },
    h('span', { class: c }, 'Name'),
    h('span', { class: `${c} text-right` }, 'Spent'),
    h('span', { class: `${c} text-right` }, 'Visits'),
    h('span', { class: c }, 'Last visit'),
    h('span', { class: c }, 'Next booked'),
    h('span', { class: `${c} hidden lg:block` }, 'Came from'),
  );
}

function row(p: Person, names: Map<string, string>, open: () => void) {
  const last = shortDate(p.lastVisit);
  const next = p.nextVisit ? shortDate(localDay(p.nextVisit)) : null;
  const src = sourceName(p.source);
  const service = p.lastService ? names.get(p.lastService) ?? null : null;
  return h(
    'li',
    {},
    h(
      'button',
      {
        type: 'button',
        class: `grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 border-b border-ink-800 px-1 py-3 text-left transition-colors hover:bg-ink-900 focus-visible:outline-2 focus-visible:outline-gold-400 ${COLS} sm:items-baseline`,
        onclick: open,
      },
      // Name, with tags (and on a phone, the rest) under it.
      h(
        'span',
        { class: 'min-w-0' },
        h('span', { class: 'block truncate font-semibold text-bone-50' }, p.name),
        h(
          'span',
          { class: 'block text-sm text-bone-400 sm:hidden' },
          [
            p.visits ? `${p.visits} ${p.visits === 1 ? 'visit' : 'visits'}` : 'Never booked',
            last ? `last ${last}` : null,
            next ? `next ${next}` : null,
          ]
            .filter(Boolean)
            .join(' · '),
        ),
        h('span', { class: 'block truncate text-sm text-bone-500 sm:hidden' }, [src, service].filter(Boolean).join(' · ')),
        p.tags.length ? tagLine(p.tags, 'mt-1.5') : null,
      ),
      h('span', { class: `text-right tabular-nums ${p.spend ? 'text-bone-50' : 'text-bone-500'}` }, p.spend ? dollars(p.spend) : '$0'),
      h('span', { class: 'hidden text-right tabular-nums text-bone-200 sm:block' }, String(p.visits)),
      h('span', { class: 'hidden text-sm tabular-nums text-bone-200 sm:block' }, last ?? h('span', { class: 'text-bone-500' }, 'None')),
      h('span', { class: `hidden text-sm tabular-nums sm:block ${next ? 'text-gold-400' : 'text-bone-500'}` }, next ?? 'Nothing'),
      h('span', { class: 'hidden truncate text-sm text-bone-400 lg:block' }, src ?? h('span', { class: 'text-bone-500' }, 'Not known')),
    ),
  );
}

/* ------------------------------------------------------------ helpers */

function select(options: [string, string][], value: string, label: string) {
  const el = h('select', { class: input, 'aria-label': label }, ...options.map(([v, l]) => h('option', { value: v }, l))) as HTMLSelectElement;
  el.value = value;
  return el;
}

/** Fetch with the session and save the file, since a plain link can't send the Authorization header. */
async function download(path: string) {
  const res = await fetch(`${API}/v1${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Failed(body?.error?.message ?? `Couldn't download it (${res.status}).`);
  }
  // Content-Disposition isn't readable across origins, so the name is made here.
  const name = `ked-customers-${todayLocal()}.csv`;
  const url = URL.createObjectURL(await res.blob());
  const a = h('a', { href: url, download: name, class: 'hidden' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
