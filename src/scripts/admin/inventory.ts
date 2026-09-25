/**
 * Inventory: what's in the van. A list with what's running low first, a
 * search box that also takes barcode scans, adding and editing items, stock
 * changes (only ever as logged movements, so every number has a reason), each
 * item's history, and each package's usual products.
 *
 * Helpers live in inventory-shared.ts, scanning in inventory-scan.ts and the
 * per-package products in inventory-usage.ts.
 */
import { API, token, h, $, api, when, field, checkbox, small, ghost, input, sectionHead } from './core';
import {
  type Item,
  type Movement,
  type Reason,
  amount,
  busy,
  choice,
  codeMatches,
  costText,
  looksLikeCode,
  money,
  normalizeCode,
  printedCode,
  qty,
  say,
  scrollToEl,
  statusLine,
  subhead,
} from './inventory-shared';
import { type ScanBar, listenForScanner, scanBar, stopCamera } from './inventory-scan';
import { usageSection } from './inventory-usage';

interface Draft {
  name: string;
  unit: string;
  barcode: string;
  onHand: number | null;
  reorderAt: number | null;
  cost: number | null;
  reorderUrl: string;
  notes: string;
}

const blankDraft = (over: Partial<Draft> = {}): Draft => ({
  name: '',
  unit: '',
  barcode: '',
  onHand: null,
  reorderAt: null,
  cost: null,
  reorderUrl: '',
  notes: '',
  ...over,
});

/** core's field() takes a numeric step; counts can be any fraction (0.25 gal). */
const ANY = 'any' as unknown as number;

const UNITS = ['each', 'bottle', 'gal', 'qt', 'oz', 'can', 'box', 'pack', 'pad', 'towel'];

const state = {
  items: [] as Item[],
  query: '',
  openId: null as string | null,
  showHidden: false,
  adding: null as Draft | null,
  mode: 'used' as Reason,
  /** A message to show in the open item after the list redraws. */
  flash: null as { id: string; text: string } | null,
};

let scan: ScanBar;
let summaryEl: HTMLElement;
let addEl: HTMLElement;
let listEl: HTMLElement;
let hiddenBox: HTMLInputElement;
let usage: ReturnType<typeof usageSection>;

export async function renderInventory() {
  const view = $('[data-view="inventory"]');
  stopCamera();
  Object.assign(state, { query: '', openId: null, adding: null, flash: null, mode: 'used' });
  usage = usageSection(() => state.items);
  await Promise.all([reload(false), usage.load()]);

  scan = scanBar({
    onType: (q) => {
      state.query = q;
      drawList();
    },
    onSubmit: submitSearch,
    onCode: (code) => void find(code),
  });
  listenForScanner(view, (code) => void find(code));
  summaryEl = h('div', { class: 'mt-6 flex flex-wrap items-center justify-between gap-3 border-b border-ink-800 pb-4' });
  addEl = h('div', {});
  listEl = h('div', {});
  const showHidden = checkbox('Show hidden items', () => state.showHidden, (v) => {
    state.showHidden = v;
    void reload();
  });
  hiddenBox = showHidden.querySelector('input')!;

  view.replaceChildren(
    sectionHead('Inventory', "What's in the van. Scan a barcode or type a name to find something. Counts only change when you say why, so you can always see what happened."),
    scan.el,
    summaryEl,
    addEl,
    listEl,
    h('div', { class: 'mt-6' }, showHidden),
    usage.el,
    h('datalist', { id: 'inventory-units' }, ...UNITS.map((u) => h('option', { value: u }))),
  );
  drawSummary();
  drawAdd();
  drawList();
}

async function reload(draw = true) {
  const { items } = await api<{ items: Item[] }>(`/inventory${state.showHidden ? '?archived=true' : ''}`);
  state.items = items;
  if (!draw) return;
  drawSummary();
  drawList();
  usage.draw();
}

/* ------------------------------------------------------------ finding */

function submitSearch(q: string) {
  if (!q) return;
  if (looksLikeCode(q)) return void find(q);
  const hits = visible();
  if (hits.length === 1) return open(hits[0]!, true);
  if (!hits.length) void find(q);
}

/** Look a code up: the loaded list first, then the server (which also knows hidden items). */
async function find(raw: string) {
  const code = raw.trim();
  if (!code) return;
  const norm = normalizeCode(code);
  const local = state.items.find((i) => i.barcode === norm);
  if (local) return open(local, true);
  scan.say('Looking…');
  try {
    const res = await fetch(`${API}/v1/inventory/barcode/${encodeURIComponent(code)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (res.status === 404) return unknown(code);
    // Anything else goes the usual way, so errors and sign-outs are handled once.
    const item = res.ok ? ((await res.json()) as Item) : await api<Item>(`/inventory/barcode/${encodeURIComponent(code)}`);
    if (item.archived && !state.showHidden) {
      state.showHidden = true;
      await reload();
      hiddenBox.checked = true;
    }
    open(state.items.find((i) => i.id === item.id) ?? item, true);
  } catch (err) {
    scan.say(h('span', { class: 'text-red-300' }, (err as Error).message));
  }
}

function unknown(code: string) {
  const isCode = looksLikeCode(code) || !/\s/.test(code);
  scan.clear();
  scan.say(
    isCode ? `No item has the barcode ${printedCode(normalizeCode(code))} yet. ` : `Nothing called “${code}”. `,
    h(
      'button',
      {
        type: 'button',
        class: 'text-gold-400 underline decoration-gold-600 underline-offset-4 hover:text-gold-500',
        onclick: () => startAdding(isCode && looksLikeCode(code) ? { barcode: code } : { name: code }),
      },
      'Add it',
    ),
  );
  scan.input.focus();
}

/** Open an item's panel; from a scan, clear the box and keep it focused for the next one. */
function open(item: Item, fromScan = false) {
  state.openId = item.id;
  if (fromScan) {
    scan.clear();
    scan.say('Found ', h('span', { class: 'text-bone-50' }, item.name), '.');
    scan.input.focus({ preventScroll: true });
  }
  drawList();
  const row = listEl.querySelector(`[data-item="${item.id}"]`);
  if (row) scrollToEl(row);
}

function visible() {
  const q = state.query.trim().toLowerCase();
  if (!q) return state.items;
  return state.items.filter((i) => i.name.toLowerCase().includes(q) || codeMatches(i, q) || (i.notes ?? '').toLowerCase().includes(q));
}

/* ------------------------------------------------------------ summary + add */

function drawSummary() {
  const live = state.items.filter((i) => !i.archived);
  const low = live.filter((i) => i.low).length;
  const worth = Math.round(live.reduce((s, i) => s + (i.cost ?? 0) * Math.max(i.onHand, 0), 0));
  summaryEl.replaceChildren(
    h(
      'p',
      { class: 'text-sm text-bone-200' },
      `${live.length} ${live.length === 1 ? 'item' : 'items'}`,
      low ? h('span', { class: 'text-gold-400' }, ` · ${low} running low`) : ' · nothing running low',
      worth ? ` · about ${money(worth)} on the shelf` : '',
    ),
    h('button', { type: 'button', class: ghost, onclick: () => startAdding() }, 'Add an item'),
  );
}

function startAdding(over: Partial<Draft> = {}) {
  state.adding = blankDraft(over);
  drawAdd();
  scrollToEl(addEl);
  addEl.querySelector<HTMLInputElement>(over.name ? 'input[aria-label="Unit"]' : 'input')?.focus({ preventScroll: true });
}

function drawAdd() {
  const d = state.adding;
  if (!d) return addEl.replaceChildren();
  const status = statusLine();
  const wide = (el: HTMLElement) => (el.classList.add('col-span-2'), el);
  const code = field('Barcode', () => d.barcode, (v) => (d.barcode = String(v)), { kind: 'text', blank: 'Scan or type it' });
  // A scanner ends with Enter: move on instead of saving a half-filled form.
  code.querySelector('input')!.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    addEl.querySelector<HTMLInputElement>('input[aria-label="How many now"]')?.focus();
  });
  const unit = field('Unit', () => d.unit, (v) => (d.unit = String(v)), { kind: 'text', blank: 'each' });
  unit.querySelector('input')!.setAttribute('list', 'inventory-units');

  const save = h('button', { type: 'submit', class: 'btn-gold' }, 'Save item') as HTMLButtonElement;
  const form = h(
    'form',
    {
      class: 'border-b border-ink-800 py-6',
      novalidate: true,
      onsubmit: (e: Event) => {
        e.preventDefault();
        if (!d.name.trim()) return say(status, h('span', { class: 'text-red-300' }, 'Give it a name first.'));
        void busy(save, status, async () => {
          const item = await api<Item>('/inventory', {
            method: 'POST',
            body: {
              name: d.name,
              unit: d.unit.trim() || undefined,
              barcode: d.barcode.trim() || undefined,
              onHand: d.onHand ?? undefined,
              reorderAt: d.reorderAt,
              cost: d.cost ?? undefined,
              reorderUrl: d.reorderUrl.trim() || undefined,
              notes: d.notes.trim() || undefined,
            },
          });
          state.adding = null;
          state.flash = { id: item.id, text: `Added ${item.name}.` };
          drawAdd();
          await reload();
          open(item);
        });
      },
    },
    subhead('New item'),
    h(
      'div',
      { class: 'grid grid-cols-2 gap-3 sm:grid-cols-4' },
      wide(field('Name', () => d.name, (v) => (d.name = String(v)), { kind: 'text', blank: 'Like "Tire shine"' })),
      unit,
      code,
      field('How many now', () => d.onHand, (v) => (d.onHand = v as number | null), { step: ANY, min: 0, blank: '0' }),
      field('Order more at', () => d.reorderAt, (v) => (d.reorderAt = v as number | null), { step: ANY, min: 0, blank: 'Never' }),
      field('Cost each ($)', () => d.cost, (v) => (d.cost = v as number | null), { kind: 'money', blank: 'Not sure' }),
      wide(field('Where to buy it (link)', () => d.reorderUrl, (v) => (d.reorderUrl = String(v)), { kind: 'text', blank: 'https://…' })),
      wide(field('Notes', () => d.notes, (v) => (d.notes = String(v)), { kind: 'text' })),
    ),
    h('p', { class: 'mt-3 text-sm text-bone-400' }, '“Order more at” puts it on the running-low list when the count gets that low.'),
    h(
      'div',
      { class: 'mt-5 flex flex-wrap items-center gap-4' },
      save,
      h(
        'button',
        {
          type: 'button',
          class: 'text-sm text-bone-400 underline decoration-ink-600 underline-offset-4 hover:text-bone-50',
          onclick: () => {
            state.adding = null;
            drawAdd();
          },
        },
        'Cancel',
      ),
      status,
    ),
  );
  addEl.replaceChildren(form);
}

/* ------------------------------------------------------------ the list */

function drawList() {
  const shown = visible();
  const low = shown.filter((i) => !i.archived && i.low);
  const rest = shown.filter((i) => !i.archived && !i.low);
  const hidden = shown.filter((i) => i.archived);

  if (!state.items.length) {
    listEl.replaceChildren(h('p', { class: 'mt-6 text-bone-400' }, state.showHidden ? 'No items yet.' : 'No items yet. Add the first one, or scan its barcode.'));
    return;
  }
  if (!shown.length) {
    listEl.replaceChildren(h('p', { class: 'mt-6 text-bone-400' }, `Nothing matches “${state.query.trim()}”. Press Enter to look it up as a barcode.`));
    return;
  }
  const group = (title: string, tone: string, items: Item[]) =>
    items.length
      ? h(
          'div',
          { class: 'mt-8' },
          h('h3', { class: `mb-1 font-display text-sm uppercase tracking-[0.14em] ${tone}` }, title),
          h(
            'div',
            { class: `hidden grid-cols-[1fr_8rem_8rem_9rem] gap-4 border-b border-ink-800 py-2 sm:grid` },
            ...['Item', 'On hand', 'Order more at', 'Cost'].map((t) => h('span', { class: small }, t)),
          ),
          h('ul', { class: 'border-t border-ink-800 sm:border-t-0' }, ...items.map(row)),
        )
      : null;
  listEl.replaceChildren(
    ...[group('Running low', 'text-gold-400', low), group(low.length ? 'Everything else' : 'Everything', 'text-bone-200', rest), group('Hidden', 'text-bone-500', hidden)].filter(
      (g): g is HTMLDivElement => !!g,
    ),
  );
}

function row(item: Item) {
  const isOpen = state.openId === item.id;
  const orderAt = item.reorderAt === null ? '—' : amount(item.reorderAt, item.unit);
  const head = h(
    'button',
    {
      type: 'button',
      'aria-expanded': String(isOpen),
      class:
        'grid w-full grid-cols-[1fr_auto] items-baseline gap-x-4 gap-y-0.5 py-3 text-left transition-colors hover:bg-ink-900/60 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-gold-400 ' +
        'sm:grid-cols-[1fr_8rem_8rem_9rem] sm:gap-4',
      onclick: () => {
        state.openId = isOpen ? null : item.id;
        drawList();
      },
    },
    h(
      'span',
      { class: 'min-w-0' },
      h('span', { class: `block ${item.archived ? 'text-bone-400' : 'text-bone-50'}` }, item.name),
      h('span', { class: 'block text-sm text-bone-400 sm:hidden' }, [item.reorderAt === null ? null : `Order at ${qty(item.reorderAt)}`, item.cost === null ? null : costText(item)].filter(Boolean).join(' · ')),
    ),
    h(
      'span',
      { class: `text-right tabular-nums sm:text-left ${item.low && !item.archived ? 'text-gold-400' : 'text-bone-50'}` },
      amount(item.onHand, item.unit),
      item.low && !item.archived ? h('span', { class: 'block text-xs uppercase tracking-[0.14em]' }, 'Order more') : null,
    ),
    h('span', { class: 'hidden tabular-nums text-bone-200 sm:block' }, orderAt),
    h('span', { class: 'hidden tabular-nums text-bone-200 sm:block' }, item.cost === null ? '—' : costText(item)),
  );
  return h('li', { class: 'border-b border-ink-800', 'data-item': item.id }, head, isOpen ? panel(item) : null);
}

/* ------------------------------------------------------------ one item */

function panel(item: Item) {
  const flash = state.flash?.id === item.id ? state.flash.text : '';
  state.flash = null;
  const facts = [
    item.barcode ? h('span', {}, 'Barcode ', h('span', { class: 'tabular-nums text-bone-200' }, printedCode(item.barcode))) : h('span', {}, 'No barcode'),
    item.reorderUrl
      ? h('a', { href: item.reorderUrl, target: '_blank', rel: 'noopener noreferrer', class: 'text-gold-400 underline decoration-gold-600 underline-offset-4 hover:text-gold-500' }, 'Order more online ↗')
      : null,
    item.notes ? h('span', { class: 'italic' }, item.notes) : null,
  ].filter((f): f is HTMLElement => !!f);

  return h(
    'div',
    { class: 'mb-4 border-l-2 border-gold-500 bg-ink-900/60 px-3 py-5 sm:px-6' },
    h('p', { class: 'mb-5 flex flex-wrap gap-x-5 gap-y-1 text-sm text-bone-400' }, ...facts),
    item.archived
      ? h('p', { class: 'mb-6 text-sm text-bone-400' }, 'This item is hidden. Bring it back (under Details) to change its count.')
      : countForm(item, flash),
    h('div', { class: 'grid gap-10 lg:grid-cols-2' }, history(item), details(item)),
  );
}

const MODES: [Reason, string][] = [
  ['used', 'Used some'],
  ['restock', 'Bought more'],
  ['adjust', 'Counted'],
];

function countForm(item: Item, flash: string) {
  const wrap = h('div', { class: 'mb-8 max-w-xl' });
  const status = statusLine();
  if (flash) say(status, flash);
  const body = h('div', {});

  const drawBody = () => {
    const m = state.mode;
    const ask = m === 'used' ? 'Amount used' : m === 'restock' ? 'Amount added' : 'Count now';
    const amt = h('input', { class: `${input} text-base`, type: 'number', inputmode: 'decimal', step: 'any', min: '0', 'aria-label': ask }) as HTMLInputElement;
    amt.value = m === 'adjust' ? String(item.onHand) : '1';
    const price = h('input', {
      class: input,
      type: 'number',
      inputmode: 'decimal',
      step: '0.01',
      min: '0',
      placeholder: item.cost === null ? '' : String(item.cost / 100),
      'aria-label': 'Price paid each ($)',
    }) as HTMLInputElement;
    const note = h('input', { class: input, type: 'text', maxlength: '300', 'aria-label': 'Note' }) as HTMLInputElement;
    const save = h('button', { type: 'submit', class: `${ghost} border-gold-500 py-2 text-bone-50` }, m === 'used' ? 'Take it off' : m === 'restock' ? 'Add it on' : 'Set the count') as HTMLButtonElement;
    const label = (text: string, el: HTMLElement, extra = '') => h('label', { class: `flex flex-col gap-1 ${extra}` }, h('span', { class: small }, text), el);

    body.replaceChildren(
      h(
        'form',
        {
          class: 'mt-4',
          novalidate: true,
          onsubmit: (e: Event) => {
            e.preventDefault();
            const n = Number(amt.value);
            if (amt.value.trim() === '' || !Number.isFinite(n) || n < 0 || (m !== 'adjust' && n === 0)) {
              return say(status, h('span', { class: 'text-red-300' }, m === 'adjust' ? 'Type the count, zero or more.' : 'Type an amount above zero.'));
            }
            if (m === 'used' && n > item.onHand) {
              return say(status, h('span', { class: 'text-red-300' }, `You only have ${amount(item.onHand, item.unit)}. If that's wrong, count it and use “Counted”.`));
            }
            const paid = price.value.trim() === '' ? undefined : Math.round(Number(price.value) * 100);
            if (paid !== undefined && !(Number.isFinite(paid) && paid >= 0)) return say(status, h('span', { class: 'text-red-300' }, 'The price should be dollars, like 12.99.'));
            void busy(save, status, async () => {
              const after = await api<Item>(`/inventory/${item.id}/movements`, {
                method: 'POST',
                body: {
                  reason: m,
                  ...(m === 'adjust' ? { count: n } : { delta: n }),
                  ...(m === 'restock' && paid !== undefined ? { unitCost: paid } : {}),
                  note: note.value.trim() || undefined,
                },
              });
              state.flash = {
                id: item.id,
                text: after.onHand === item.onHand ? `No change: it's still ${amount(after.onHand, after.unit)}.` : `Saved. Now ${amount(after.onHand, after.unit)}.`,
              };
              await reload();
            });
          },
        },
        h(
          'div',
          { class: 'grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 sm:grid-cols-[13rem_1fr_auto]' },
          label(`${ask} (${item.unit})`, amt, 'col-span-2 sm:col-span-1'),
          m === 'restock' ? label('Price paid each ($)', price) : label('Note (optional)', note),
          save,
          m === 'restock' ? label('Note (optional)', note, 'col-span-2 sm:col-span-3') : null,
        ),
        h(
          'p',
          { class: 'mt-2 text-sm text-bone-400' },
          m === 'used'
            ? `You have ${amount(item.onHand, item.unit)}. What you log on a finished job in the app comes off by itself.`
            : m === 'restock'
              ? `You have ${amount(item.onHand, item.unit)}. A price here becomes its new cost.`
              : `Count what's on the shelf and type the real number. It says ${amount(item.onHand, item.unit)} now.`,
        ),
      ),
    );
  };
  drawBody();

  wrap.append(
    subhead('Change the count', 'mb-1'),
    choice(MODES, () => state.mode, (v) => {
      state.mode = v;
      say(status);
      drawBody();
    }, 'What happened'),
    body,
    h('div', { class: 'mt-2' }, status),
  );
  return wrap;
}

const reasonText = (m: Movement) => {
  if (m.reason === 'restock') return 'Bought more';
  if (m.reason === 'used') return m.jobId ? (m.delta > 0 ? 'Put back from a job' : 'Used on a job') : m.delta > 0 ? 'Put back' : 'Used';
  return 'Counted';
};

function history(item: Item) {
  const box = h('div', {}, h('p', { class: 'text-sm text-bone-400' }, 'Loading…'));
  const LIMIT = 8;
  const draw = (moves: Movement[], all: boolean) => {
    if (!moves.length) return box.replaceChildren(h('p', { class: 'text-sm text-bone-400' }, 'Nothing logged yet.'));
    const shown = all ? moves : moves.slice(0, LIMIT);
    box.replaceChildren(
      h(
        'ul',
        { class: 'border-t border-ink-800' },
        ...shown.map((m) =>
          h(
            'li',
            { class: 'grid grid-cols-[1fr_auto] gap-x-4 border-b border-ink-800 py-2 text-sm' },
            h(
              'div',
              { class: 'min-w-0' },
              h('p', { class: 'text-bone-50' }, reasonText(m)),
              h('p', { class: 'text-bone-400' }, [when(m.createdAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }), m.note].filter(Boolean).join(' · ')),
            ),
            h(
              'div',
              { class: 'text-right tabular-nums' },
              h('p', { class: m.delta > 0 ? 'text-bone-50' : 'text-bone-200' }, `${m.delta > 0 ? '+' : '−'}${amount(Math.abs(m.delta), item.unit)}`),
              h('p', { class: 'text-bone-400' }, `left ${qty(m.onHand)}`),
            ),
          ),
        ),
      ),
      !all && moves.length > LIMIT
        ? h(
            'button',
            { type: 'button', class: 'mt-3 text-sm text-gold-400 underline decoration-gold-600 underline-offset-4 hover:text-gold-500', onclick: () => draw(moves, true) },
            `Show all ${moves.length}`,
          )
        : '',
    );
  };
  api<{ movements: Movement[] }>(`/inventory/${item.id}/movements`)
    .then(({ movements }) => draw(movements, false))
    .catch((err: Error) => box.replaceChildren(h('p', { class: 'text-sm text-red-300' }, err.message)));
  return h('div', {}, subhead('History'), box);
}

function details(item: Item) {
  const d = {
    name: item.name,
    unit: item.unit,
    barcode: item.barcode ? printedCode(item.barcode) : '',
    reorderAt: item.reorderAt,
    cost: item.cost,
    reorderUrl: item.reorderUrl ?? '',
    notes: item.notes ?? '',
  };
  const status = statusLine();
  const wide = (el: HTMLElement) => (el.classList.add('col-span-2'), el);
  const unit = field('Unit', () => d.unit, (v) => (d.unit = String(v)), { kind: 'text' });
  unit.querySelector('input')!.setAttribute('list', 'inventory-units');
  const code = field('Barcode', () => d.barcode, (v) => (d.barcode = String(v)), { kind: 'text', blank: 'None' });
  code.querySelector('input')!.addEventListener('keydown', (e) => e.key === 'Enter' && e.preventDefault());

  const save = h('button', { type: 'button', class: `${ghost} border-gold-500 text-bone-50` }, 'Save changes') as HTMLButtonElement;
  save.addEventListener('click', () => {
    if (!d.name.trim()) return say(status, h('span', { class: 'text-red-300' }, "The name can't be empty."));
    void busy(save, status, async () => {
      await api<Item>(`/inventory/${item.id}`, {
        method: 'PATCH',
        body: {
          name: d.name,
          unit: d.unit.trim() || 'each',
          barcode: d.barcode.trim() || null,
          reorderAt: d.reorderAt,
          cost: d.cost,
          reorderUrl: d.reorderUrl.trim() || null,
          notes: d.notes.trim() || null,
        },
      });
      state.flash = { id: item.id, text: 'Details saved.' };
      await reload();
    });
  });

  // Hiding asks twice instead of a pop-up: the first tap changes the words.
  const hide = h(
    'button',
    { type: 'button', class: 'text-sm text-bone-400 underline decoration-ink-600 underline-offset-4 hover:text-bone-50' },
    item.archived ? 'Bring it back' : 'Hide this item',
  ) as HTMLButtonElement;
  let armed = 0;
  hide.addEventListener('click', () => {
    if (!item.archived && !armed) {
      hide.textContent = 'Tap again to hide it';
      armed = window.setTimeout(() => {
        armed = 0;
        hide.textContent = 'Hide this item';
      }, 4000);
      return;
    }
    window.clearTimeout(armed);
    void busy(hide, status, async () => {
      await api<Item>(`/inventory/${item.id}`, { method: 'PATCH', body: { archived: !item.archived } });
      if (!item.archived) state.openId = null;
      else state.flash = { id: item.id, text: "It's back on the list." };
      await reload();
    });
  });

  return h(
    'div',
    {},
    subhead('Details'),
    h(
      'div',
      { class: 'grid grid-cols-2 gap-3' },
      wide(field('Name', () => d.name, (v) => (d.name = String(v)), { kind: 'text' })),
      unit,
      code,
      field('Order more at', () => d.reorderAt, (v) => (d.reorderAt = v as number | null), { step: ANY, min: 0, blank: 'Never' }),
      field('Cost each ($)', () => d.cost, (v) => (d.cost = v as number | null), { kind: 'money', blank: 'Not sure' }),
      wide(field('Where to buy it (link)', () => d.reorderUrl, (v) => (d.reorderUrl = String(v)), { kind: 'text', blank: 'https://…' })),
      wide(field('Notes', () => d.notes, (v) => (d.notes = String(v)), { kind: 'text' })),
    ),
    h('div', { class: 'mt-4 flex flex-wrap items-center gap-4' }, save, hide),
    h('div', { class: 'mt-2' }, status),
    h('p', { class: 'mt-3 text-xs text-bone-500' }, 'Hidden items leave the list but keep their history. The count only changes above, never here.'),
  );
}
