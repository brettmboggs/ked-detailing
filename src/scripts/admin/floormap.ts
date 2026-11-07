/**
 * Floors → Floor map (ked-coatings DECISIONS D19). The measure-visit tool:
 * draw the garage floor step by step, and it measures itself and prices the
 * job with the same formula as the website's quick quote.
 *
 * Built for anyone: one job per step, one sentence saying what to do, big
 * targets, exact lengths typed the way people say them ("22 6"), undo for
 * everything, saved as you go.
 *
 * Floor-coating trade code (TENANT-neutral). Until floors has its own
 * database (D3), maps are kept in this browser's storage.
 */
import {
  applyFloorQuoteEdits,
  checkFloorMap,
  defaultFloorConfig,
  floorQuote,
  formatFeet,
  formatMoney,
  lPlan,
  measureFloorMap,
  parseFeet,
  planToMap,
  rectanglePlan,
  removeCorner,
  setWallLength,
  stemSpan,
  upgradePlan,
  wallLength,
  type EditedFloorQuote,
  type FloorFixtureKind,
  type FloorLineId,
  type FloorPlan,
  type FloorQuoteEdits,
} from '@ked/pricing';
import { h, $, small, heading, headingStyle, ghost, input } from './core';
import { FloorCanvas, HOME_STEP, fixtureLabel, wallName, type Selection, type StepId } from './floormap-canvas';

/* ------------------------------------------------------------ storage */

interface SavedMap {
  id: string;
  name: string;
  updated: string;
  plan: FloorPlan;
  moisture: 'untested' | 'passed' | 'failed';
  /** For the crew; not on the quote. */
  notes: string;
  customer: { name: string; address: string; phone: string; email: string };
  /** The owner's changes to the formula's quote. */
  edits: FloorQuoteEdits;
  /** Printed on the quote. */
  note: string;
  quoteNo: string;
}

/** Maps saved before a field existed get its empty value. */
function normalize(m: SavedMap): SavedMap {
  return {
    ...m,
    plan: upgradePlan(m.plan),
    notes: m.notes ?? '',
    customer: {
      name: m.customer?.name ?? m.name ?? '',
      address: m.customer?.address ?? '',
      phone: m.customer?.phone ?? '',
      email: m.customer?.email ?? '',
    },
    edits: { lines: m.edits?.lines ?? {}, extras: m.edits?.extras ?? [] },
    note: m.note ?? '',
    quoteNo: m.quoteNo ?? quoteNumber(new Date(m.updated || Date.now())),
  };
}

/** Q-2611-0742: year, month, and a short random tail; readable over the phone. */
function quoteNumber(d = new Date()) {
  const yymm = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}`;
  return `Q-${yymm}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
}

const STORE = 'ked-floor-maps';

function loadAll(): SavedMap[] {
  try {
    const list = JSON.parse(localStorage.getItem(STORE) ?? '[]') as SavedMap[];
    return Array.isArray(list) ? list.map(normalize) : [];
  } catch {
    return [];
  }
}
function saveAll(list: SavedMap[]) {
  try {
    localStorage.setItem(STORE, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}
function upsert(m: SavedMap) {
  const list = loadAll().filter((x) => x.id !== m.id);
  return saveAll([m, ...list]);
}
const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/* ------------------------------------------------------------ steps */

const STEPS: { id: StepId; title: string; short: string; how: string }[] = [
  {
    id: 'shape',
    short: 'Shape',
    title: 'The floor’s shape',
    how: 'Type each wall’s length below, or tap a length on the drawing. Drag a gold corner to move it. Tap a + to add a corner for an L or a notch.',
  },
  {
    id: 'doors',
    short: 'Doors',
    title: 'Garage doors',
    how: 'Pick the door size, then tap the wall where the door is. Drag a door to slide it along its wall.',
  },
  {
    id: 'curb',
    short: 'Curb',
    title: 'Raised curb (stem wall)',
    how: 'Tap a wall that has a raised concrete curb along the bottom. If it doesn’t run the whole wall, drag its gold squares to where it starts and stops. Tap a curb to select it.',
  },
  {
    id: 'cracks',
    short: 'Cracks',
    title: 'Cracks',
    how: 'Trace each crack with your finger or the mouse, start to end. Its length is measured for you.',
  },
  {
    id: 'damage',
    short: 'Damage',
    title: 'Pitted or flaking concrete',
    how: 'Draw a loop around each damaged patch. The area is measured for you.',
  },
  {
    id: 'coating',
    short: 'Old coating',
    title: 'Old paint, epoxy or coating',
    how: 'Is there a coating on the floor now? It all has to be ground off first.',
  },
  {
    id: 'things',
    short: 'Things',
    title: 'Things on the floor',
    how: 'Pick what it is, then tap where it is. Drag one to move it.',
  },
  {
    id: 'uncoated',
    short: 'Skip areas',
    title: 'Areas we won’t coat',
    how: 'Draw a loop around anything that stays: a fixed cabinet, a heater pad. It’s taken off the square feet.',
  },
  {
    id: 'price',
    short: 'Price',
    title: 'Measurements and price',
    how: 'Check the numbers, mark the moisture test, and this is the firm quote.',
  },
];

const DOOR_SIZES = [8, 9, 10, 12, 16, 18];
const FIXTURES: FloorFixtureKind[] = ['drain', 'post', 'water-heater', 'outlet-120', 'outlet-240', 'step', 'other'];

const STYLE = `
.fm-svg{display:block;width:100%;height:100%;touch-action:none;user-select:none;-webkit-user-select:none;cursor:crosshair;background:#0e0e0d}
.fm-svg .fm-grab{cursor:grab}.fm-svg .fm-tap{cursor:pointer}
.fm-canvas{height:min(68svh,720px);min-height:360px;border:1px solid #2a2927;border-radius:4px;overflow:hidden}
.fm-chip{border:1px solid #2a2927;padding:.6rem .9rem;font-size:.9rem;color:#c8c4b9;border-radius:3px;min-height:44px}
.fm-chip[aria-pressed=true]{border-color:#c9a961;color:#0b0b0b;background:#c9a961;font-weight:600}
.fm-step{white-space:nowrap;padding:.55rem .8rem;border-bottom:2px solid transparent;font-size:.85rem;color:#8f8b82}
.fm-step[aria-current=step]{color:#eae6dc;border-color:#c9a961}
.fm-step b{display:inline-block;min-width:1.4em;color:#c9a961;font-weight:700}
.fm-big{min-height:52px}
@media (min-width:1024px){.fm-stick{position:sticky;top:1rem}}
.fm-money{width:6.5rem;text-align:right}
`;

/* ------------------------------------------------------------ entry */

export async function renderFloorMap() {
  if (!document.getElementById('fm-style')) document.head.append(h('style', { id: 'fm-style' }, STYLE));
  showList();
}

const view = () => $('[data-view="floormap"]');

/* ------------------------------------------------------------ list */

function showList() {
  const maps = loadAll();
  const body = h(
    'div',
    { class: 'max-w-3xl' },
    h('h2', { class: heading, style: headingStyle }, 'Floor maps'),
    h(
      'p',
      { class: 'mt-2 max-w-2xl text-bone-400' },
      'Draw the garage floor at the measure visit. It measures itself and gives you the firm price. Saved on this device for now.',
    ),
    h('button', { type: 'button', class: 'btn-gold mt-6', onclick: () => showNew() }, 'New floor map'),
  );
  if (maps.length) {
    const ul = h('ul', {
      class: 'mt-10 divide-y divide-ink-800 border-y border-ink-800',
    });
    for (const m of maps) {
      let sqft = 0;
      try {
        sqft = measureFloorMap(planToMap(m.plan)).sqft;
      } catch {
        sqft = 0;
      }
      const confirm = h('span', {
        class: 'flex items-center gap-2',
        hidden: true,
      });
      const del = h(
        'button',
        {
          type: 'button',
          class: ghost,
          onclick: () => ((del.hidden = true), (confirm.hidden = false)),
        },
        'Delete',
      );
      confirm.append(
        h('span', { class: 'text-sm text-bone-400' }, 'Delete for good?'),
        h(
          'button',
          {
            type: 'button',
            class: ghost,
            onclick: () => (saveAll(loadAll().filter((x) => x.id !== m.id)), showList()),
          },
          'Yes, delete',
        ),
        h(
          'button',
          {
            type: 'button',
            class: ghost,
            onclick: () => ((del.hidden = false), (confirm.hidden = true)),
          },
          'Keep',
        ),
      );
      ul.append(
        h(
          'li',
          { class: 'flex flex-wrap items-center justify-between gap-3 py-4' },
          h(
            'button',
            {
              type: 'button',
              class: 'min-w-0 flex-1 text-left',
              onclick: () => showEditor(m),
            },
            h('span', { class: 'block text-lg text-bone-50' }, m.name || 'Untitled floor'),
            h(
              'span',
              { class: 'block text-sm text-bone-400' },
              `${Math.round(sqft)} sq ft · changed ${new Date(m.updated).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`,
            ),
          ),
          h('span', { class: 'flex items-center gap-2' }, h('button', { type: 'button', class: ghost, onclick: () => showEditor(m) }, 'Open'), del, confirm),
        ),
      );
    }
    body.append(ul);
  }
  view().replaceChildren(body);
}

/* ------------------------------------------------------------ new */

function lengthInput(label: string, value: number, onChange: (v: number | null) => void, hint?: string) {
  const el = h('input', {
    class: `${input} fm-big text-lg`,
    inputmode: 'decimal',
    autocomplete: 'off',
    'aria-label': label,
    placeholder: 'e.g. 22 6',
  }) as HTMLInputElement;
  el.value = formatFeet(value);
  const msg = h('span', { class: 'text-xs text-bone-400' }, hint ?? 'Feet and inches: “22 6” is 22 feet 6 inches.');
  el.addEventListener('input', () => {
    const v = parseFeet(el.value);
    msg.textContent =
      el.value.trim() && v === null ? 'That doesn’t read as a length. Try “22 6” or “22.5”.' : (hint ?? 'Feet and inches: “22 6” is 22 feet 6 inches.');
    msg.className = `text-xs ${el.value.trim() && v === null ? 'text-red-300' : 'text-bone-400'}`;
    onChange(v);
  });
  el.addEventListener('focus', () => el.select());
  return {
    el,
    wrap: h('label', { class: 'flex flex-col gap-1.5' }, h('span', { class: small }, label), el, msg),
  };
}

function showNew() {
  let shape: 'rect' | 'l' = 'rect';
  let w: number | null = 22;
  let d: number | null = 22;
  let bw: number | null = 10;
  let bd: number | null = 8;
  const name = h('input', {
    class: `${input} fm-big text-lg`,
    placeholder: 'e.g. Smith, 14 Oak Lane',
    autocomplete: 'off',
    'aria-label': 'Whose garage',
  }) as HTMLInputElement;

  const W = lengthInput('Across the garage door wall', 22, (v) => (w = v));
  const D = lengthInput('From the door to the back wall', 22, (v) => (d = v));
  const BW = lengthInput('Bump-out: how wide', 10, (v) => (bw = v));
  const BD = lengthInput('Bump-out: how deep', 8, (v) => (bd = v));
  const extra = h('div', { class: 'grid gap-5 sm:grid-cols-2', hidden: true }, BW.wrap, BD.wrap);

  const shapeBtn = (id: 'rect' | 'l', title: string, note: string, svg: string) => {
    const b = h(
      'button',
      {
        type: 'button',
        class: 'fm-chip flex flex-1 items-center gap-4 p-4 text-left',
        'aria-pressed': String(shape === id),
      },
      h('span', { class: 'shrink-0' }),
      h('span', {}, h('span', { class: 'block font-semibold' }, title), h('span', { class: 'block text-sm opacity-80' }, note)),
    );
    (b.firstChild as HTMLElement).innerHTML = svg; // static markup, no user text
    b.addEventListener('click', () => {
      shape = id;
      for (const x of shapes.children) x.setAttribute('aria-pressed', String(x === b));
      extra.hidden = id !== 'l';
    });
    return b;
  };
  const shapes = h(
    'div',
    { class: 'flex flex-col gap-3 sm:flex-row' },
    shapeBtn(
      'rect',
      'Rectangle',
      'Most garages',
      '<svg width="44" height="36"><rect x="4" y="4" width="36" height="28" fill="none" stroke="currentColor" stroke-width="3"/></svg>',
    ),
    shapeBtn(
      'l',
      'L-shape',
      'A bump-out at the back',
      '<svg width="44" height="36"><path d="M4 32V12h22V4h14v28z" fill="none" stroke="currentColor" stroke-width="3"/></svg>',
    ),
  );

  const presets = h(
    'div',
    { class: 'flex flex-wrap gap-2' },
    ...defaultFloorConfig.quick.sizes.map((sz) =>
      h(
        'button',
        {
          type: 'button',
          class: 'fm-chip',
          onclick: () => {
            [w, d] = [sz.width, sz.depth];
            W.el.value = formatFeet(sz.width);
            D.el.value = formatFeet(sz.depth);
          },
        },
        `${sz.label} · ${sz.width} × ${sz.depth}`,
      ),
    ),
  );

  const err = h('p', { class: 'text-red-300', role: 'alert', hidden: true });
  const start = () => {
    if (!(w && d) || (shape === 'l' && !(bw && bd))) {
      err.textContent = 'Fill in each length, like “22” or “22 6”.';
      err.hidden = false;
      return;
    }
    if (shape === 'l' && bw! >= w) {
      err.textContent = 'The bump-out has to be narrower than the garage.';
      err.hidden = false;
      return;
    }
    const plan = shape === 'l' ? lPlan(w, d, bw!, bd!) : rectanglePlan(w, d);
    const who = name.value.trim();
    const m: SavedMap = normalize({
      id: newId(),
      name: who,
      updated: new Date().toISOString(),
      plan,
      moisture: 'untested',
      notes: '',
    } as SavedMap);
    upsert(m);
    showEditor(m);
  };

  view().replaceChildren(
    h(
      'div',
      { class: 'max-w-2xl' },
      h(
        'button',
        {
          type: 'button',
          class: 'text-sm text-bone-400 underline underline-offset-4',
          onclick: showList,
        },
        '← All floor maps',
      ),
      h('h2', { class: `${heading} mt-6`, style: headingStyle }, 'New floor map'),
      h(
        'div',
        { class: 'mt-8 flex flex-col gap-8' },
        h('label', { class: 'flex flex-col gap-1.5' }, h('span', { class: small }, 'Whose garage'), name),
        h(
          'div',
          { class: 'flex flex-col gap-3' },
          h('span', { class: small }, 'What shape is it?'),
          shapes,
          h('p', { class: 'text-sm text-bone-400' }, 'Something else? Start with a rectangle; you can add and move corners next.'),
        ),
        h('div', { class: 'flex flex-col gap-3' }, h('span', { class: small }, 'Quick sizes'), presets),
        h('div', { class: 'grid gap-5 sm:grid-cols-2' }, W.wrap, D.wrap),
        extra,
        err,
        h(
          'button',
          {
            type: 'button',
            class: 'btn-gold fm-big self-start',
            onclick: start,
          },
          'Start drawing',
        ),
      ),
    ),
  );
  name.focus();
}

/* ------------------------------------------------------------ editor */

function showEditor(saved: SavedMap) {
  let doc = structuredClone(saved);
  let stepIx = 0;
  let selection: Selection = null;
  let doorWidth = 16;
  let fixtureKind: FloorFixtureKind = 'drain';
  let stepWidth = 4;
  const undo: FloorPlan[] = [];
  const redo: FloorPlan[] = [];
  const status = h('span', { class: 'text-sm text-bone-400', role: 'status' }, 'Saved');

  let saveTimer = 0;
  const save = () => {
    status.textContent = 'Saving…';
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      doc.updated = new Date().toISOString();
      status.textContent = upsert(doc) ? 'Saved on this device' : 'Couldn’t save: this browser’s storage is full or off';
    }, 250);
  };

  const canvas: FloorCanvas = new FloorCanvas({
    plan: () => doc.plan,
    step: () => STEPS[stepIx]!.id,
    selection: () => selection,
    select: (sel) => {
      selection = sel;
      canvas.draw();
      panel();
    },
    preview: (p) => {
      doc.plan = p;
      canvas.draw();
    },
    commit: (p, before) => {
      undo.push(before);
      redo.length = 0;
      doc.plan = p;
      canvas.draw();
      if (STEPS[stepIx]!.id === 'shape') canvas.fitIfNeeded();
      panel();
      save();
    },
    doorWidth: () => doorWidth,
    fixtureKind: () => fixtureKind,
    stepWidth: () => stepWidth,
    editWall: (i) => {
      // The panel holds every wall's length; jump to that one.
      const el = document.getElementById(`fm-wall-${i}`) as HTMLInputElement | null;
      el?.focus();
      el?.scrollIntoView({ block: 'nearest' });
    },
    jump: (sel) => {
      goto(STEPS.findIndex((st) => st.id === HOME_STEP[sel.kind]));
      selection = sel;
      canvas.draw();
      panel();
    },
  });

  const change = (p: FloorPlan) => {
    undo.push(doc.plan);
    redo.length = 0;
    doc.plan = p;
    canvas.draw();
    panel();
    save();
  };
  const doUndo = () => {
    const p = undo.pop();
    if (!p) return;
    redo.push(doc.plan);
    doc.plan = p;
    selection = null;
    canvas.draw();
    panel();
    save();
  };
  const doRedo = () => {
    const p = redo.pop();
    if (!p) return;
    undo.push(doc.plan);
    doc.plan = p;
    selection = null;
    canvas.draw();
    panel();
    save();
  };

  const undoBtn = h('button', { type: 'button', class: ghost, onclick: doUndo, title: 'Undo (Ctrl+Z)' }, 'Undo');
  const redoBtn = h(
    'button',
    {
      type: 'button',
      class: ghost,
      onclick: doRedo,
      title: 'Redo (Ctrl+Shift+Z)',
    },
    'Redo',
  );

  const nameEl = h('input', {
    class: `${input} max-w-xs`,
    placeholder: 'Whose garage',
    'aria-label': 'Whose garage',
  }) as HTMLInputElement;
  nameEl.value = doc.name;
  nameEl.addEventListener('input', () => {
    doc.name = nameEl.value.trim();
    save();
  });

  const stepsBar = h('nav', {
    class: 'mt-5 flex overflow-x-auto border-b border-ink-800',
    'aria-label': 'Steps',
  });
  const panelEl = h('div', { class: 'flex flex-col gap-5' });
  // Phones: what to do, right above the drawing, so nobody scrolls to find it.
  const tip = h('p', {
    class: 'mt-4 border-l-2 border-gold-500 pl-3 text-sm text-bone-200 lg:hidden',
    role: 'status',
  });
  // Phones: the step's choices (door size, what to place) above the drawing too.
  const tipControls = h('div', {
    class: 'mt-3 flex flex-wrap gap-2 lg:hidden',
  });
  const summary = h('div', { class: 'grid grid-cols-2 gap-6 border-t border-ink-800 pt-3' });
  const navEl = h('div', { class: 'flex flex-wrap items-center gap-3' });

  /** The quote as it stands: the formula, then the owner's changes. */
  const quoteNow = () => {
    const m = measureFloorMap(planToMap(doc.plan));
    const base = floorQuote(defaultFloorConfig, {
      ...m,
      moisturePrimer: doc.moisture === 'failed',
    });
    return {
      m,
      base,
      q: applyFloorQuoteEdits(defaultFloorConfig, base, doc.edits),
    };
  };

  const goto = (i: number) => {
    stepIx = Math.max(0, Math.min(STEPS.length - 1, i));
    selection = null;
    drawSteps();
    canvas.draw();
    panel();
  };
  const drawSteps = () => {
    stepsBar.replaceChildren(
      ...STEPS.map((st, i) =>
        h(
          'button',
          {
            type: 'button',
            class: 'fm-step',
            'aria-current': i === stepIx ? 'step' : undefined,
            onclick: () => goto(i),
          },
          h('b', {}, String(i + 1)),
          st.short,
        ),
      ),
    );
    stepsBar.querySelector('[aria-current]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
    tip.textContent = `${stepIx + 1}. ${STEPS[stepIx]!.how}`;
  };

  const chip = (label: string, on: boolean, click: () => void) =>
    h(
      'button',
      {
        type: 'button',
        class: 'fm-chip',
        'aria-pressed': String(on),
        onclick: click,
      },
      label,
    );

  /** What's selected, in words, with the way to delete it. */
  const selectionBox = () => {
    if (!selection) return null;
    const sel = selection;
    const p = doc.plan;
    const remove = (label: string, next: () => FloorPlan) =>
      h(
        'button',
        {
          type: 'button',
          class: `${ghost} fm-big`,
          'data-remove': true,
          onclick: () => ((selection = null), change(next())),
        },
        label,
      );
    const box = h('div', {
      class: 'flex flex-col gap-3 border-l-2 border-gold-500 pl-4',
    });
    if (sel.kind === 'corner') {
      box.append(h('p', { class: 'text-bone-200' }, 'Corner selected. Drag it, or:'));
      if (p.outline.length > 3) box.append(remove('Remove this corner', () => removeCorner(p, sel.i)));
      else box.append(h('p', { class: 'text-sm text-bone-400' }, 'A floor needs at least three corners.'));
    } else if (sel.kind === 'door') {
      const d = p.doors[sel.i];
      if (!d) return null;
      box.append(
        h(
          'p',
          { class: 'text-bone-200' },
          `Door on wall ${wallName(d.wall)}, ${formatFeet(Math.min(d.width, wallLength(p, d.wall)))} wide. Drag a gold square to make it wider or narrower, drag the door to slide it, or pick a size:`,
        ),
        h(
          'div',
          { class: 'flex flex-wrap gap-2' },
          ...DOOR_SIZES.map((sz) =>
            chip(`${sz}′`, d.width === sz, () => {
              const next = structuredClone(p);
              next.doors[sel.i]!.width = sz;
              doorWidth = sz;
              change(next);
            }),
          ),
        ),
        remove('Remove this door', () => ({
          ...p,
          doors: p.doors.filter((_, i) => i !== sel.i),
        })),
      );
    } else if (sel.kind === 'curb') {
      const r = p.stemWalls[sel.i];
      if (!r) return null;
      const { from, to } = stemSpan(p, r);
      const whole = r.from === undefined && r.to === undefined;
      box.append(
        h(
          'p',
          { class: 'text-bone-200' },
          `Curb on wall ${wallName(r.wall)}, ${formatFeet(to - from)}${whole ? ', the whole wall' : ''}. Drag a gold square to where the curb starts or stops.`,
        ),
        ...(whole
          ? []
          : [
              h(
                'button',
                {
                  type: 'button',
                  class: `${ghost} fm-big`,
                  onclick: () => {
                    const next = structuredClone(p);
                    next.stemWalls[sel.i] = { wall: r.wall };
                    change(next);
                  },
                },
                'Run it the whole wall',
              ),
            ]),
        remove('Remove this curb', () => ({ ...p, stemWalls: p.stemWalls.filter((_, i) => i !== sel.i) })),
      );
    } else if (sel.kind === 'crack') {
      const c = p.cracks[sel.i];
      if (!c) return null;
      let L = 0;
      for (let i = 1; i < c.length; i++) L += Math.hypot(c[i]![0] - c[i - 1]![0], c[i]![1] - c[i - 1]![1]);
      L = Math.round(L * 10) / 10; // the same tenth of a foot the measuring uses
      box.append(
        h('p', { class: 'text-bone-200' }, `Crack, ${formatFeet(L)} long. Drag the gold dots to reshape it, or drag the crack to move it.`),
        remove('Remove this crack', () => ({
          ...p,
          cracks: p.cracks.filter((_, i) => i !== sel.i),
        })),
      );
    } else if (sel.kind === 'spall' || sel.kind === 'excluded' || sel.kind === 'coat') {
      const list = sel.kind === 'spall' ? p.spalls : sel.kind === 'excluded' ? p.excluded : Array.isArray(p.oldCoating) ? p.oldCoating : [];
      const a = list[sel.i];
      if (!a) return null;
      const area = measureFloorMap({ ...planToMap(p), spalls: [a] }).spalledSqft ?? 0;
      const what = sel.kind === 'spall' ? 'Damaged patch' : sel.kind === 'excluded' ? 'Area we won’t coat' : 'Old coating area';
      box.append(
        h('p', { class: 'text-bone-200' }, `${what}, ${Math.round(area * 10) / 10} sq ft. Drag the gold dots to reshape it, or drag it to move it.`),
        remove('Remove it', () => {
          const next = structuredClone(p);
          if (sel.kind === 'spall') next.spalls.splice(sel.i, 1);
          else if (sel.kind === 'excluded') next.excluded.splice(sel.i, 1);
          else if (Array.isArray(next.oldCoating)) next.oldCoating.splice(sel.i, 1);
          return next;
        }),
      );
    } else if (sel.kind === 'fixture') {
      const f = p.fixtures[sel.i];
      if (!f) return null;
      box.append(
        h('p', { class: 'text-bone-200' }, `${fixtureLabel(f.kind)}. Drag it to move it. Wrong kind? Change it:`),
        h(
          'div',
          { class: 'flex flex-wrap gap-2' },
          ...FIXTURES.map((k) =>
            chip(fixtureLabel(k), f.kind === k, () => {
              const next = structuredClone(p);
              const g = next.fixtures[sel.i]!;
              g.kind = k;
              if (k === 'step') g.width = g.width ?? stepWidth;
              else delete g.width;
              change(next);
            }),
          ),
        ),
      );
      {
        const note = h('input', { class: input, placeholder: 'e.g. floor drain, keep clear', 'aria-label': 'Note' }) as HTMLInputElement;
        note.value = f.note ?? '';
        note.addEventListener('change', () => {
          const next = structuredClone(doc.plan);
          const v = note.value.trim();
          if (v) next.fixtures[sel.i]!.note = v;
          else delete next.fixtures[sel.i]!.note;
          change(next);
        });
        box.append(h('label', { class: 'flex flex-col gap-1' }, h('span', { class: small }, 'Note'), note));
      }
      if (f.kind === 'step') {
        const W = lengthInput(
          'Step width',
          f.width ?? 4,
          (v) => {
            if (!v) return;
            const next = structuredClone(doc.plan);
            next.fixtures[sel.i]!.width = v;
            stepWidth = v;
            change(next);
          },
          'How wide the step is, wall to wall.',
        );
        box.append(W.wrap);
      }
      box.append(
        remove('Remove it', () => ({
          ...p,
          fixtures: p.fixtures.filter((_, i) => i !== sel.i),
        })),
      );
    }
    return box;
  };

  /** Where a wall is, in words: "Front, the garage door side". */
  const side = (p: FloorPlan, i: number) => {
    const o = p.outline;
    const cx = o.reduce((t, q) => t + q[0], 0) / o.length;
    const cy = o.reduce((t, q) => t + q[1], 0) / o.length;
    const where = (j: number) => {
      const a = o[j]!;
      const b = o[(j + 1) % o.length]!;
      const dx = (a[0] + b[0]) / 2 - cx;
      const dy = (a[1] + b[1]) / 2 - cy;
      return Math.abs(dy) >= Math.abs(dx) ? (dy < 0 ? 'Front, the garage door side' : 'Back wall') : dx < 0 ? 'Left wall' : 'Right wall';
    };
    const mine = where(i);
    const same = o.filter((_, j) => where(j) === mine).length;
    return same > 1 ? `${mine}, part` : mine;
  };

  const counts = (n: number, one: string, many: string) => (n === 0 ? `No ${many} yet.` : n === 1 ? `1 ${one}.` : `${n} ${many}.`);

  function panel() {
    const st = STEPS[stepIx]!;
    const p = doc.plan;
    tipControls.replaceChildren(
      ...(st.id === 'doors'
        ? DOOR_SIZES.map((sz) => chip(`${sz}′`, doorWidth === sz, () => ((doorWidth = sz), panel())))
        : st.id === 'things'
          ? FIXTURES.map((k) => chip(fixtureLabel(k), fixtureKind === k, () => ((fixtureKind = k), panel())))
          : []),
    );
    const parts: (HTMLElement | null)[] = [
      h(
        'div',
        {},
        h('p', { class: small }, `Step ${stepIx + 1} of ${STEPS.length}`),
        h('h3', { class: `${heading} mt-1 text-xl` }, st.title),
        h('p', { class: 'mt-2 text-bone-200' }, st.how),
      ),
    ];

    if (st.id === 'shape') {
      const walls = h('div', { class: 'grid gap-3' });
      for (let i = 0; i < p.outline.length; i++) {
        const el = h('input', {
          id: `fm-wall-${i}`,
          class: `${input} fm-big`,
          inputmode: 'decimal',
          autocomplete: 'off',
          'aria-label': `Wall ${wallName(i)} length`,
        }) as HTMLInputElement;
        el.value = formatFeet(wallLength(p, i));
        el.addEventListener('focus', () => el.select());
        const apply = () => {
          const v = parseFeet(el.value);
          if (v === null) {
            el.value = formatFeet(wallLength(doc.plan, i));
            return;
          }
          if (Math.abs(v - wallLength(doc.plan, i)) > 1e-6) {
            change(setWallLength(doc.plan, i, v));
            canvas.fitIfNeeded();
          }
        };
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            apply();
            (document.getElementById(`fm-wall-${(i + 1) % p.outline.length}`) as HTMLInputElement | null)?.focus();
          }
          if (e.key === 'Escape') el.value = formatFeet(wallLength(doc.plan, i));
        });
        el.addEventListener('blur', apply);
        walls.append(
          h(
            'label',
            { class: 'grid grid-cols-[2.5rem_1fr] items-center gap-x-3' },
            h(
              'span',
              {
                class: 'row-span-2 text-center font-display text-lg text-gold-400',
              },
              wallName(i),
            ),
            h('span', { class: 'text-xs text-bone-400' }, side(p, i)),
            el,
          ),
        );
      }
      parts.push(
        walls,
        h(
          'button',
          {
            type: 'button',
            class: `${ghost} self-start`,
            onclick: () => canvas.fit(),
          },
          'Fit the drawing to the screen',
        ),
      );
    }

    if (st.id === 'doors') {
      parts.push(
        h(
          'div',
          { class: 'flex flex-col gap-2' },
          h('span', { class: small }, 'Door size'),
          h('div', { class: 'flex flex-wrap gap-2' }, ...DOOR_SIZES.map((sz) => chip(`${sz}′`, doorWidth === sz, () => ((doorWidth = sz), panel())))),
        ),
        h('p', { class: 'text-sm text-bone-400' }, counts(p.doors.length, 'door', 'doors')),
      );
    }

    if (st.id === 'curb') {
      const m = measureFloorMap(planToMap(p));
      parts.push(
        h(
          'p',
          { class: 'text-sm text-bone-400' },
          p.stemWalls.length
            ? `${formatFeet(m.stemWallFeet ?? 0)} of curb in all (it stops at doors).`
            : 'No curb marked. Skip this step if the floor meets the walls flat.',
        ),
        p.stemWalls.length
          ? h(
              'div',
              { class: 'flex flex-col gap-1' },
              ...p.stemWalls.map((r, k) => {
                const { from, to } = stemSpan(p, r);
                const whole = r.from === undefined && r.to === undefined;
                return h(
                  'button',
                  {
                    type: 'button',
                    class: `text-left text-sm ${selection?.kind === 'curb' && selection.i === k ? 'text-gold-400' : 'text-bone-200'} underline-offset-4 hover:underline`,
                    onclick: () => {
                      selection = { kind: 'curb', i: k };
                      canvas.draw();
                      panel();
                    },
                  },
                  `Wall ${wallName(r.wall)}: ${formatFeet(to - from)}${whole ? ', whole wall' : ''}`,
                );
              }),
            )
          : h(
              'button',
              {
                type: 'button',
                class: `${ghost} self-start`,
                onclick: () => change({ ...p, stemWalls: p.outline.map((_, i) => ({ wall: i })) }),
              },
              'Curb on every wall',
            ),
      );
    }

    if (st.id === 'cracks') {
      const m = measureFloorMap(planToMap(p));
      parts.push(
        h(
          'p',
          { class: 'text-sm text-bone-400' },
          p.cracks.length
            ? `${counts(p.cracks.length, 'crack', 'cracks')} ${formatFeet(m.crackFeet ?? 0)} in all.`
            : 'No cracks yet. Skip this step if there are none.',
        ),
      );
    }

    if (st.id === 'damage') {
      const m = measureFloorMap(planToMap(p));
      parts.push(
        h(
          'p',
          { class: 'text-sm text-bone-400' },
          p.spalls.length
            ? `${counts(p.spalls.length, 'patch', 'patches')} ${Math.round(m.spalledSqft ?? 0)} sq ft in all.`
            : 'Nothing marked. Skip this step if the concrete is sound.',
        ),
      );
    }

    if (st.id === 'coating') {
      const mode = p.oldCoating === 'none' ? 'none' : p.oldCoating === 'all' ? 'all' : 'some';
      parts.push(
        h(
          'div',
          { class: 'flex flex-col gap-2' },
          chip('No, bare concrete', mode === 'none', () => change({ ...p, oldCoating: 'none' })),
          chip('Yes, the whole floor', mode === 'all', () => change({ ...p, oldCoating: 'all' })),
          chip('Just some areas', mode === 'some', () => mode !== 'some' && change({ ...p, oldCoating: [] })),
        ),
        mode === 'some' ? h('p', { class: 'text-bone-200' }, 'Draw a loop around each coated area on the drawing.') : null,
      );
    }

    if (st.id === 'things') {
      parts.push(
        h('div', { class: 'flex flex-wrap gap-2' }, ...FIXTURES.map((k) => chip(fixtureLabel(k), fixtureKind === k, () => ((fixtureKind = k), panel())))),
        fixtureKind === 'step'
          ? h('p', { class: 'text-sm text-bone-400' }, 'Steps are priced each. Tap where the step meets the floor, then set its width.')
          : null,
        h('p', { class: 'text-sm text-bone-400' }, counts(p.fixtures.length, 'thing marked', 'things marked')),
      );
    }

    if (st.id === 'uncoated') {
      parts.push(
        h(
          'p',
          { class: 'text-sm text-bone-400' },
          p.excluded.length ? counts(p.excluded.length, 'area', 'areas') : 'Nothing left out. Skip this step if the whole floor gets coated.',
        ),
      );
    }

    if (st.id === 'price') parts.push(...pricePanel());

    parts.push(selectionBox());

    navEl.replaceChildren(
      ...[
        stepIx > 0
          ? h(
              'button',
              {
                type: 'button',
                class: `${ghost} fm-big`,
                onclick: () => goto(stepIx - 1),
              },
              '← Back',
            )
          : null,
        stepIx < STEPS.length - 1
          ? h(
              'button',
              {
                type: 'button',
                class: 'btn-gold fm-big',
                onclick: () => goto(stepIx + 1),
              },
              `Next: ${STEPS[stepIx + 1]!.short}`,
            )
          : null,
      ].filter((x): x is HTMLButtonElement => !!x),
    );
    panelEl.replaceChildren(...parts.filter((x): x is HTMLElement => !!x));

    // Always visible: size and price so far.
    try {
      const { m, q } = quoteNow();
      summary.replaceChildren(
        h(
          'div',
          { class: 'flex items-baseline justify-between gap-4' },
          h('span', { class: small }, 'Floor'),
          h('span', { class: 'font-display text-lg text-bone-50 tabular-nums' }, `${Math.round(m.sqft)} sq ft`),
        ),
        h(
          'div',
          { class: 'flex items-baseline justify-between gap-4' },
          h('span', { class: small }, 'Price so far'),
          h('span', { class: 'font-display text-2xl text-gold-400 tabular-nums' }, formatMoney(q.total)),
        ),
      );
    } catch {
      summary.replaceChildren(h('p', { class: 'text-sm text-bone-400' }, 'Draw the floor to see its size and price.'));
    }
    (undoBtn as HTMLButtonElement).disabled = !undo.length;
    (redoBtn as HTMLButtonElement).disabled = !redo.length;
  }

  function pricePanel(): HTMLElement[] {
    const map = planToMap(doc.plan);
    const problems = checkFloorMap(map);
    const out: HTMLElement[] = [];
    if (problems.length)
      out.push(
        h(
          'div',
          {
            class: 'border-l-2 border-red-400 pl-4 text-red-200',
            role: 'alert',
          },
          h('p', { class: 'font-semibold' }, 'Fix these first:'),
          h('ul', { class: 'mt-1 list-disc pl-5 text-sm' }, ...problems.map((pr) => h('li', {}, pr.message))),
        ),
      );
    if (!doc.plan.doors.length)
      out.push(
        h(
          'p',
          { class: 'border-l-2 border-gold-500 pl-4 text-sm text-bone-200' },
          'No garage door is marked. If there is one, go back to step 2: the curb and the edge work stop at doors.',
        ),
      );

    out.push(
      h(
        'div',
        { class: 'flex flex-col gap-2' },
        h('span', { class: small }, 'Moisture test'),
        h(
          'div',
          { class: 'grid grid-cols-3 gap-2' },
          ...(
            [
              ['untested', 'Not yet'],
              ['passed', 'Passed'],
              ['failed', 'Failed'],
            ] as const
          ).map(([v, label]) =>
            chip(label, doc.moisture === v, () => {
              doc.moisture = v;
              save();
              panel();
            }),
          ),
        ),
        doc.moisture === 'failed' ? h('p', { class: 'text-xs text-bone-400' }, 'The moisture-blocking primer is added to the quote.') : null,
      ),
    );

    const { m, q } = quoteNow();
    const rows: [string, string][] = [
      ['Floor', `${Math.round(m.sqft)} sq ft`],
      ['Cracks', formatFeet(m.crackFeet ?? 0)],
      ['Curb (stem wall)', formatFeet(m.stemWallFeet ?? 0)],
      ['Steps', String(m.steps ?? 0)],
      ['Damaged concrete', `${Math.round(m.spalledSqft ?? 0)} sq ft`],
      ['Old coating to grind off', `${Math.round(m.removalSqft ?? 0)} sq ft`],
      ['Garage doors', formatFeet(m.doorFeet)],
    ];
    out.push(
      h('p', { class: small }, 'Measured'),
      h(
        'dl',
        { class: '-mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm' },
        ...rows.flatMap(([k, v]) => [h('dt', { class: 'text-bone-400' }, k), h('dd', { class: 'text-right tabular-nums text-bone-50' }, v)]),
      ),
    );
    if (problems.length) return [...out, notesField()];

    out.push(quoteEditor(q), customerFields(), noteField(), pdfButton(q));
    out.push(notesField());
    return out;
  }

  /** Every line can be renamed, re-priced or taken out; the owner can add their own. */
  function quoteEditor(q: EditedFloorQuote) {
    const edits = doc.edits;
    const setLine = (id: string, e: { label?: string; amount?: number; removed?: boolean } | null) => {
      if (id.startsWith('x-')) return;
      const key = id as FloorLineId;
      if (e === null) delete edits.lines[key];
      else edits.lines[key] = { ...edits.lines[key], ...e };
      save();
    };
    const dollars = (cents: number) => (cents / 100).toFixed(cents % 100 ? 2 : 0);
    const moneyIn = (cents: number, onChange: (c: number) => void, label: string) => {
      const el = h('input', {
        class: `${input} fm-money`,
        inputmode: 'decimal',
        'aria-label': label,
      }) as HTMLInputElement;
      el.value = dollars(cents);
      el.addEventListener('focus', () => el.select());
      el.addEventListener('change', () => {
        const v = Number(el.value.replace(/[$,\s]/g, ''));
        if (Number.isFinite(v)) onChange(Math.round(v * 100));
        else el.value = dollars(cents);
      });
      return h('span', { class: 'flex items-center gap-1 text-bone-400' }, '$', el);
    };
    const textIn = (value: string, onChange: (t: string) => void, label: string) => {
      const el = h('input', {
        class: `${input} min-w-0 flex-1`,
        'aria-label': label,
      }) as HTMLInputElement;
      el.value = value;
      el.addEventListener('change', () => onChange(el.value));
      return el;
    };
    const list = h('div', { class: 'flex flex-col gap-3' });
    for (const l of q.lines) {
      const added = l.source === 'added';
      const row = h('div', { class: 'flex flex-col gap-1.5' });
      const line = h('div', { class: 'flex items-center gap-2' });
      if (l.id === 'minimum') {
        line.append(
          h('span', { class: 'min-w-0 flex-1 text-sm text-bone-200' }, `${l.label} (tops it up to the minimum)`),
          h('span', { class: 'fm-money tabular-nums text-bone-50' }, formatMoney(l.amount)),
        );
      } else if (added) {
        const x = edits.extras.find((e) => e.id === l.id)!;
        line.append(
          textIn(x.label, (t) => ((x.label = t), save(), panel()), 'What it is'),
          moneyIn(x.amount, (c) => ((x.amount = c), save(), panel()), 'Price'),
        );
      } else {
        line.append(
          textIn(l.label, (t) => (setLine(l.id, { label: t }), panel()), 'Line'),
          moneyIn(l.amount, (c) => (setLine(l.id, { amount: c }), panel()), 'Price'),
        );
      }
      const remove = h(
        'button',
        {
          type: 'button',
          class: 'px-2 text-xl leading-none text-bone-400 hover:text-red-300',
          'aria-label': `Take out ${l.label}`,
          title: 'Take this line out',
        },
        '×',
      );
      remove.addEventListener('click', () => {
        if (added) edits.extras = edits.extras.filter((e) => e.id !== l.id);
        else setLine(l.id, { removed: true });
        save();
        panel();
      });
      line.append(remove);
      row.append(line);
      if (l.source === 'changed' && l.formula)
        row.append(
          h(
            'p',
            { class: 'text-xs text-bone-400' },
            `Changed. The formula said ${formatMoney(l.formula.amount)}. `,
            h(
              'button',
              {
                type: 'button',
                class: 'underline underline-offset-2',
                onclick: () => (setLine(l.id, null), panel()),
              },
              'Use the formula',
            ),
          ),
        );
      list.append(row);
    }
    const removed = q.removed.length
      ? h(
          'div',
          { class: 'flex flex-wrap items-center gap-2 text-xs text-bone-400' },
          'Taken out:',
          ...q.removed.map((r) =>
            h(
              'button',
              {
                type: 'button',
                class: 'underline underline-offset-2',
                onclick: () => (setLine(r.id, { removed: false }), panel()),
              },
              `put back ${r.label}`,
            ),
          ),
        )
      : null;
    const add = (label: string, amount: number) => {
      edits.extras.push({ id: `x-${newId()}`, label, amount });
      save();
      panel();
      requestAnimationFrame(() => {
        const inputs = panelEl.querySelectorAll<HTMLInputElement>('[aria-label="What it is"]');
        inputs[inputs.length - 1]?.focus();
      });
    };
    return h(
      'div',
      { class: 'flex flex-col gap-3 border-t border-ink-800 pt-4' },
      h('p', { class: small }, 'Firm quote'),
      h(
        'p',
        { class: '-mt-1 text-sm text-bone-400' },
        'Change any wording or price, take a line out, or add one the formula doesn’t cover. A minus price is a discount.',
      ),
      list,
      removed,
      h(
        'div',
        { class: 'flex flex-wrap gap-2' },
        h('button', { type: 'button', class: ghost, onclick: () => add('', 0) }, '+ Add a line'),
        h(
          'button',
          {
            type: 'button',
            class: ghost,
            onclick: () => add('Discount', -10000),
          },
          '+ Discount',
        ),
      ),
      h(
        'p',
        { class: 'mt-1 flex items-baseline justify-between' },
        h('span', { class: 'text-bone-200' }, 'Total'),
        h('span', { class: 'font-display text-3xl text-gold-400 tabular-nums' }, formatMoney(q.total)),
      ),
      doc.moisture === 'untested'
        ? h('p', { class: 'text-sm text-bone-400' }, 'Do the moisture test before you give this price: a failed test adds the primer.')
        : null,
      h('p', { class: 'text-xs text-bone-500' }, 'Priced with the starting floor prices.'),
    );
  }

  function customerFields() {
    const c = doc.customer;
    const f = (label: string, key: keyof typeof c, type = 'text', auto = 'off') => {
      const el = h('input', {
        class: input,
        type,
        autocomplete: auto,
        'aria-label': label,
      }) as HTMLInputElement;
      el.value = c[key];
      el.addEventListener('input', () => {
        c[key] = el.value;
        if (key === 'name' && !doc.name) {
          doc.name = el.value.trim();
          nameEl.value = doc.name;
        }
        save();
      });
      return h('label', { class: 'flex flex-col gap-1' }, h('span', { class: small }, label), el);
    };
    return h(
      'div',
      { class: 'flex flex-col gap-3 border-t border-ink-800 pt-4' },
      h('p', { class: small }, 'On the quote'),
      f('Customer name', 'name'),
      f('Address', 'address'),
      f('Phone', 'phone', 'tel'),
      f('Email', 'email', 'email'),
    );
  }

  function noteField() {
    const el = h('textarea', {
      class: input,
      rows: 3,
      placeholder: 'Printed on the quote, e.g. what’s included or when we can start',
      'aria-label': 'Note for the customer',
    }) as HTMLTextAreaElement;
    el.value = doc.note;
    el.addEventListener('input', () => {
      doc.note = el.value;
      save();
    });
    return h('label', { class: 'flex flex-col gap-1' }, h('span', { class: small }, 'Note for the customer'), el);
  }

  function notesField() {
    const el = h('textarea', {
      class: input,
      rows: 3,
      placeholder: 'Only for us, not on the quote',
      'aria-label': 'Crew notes',
    }) as HTMLTextAreaElement;
    el.value = doc.notes;
    el.addEventListener('input', () => {
      doc.notes = el.value;
      save();
    });
    return h('label', { class: 'flex flex-col gap-1 border-t border-ink-800 pt-4' }, h('span', { class: small }, 'Crew notes'), el);
  }

  function pdfButton(q: EditedFloorQuote) {
    const status = h('span', {
      class: 'text-sm text-bone-400',
      role: 'status',
    });
    const btn = h('button', { type: 'button', class: 'btn-gold fm-big' }, 'Download the quote (PDF)') as HTMLButtonElement;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      status.textContent = 'Making the PDF…';
      try {
        const { quotePdf } = await import('./floormap-pdf');
        const m = measureFloorMap(planToMap(doc.plan));
        const blob = await quotePdf({
          quoteNo: doc.quoteNo,
          date: new Date(),
          customer: doc.customer,
          plan: doc.plan,
          quote: q,
          moisture: doc.moisture,
          primerIfFailed: Math.round(m.sqft) * defaultFloorConfig.moisturePrimer.rate,
          note: doc.note,
        });
        const url = URL.createObjectURL(blob);
        const a = h('a', {
          href: url,
          download: `Quote ${doc.quoteNo}${doc.customer.name ? ` - ${doc.customer.name.replace(/[\\/:*?"<>|]/g, '')}` : ''}.pdf`,
        });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        status.textContent = `Downloaded quote ${doc.quoteNo}.`;
      } catch (err) {
        status.textContent = `Couldn’t make the PDF: ${(err as Error).message}`;
      } finally {
        btn.disabled = false;
      }
    });
    return h(
      'div',
      { class: 'flex flex-col gap-2 border-t border-ink-800 pt-4' },
      btn,
      status,
      h('p', { class: 'text-xs text-bone-500' }, `Quote ${doc.quoteNo}. Turning a quote into an invoice comes once floors has its own books and Stripe.`),
    );
  }

  // Keyboard: undo/redo, delete the selection.
  const onKey = (e: KeyboardEvent) => {
    if (!document.body.contains(canvas.el)) return document.removeEventListener('keydown', onKey);
    const typing = (e.target as HTMLElement).closest('input, textarea');
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) {
      e.preventDefault();
      if (e.shiftKey) doRedo();
      else doUndo();
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && selection) {
      const del = panelEl.querySelector<HTMLButtonElement>('[data-remove]');
      del?.click();
    }
  };
  document.addEventListener('keydown', onKey);

  const zoomBar = h(
    'div',
    { class: 'absolute right-3 top-3 flex flex-col gap-2' },
    h(
      'button',
      {
        type: 'button',
        class: `${ghost} bg-ink-950/90 text-lg`,
        'aria-label': 'Zoom in',
        onclick: () => canvas.zoom(1.25),
      },
      '+',
    ),
    h(
      'button',
      {
        type: 'button',
        class: `${ghost} bg-ink-950/90 text-lg`,
        'aria-label': 'Zoom out',
        onclick: () => canvas.zoom(0.8),
      },
      '−',
    ),
    h(
      'button',
      {
        type: 'button',
        class: `${ghost} bg-ink-950/90 text-xs`,
        onclick: () => canvas.fit(),
      },
      'Fit',
    ),
  );
  canvas.el.append(
    zoomBar,
    h(
      'p',
      {
        class: 'pointer-events-none absolute bottom-2 left-3 text-xs text-bone-500',
      },
      'Zoom with + and −. Drag empty space to move. On a phone: two fingers.',
    ),
  );

  view().replaceChildren(
    h(
      'div',
      {},
      h(
        'div',
        { class: 'flex flex-wrap items-center gap-3' },
        h(
          'button',
          {
            type: 'button',
            class: 'text-sm text-bone-400 underline underline-offset-4',
            onclick: showList,
          },
          '← All floor maps',
        ),
        nameEl,
        h('span', { class: 'ml-auto flex items-center gap-2' }, status, undoBtn, redoBtn),
      ),
      stepsBar,
      tip,
      tipControls,
      h(
        'div',
        {
          class: 'mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start',
        },
        // On a computer the drawing, with the floor size and price under
        // it, stays in view while the page scrolls the steps beside it: no
        // box-in-a-box scrolling (Brett hated it).
        h('div', { class: 'fm-stick flex flex-col gap-3' }, canvas.el, summary),
        h('aside', { class: 'flex flex-col gap-5' }, panelEl, navEl),
      ),
    ),
  );
  drawSteps();
  panel();
  requestAnimationFrame(() => canvas.fit());
}
