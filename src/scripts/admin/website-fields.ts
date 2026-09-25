/**
 * Form pieces for the Website tab: text fields with "Put back the original",
 * and list editors (questions, reviews) with add, move and remove.
 *
 * Each piece redraws its own reset link through `changed()`, which the tab
 * calls after every edit.
 */
import { type Child, h, input, small, ghost } from './core';

const watchers = new Set<() => void>();

/** Tell every field to re-check whether it differs from the original. */
export function changed() {
  for (const w of watchers) w();
}

/** Forget the fields of a view that's being redrawn. */
export function resetWatchers() {
  watchers.clear();
}

export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** "Put back the original" link, shown only while the value differs. */
export function resetLink(isChanged: () => boolean, reset: () => void, label = 'Put back the original') {
  const btn = h('button', { type: 'button', class: 'text-xs text-gold-400 underline decoration-ink-600 underline-offset-4 hover:text-gold-300' }, label) as HTMLButtonElement;
  btn.addEventListener('click', () => {
    reset();
    changed();
  });
  const sync = () => (btn.hidden = !isChanged());
  watchers.add(sync);
  sync();
  return btn;
}

/** A label row: the name on the left, the reset link on the right. */
export const labelRow = (label: string, ...right: Child[]) =>
  h('span', { class: 'flex items-baseline justify-between gap-3' }, h('span', { class: small }, label), ...right);

/**
 * One text field. `lines` > 1 makes it a text box. The counter appears when
 * it's getting close to the most the site allows.
 */
export function textField(
  label: string,
  get: () => string,
  set: (v: string) => void,
  /** null for a field inside a list, which resets as a whole list. */
  original: string | null,
  opts: { max: number; lines?: number; hint?: string; wide?: boolean; type?: string; inputmode?: string } = { max: 200 },
) {
  const multi = (opts.lines ?? 1) > 1;
  const el = (multi
    ? h('textarea', { class: `${input} leading-relaxed`, rows: String(opts.lines), 'aria-label': label })
    : h('input', { class: input, type: opts.type ?? 'text', inputmode: opts.inputmode, 'aria-label': label })) as HTMLInputElement | HTMLTextAreaElement;
  el.value = get();
  const count = h('span', { class: 'text-xs tabular-nums text-bone-500' });
  const showCount = () => {
    const n = el.value.trim().length;
    count.textContent = n > opts.max * 0.8 ? `${n} of ${opts.max}` : '';
    count.className = `text-xs tabular-nums ${n > opts.max ? 'text-red-300' : 'text-bone-500'}`;
  };
  el.addEventListener('input', () => {
    set(el.value);
    showCount();
    changed();
  });
  showCount();
  const reset =
    original === null
      ? null
      : resetLink(
          () => get().trim() !== original,
          () => {
            set(original);
            el.value = original;
            showCount();
          },
        );
  return h(
    'label',
    { class: `flex flex-col gap-1 ${opts.wide || multi ? 'sm:col-span-2' : ''}` },
    labelRow(label, reset),
    el,
    h('span', { class: 'flex justify-between gap-3' }, opts.hint ? h('span', { class: 'text-xs text-bone-500' }, opts.hint) : h('span'), count),
  );
}

/** A text box holding one item per line, for short lists (what's included, scrolling names). */
export function linesField(label: string, get: () => string[], set: (v: string[]) => void, original: string[], opts: { hint: string; lines?: number }) {
  const toList = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean);
  const el = h('textarea', { class: `${input} leading-relaxed`, rows: String(opts.lines ?? 6), 'aria-label': label }) as HTMLTextAreaElement;
  el.value = get().join('\n');
  el.addEventListener('input', () => {
    set(toList(el.value));
    changed();
  });
  const reset = resetLink(
    () => !same(get(), original),
    () => {
      set([...original]);
      el.value = original.join('\n');
    },
  );
  return h('label', { class: 'flex flex-col gap-1 sm:col-span-2' }, labelRow(label, reset), el, h('span', { class: 'text-xs text-bone-500' }, opts.hint));
}

/** Two or more fields side by side on a wide screen, stacked on a phone. */
export const fields = (...children: Child[]) => h('div', { class: 'grid gap-4 sm:grid-cols-2' }, ...children);

/** A group inside a section, under a hairline rule. */
export const group = (title: string | null, ...children: Child[]) =>
  h('div', { class: 'border-t border-ink-800 py-6' }, title ? h('p', { class: 'mb-4 font-semibold text-bone-50' }, title) : null, ...children);

/**
 * A list Jacob can add to, reorder and trim: questions, reviews, photos.
 * `row` draws one item's fields; the list redraws itself when it changes shape.
 */
export function listEditor<T>(opts: {
  get: () => T[];
  set: (v: T[]) => void;
  original: T[];
  noun: string;
  min: number;
  max: number;
  blank: () => T;
  title: (item: T, i: number) => string;
  row: (item: T, i: number) => Node;
}) {
  const box = h('div');
  const draw = () => {
    const items = opts.get();
    const move = (i: number, by: number) => {
      const next = [...items];
      const [it] = next.splice(i, 1);
      next.splice(i + by, 0, it!);
      opts.set(next);
      draw();
      changed();
    };
    const control = (label: string, onclick: () => void, disabled: boolean) =>
      h('button', { type: 'button', class: `${ghost} !px-2 !py-1 !text-xs`, disabled, onclick }, label);
    box.replaceChildren(
      ...items.map((item, i) =>
        h(
          'div',
          { class: 'border-t border-ink-800 py-5' },
          h(
            'div',
            { class: 'mb-3 flex flex-wrap items-center justify-between gap-3' },
            h('p', { class: 'font-semibold text-bone-50' }, opts.title(item, i)),
            h(
              'div',
              { class: 'flex gap-2' },
              control('Move up', () => move(i, -1), i === 0),
              control('Move down', () => move(i, 1), i === items.length - 1),
              control('Remove', () => {
                opts.set(items.filter((_, j) => j !== i));
                draw();
                changed();
              }, items.length <= opts.min),
            ),
          ),
          opts.row(item, i),
        ),
      ),
      h(
        'div',
        { class: 'flex flex-wrap items-center gap-4 border-t border-ink-800 pt-5' },
        items.length < opts.max
          ? h('button', { type: 'button', class: ghost, onclick: () => (opts.set([...items, opts.blank()]), draw(), changed()) }, `Add ${opts.noun}`)
          : h('p', { class: 'text-sm text-bone-500' }, `That's the most the page holds (${opts.max}).`),
        listReset,
      ),
    );
  };
  const listReset = resetLink(
    () => !same(opts.get(), opts.original),
    () => {
      opts.set(structuredClone(opts.original));
      draw();
    },
    'Put back the original list',
  );
  draw();
  return box;
}
