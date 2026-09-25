/**
 * Pieces the Inventory tab's files share: the API's shapes, number and money
 * formatting, and a busy/status helper for the tab's many small forms.
 */
import { Failed, type Child, h } from './core';

export interface Item {
  id: string;
  name: string;
  /** Stored in 13-digit form for UPC-A (a leading 0 is added to 12-digit codes). */
  barcode: string | null;
  unit: string;
  onHand: number;
  reorderAt: number | null;
  reorderUrl: string | null;
  /** Cents per unit. */
  cost: number | null;
  notes: string | null;
  archived: boolean;
  low: boolean;
  updatedAt: string;
}

export type Reason = 'restock' | 'used' | 'adjust';

export interface Movement {
  id: string;
  delta: number;
  reason: Reason;
  jobId: string | null;
  onHand: number;
  note: string | null;
  createdAt: string;
}

/** Counts can be fractions (0.25 gal); the server keeps 3 places. */
export const qty = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 3 });
/** Units people count in get an s ("4 bottles"); measures don't ("4 gal"). */
const PLURAL: Record<string, string> = {
  bottle: 'bottles', can: 'cans', box: 'boxes', pack: 'packs', pad: 'pads', towel: 'towels', roll: 'rolls',
  bag: 'bags', jug: 'jugs', case: 'cases', pair: 'pairs', kit: 'kits', brush: 'brushes', sponge: 'sponges', bar: 'bars',
};
export const amount = (n: number, unit: string) => `${qty(n)} ${n === 1 ? unit : (PLURAL[unit.toLowerCase()] ?? unit)}`;

/** $12.50, $0.45, $30: cents only when there are some. */
export const money = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

export const costText = (i: Pick<Item, 'cost' | 'unit'>) => (i.cost === null ? 'No cost set' : `${money(i.cost)} ${i.unit === 'each' ? 'each' : `per ${i.unit}`}`);

/** The same rule as the server: a 12-digit UPC-A gets a leading 0. */
export const normalizeCode = (code: string) => {
  const c = code.trim().replace(/\s+/g, '');
  return /^\d{12}$/.test(c) ? `0${c}` : c;
};

/** Show the code the way it's printed on the bottle (12 digits for UPC-A). */
export const printedCode = (code: string) => (/^0\d{12}$/.test(code) ? code.slice(1) : code);

/** Digits only, long enough to be a barcode rather than a count or a name. */
export const looksLikeCode = (q: string) => /^\d{6,14}$/.test(q.replace(/\s+/g, ''));

export const codeMatches = (i: Item, q: string) => {
  const c = q.replace(/\s+/g, '');
  return !!i.barcode && c.length > 0 && i.barcode.includes(c);
};

export const subhead = (text: string, extra = '') => h('h3', { class: `mb-3 font-display text-sm uppercase tracking-[0.14em] text-gold-400 ${extra}` }, text);

const quiet = 'text-sm text-bone-400';
const bad = 'text-sm text-red-300';

export const statusLine = () => h('p', { class: quiet, role: 'status' });

export function sayError(status: HTMLElement, err: unknown) {
  if (err instanceof Failed && err.message === 'Signed out.') return;
  status.className = bad;
  status.replaceChildren(
    (err as Error).message,
    ...(err instanceof Failed && err.details.length ? [h('ul', { class: 'mt-1 list-disc pl-5' }, ...err.details.map((d) => h('li', {}, d)))] : []),
  );
}

export function say(status: HTMLElement, ...children: Child[]) {
  status.className = quiet;
  status.replaceChildren(...children.filter((c): c is Node | string => !!c));
}

/** Disable the button while `work` runs; its message (or the error) lands in `status`. */
export async function busy(btn: HTMLButtonElement, status: HTMLElement, work: () => Promise<string | void>) {
  btn.disabled = true;
  say(status, 'Saving…');
  try {
    say(status, (await work()) ?? '');
  } catch (err) {
    sayError(status, err);
  } finally {
    btn.disabled = false;
  }
}

/** The site's Lenis smooth scroll ignores scrollIntoView, so ask it first (see motion.ts). */
export function scrollToEl(el: Element) {
  const handled = !document.dispatchEvent(new CustomEvent('ked:scroll-to', { detail: el, cancelable: true }));
  if (!handled) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

/** Underlined choice buttons, styled like the admin's own tab bar. */
export function choice<T extends string>(options: [T, string][], get: () => T, set: (v: T) => void, label: string) {
  const wrap = h('div', { class: 'flex flex-wrap gap-x-5 border-b border-ink-800', role: 'group', 'aria-label': label });
  const draw = () =>
    wrap.replaceChildren(
      ...options.map(([value, text]) =>
        h(
          'button',
          {
            type: 'button',
            'aria-pressed': String(get() === value),
            class:
              '-mb-px border-b-2 border-transparent py-2 font-display text-[0.74rem] uppercase tracking-[0.16em] text-bone-400 transition-colors hover:text-bone-50 ' +
              'aria-pressed:border-gold-500 aria-pressed:text-bone-50',
            onclick: () => {
              set(value);
              draw();
            },
          },
          text,
        ),
      ),
    );
  draw();
  return wrap;
}
