/**
 * Each package's usual products (GET/PUT /inventory/usage). When Jacob
 * finishes a job in the app, "what did you use?" starts from these amounts.
 * Package ids come from the pricing config.
 */
import type { PricingConfig } from '@ked/pricing';
import { h, api, input, ghost, sectionHead } from './core';
import { type Item, busy, say, sayError, statusLine } from './inventory-shared';

interface Row {
  itemId: string;
  amount: number | null;
}
type Usage = Record<string, { itemId: string; name: string; unit: string; amount: number }[]>;

export function usageSection(getItems: () => Item[]) {
  const el = h('div', { class: 'mt-16' });
  let services: PricingConfig['services'] = [];
  const drafts = new Map<string, Row[]>();

  const load = async () => {
    const [{ config }, { usage }] = await Promise.all([api<{ config: PricingConfig }>('/pricing'), api<{ usage: Usage }>('/inventory/usage')]);
    services = config.services;
    drafts.clear();
    for (const s of services) drafts.set(s.id, (usage[s.id] ?? []).map((u) => ({ itemId: u.itemId, amount: u.amount })));
    draw();
  };

  const draw = () => {
    const items = getItems()
      .filter((i) => !i.archived)
      .sort((a, b) => a.name.localeCompare(b.name));
    el.replaceChildren(
      sectionHead(
        'What each package uses',
        'How much of each product one job usually takes. When you finish a job in the app, it starts with these amounts, so you only fix what was different.',
      ),
      ...(items.length ? services.map((s) => block(s, items)) : [h('p', { class: 'text-bone-400' }, 'Add your products above first.')]),
    );
  };

  const block = (s: PricingConfig['services'][number], items: Item[]) => {
    const rows = drafts.get(s.id)!;
    const list = h('div', { class: 'flex flex-col gap-3' });
    const status = statusLine();
    const byId = new Map(items.map((i) => [i.id, i]));

    const drawRows = () => {
      list.replaceChildren(
        ...(rows.length
          ? rows.map((r, idx) => {
              const pick = h(
                'select',
                { class: `${input} min-w-0`, 'aria-label': 'Product' },
                h('option', { value: '' }, 'Pick a product'),
                ...items.map((i) => h('option', { value: i.id, selected: i.id === r.itemId }, i.name)),
              ) as HTMLSelectElement;
              pick.value = r.itemId;
              const unit = h('span', { class: 'w-14 shrink-0 truncate text-sm text-bone-400' }, byId.get(r.itemId)?.unit ?? '');
              pick.addEventListener('change', () => {
                r.itemId = pick.value;
                unit.textContent = byId.get(r.itemId)?.unit ?? '';
              });
              const amt = h('input', {
                class: input.replace('w-full', 'w-24'),
                type: 'number',
                inputmode: 'decimal',
                step: 'any',
                min: '0',
                'aria-label': 'Amount per job',
              }) as HTMLInputElement;
              amt.value = r.amount === null ? '' : String(r.amount);
              amt.addEventListener('input', () => {
                const n = Number(amt.value);
                r.amount = amt.value.trim() === '' || !Number.isFinite(n) ? null : n;
              });
              const remove = h(
                'button',
                {
                  type: 'button',
                  class: 'shrink-0 px-1 py-2 text-sm text-bone-400 underline decoration-ink-600 underline-offset-4 hover:text-bone-50',
                  onclick: () => {
                    rows.splice(idx, 1);
                    drawRows();
                  },
                },
                'Remove',
              );
              return h(
                'div',
                { class: 'grid items-center gap-2 border-b border-ink-800 pb-3 sm:grid-cols-[minmax(0,22rem)_auto] sm:border-0 sm:pb-0' },
                pick,
                h('div', { class: 'flex items-center gap-2' }, amt, unit, remove),
              );
            })
          : [h('p', { class: 'text-sm text-bone-400' }, 'Nothing listed yet.')]),
      );
    };
    drawRows();

    const add = h(
      'button',
      {
        type: 'button',
        class: ghost,
        onclick: () => {
          rows.push({ itemId: '', amount: null });
          drawRows();
          list.querySelector<HTMLSelectElement>('div:last-child select')?.focus();
        },
      },
      'Add a product',
    );
    const save = h('button', { type: 'button', class: `${ghost} border-gold-500 text-bone-50` }, 'Save') as HTMLButtonElement;
    save.addEventListener('click', () => {
      const chosen = rows.filter((r) => r.itemId);
      const ids = chosen.map((r) => r.itemId);
      if (new Set(ids).size !== ids.length) return sayError(status, new Error('Each product can only be listed once.'));
      if (chosen.some((r) => r.amount === null || r.amount <= 0)) return sayError(status, new Error('Give each product an amount above zero, or remove it.'));
      if (chosen.length > 20) return sayError(status, new Error('Up to 20 products per package.'));
      void busy(save, status, async () => {
        const res = await api<{ items: Usage[string] }>(`/inventory/usage/${encodeURIComponent(s.id)}`, {
          method: 'PUT',
          body: { items: chosen.map((r) => ({ itemId: r.itemId, amount: r.amount })) },
        });
        rows.splice(0, rows.length, ...res.items.map((u) => ({ itemId: u.itemId, amount: u.amount })));
        drawRows();
        return 'Saved.';
      });
    });

    say(status);
    return h(
      'div',
      { class: 'border-t border-ink-800 py-5' },
      h('p', { class: 'mb-3 font-semibold text-bone-50' }, s.level ? `${s.level}: ${s.name}` : s.name),
      list,
      h('div', { class: 'mt-4 flex flex-wrap items-center gap-3' }, add, save, status),
    );
  };

  return { el, load, draw };
}
