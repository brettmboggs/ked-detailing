/**
 * Books → Settings: the few numbers the books need (the IRS mileage rate each
 * year, the 1099 line, when to ask for a receipt, sales tax), plus light
 * upkeep of stores and helpers, and of categories and accounts.
 */
import { validateBooksSettings, type BooksSettings } from '@ked/books';
import { Failed, h, api, small } from './core';
import type { BooksCtx } from './books';
import {
  type BooksAccount,
  type Payee,
  button,
  goldSmall,
  labelled,
  loadBooks,
  moneyInput,
  parseCents,
  rowRule,
  select,
  statusLine,
  subHead,
  textBtn,
  textInput,
  today,
} from './books-lib';

export async function renderSettings(host: HTMLElement, ctx: BooksCtx) {
  const [{ settings, updatedAt }, { payees }] = await Promise.all([
    api<{ settings: BooksSettings; updatedAt: string | null }>('/settings/books'),
    api<{ payees: Payee[] }>('/books/payees'),
  ]);
  host.replaceChildren(settingsForm(structuredClone(settings), updatedAt, ctx), payeesList(payees), accountsList(ctx));
}

/* ------------------------------------------------------------ numbers */

function settingsForm(s: BooksSettings, updatedAt: string | null, ctx: BooksCtx) {
  const rates = h('div', { class: 'flex flex-col gap-3' });
  const drawRates = () => {
    rates.replaceChildren(
      ...Object.keys(s.mileageRates)
        .sort()
        .reverse()
        .map((year) => {
          const cents = textInput({ value: String(s.mileageRates[year]), inputmode: 'decimal' });
          cents.classList.add('w-28');
          cents.addEventListener('input', () => (s.mileageRates[year] = Number(cents.value)));
          return h(
            'div',
            { class: 'flex items-end gap-4' },
            labelled(`IRS rate for ${year} (cents a mile)`, cents),
            button('Remove', textBtn, () => {
              delete s.mileageRates[year];
              drawRates();
            }),
          );
        }),
    );
  };
  drawRates();
  const newYear = String(Number(today().slice(0, 4)) + (s.mileageRates[today().slice(0, 4)] ? 1 : 0));
  const addYear = button(`Add the rate for ${newYear}`, textBtn, () => {
    if (!s.mileageRates[newYear]) s.mileageRates[newYear] = s.mileageRates[String(Number(newYear) - 1)] ?? 70;
    drawRates();
    addYear.hidden = true;
  });
  addYear.hidden = !!s.mileageRates[newYear];

  const threshold = moneyInput(s.contractor1099Threshold);
  const receipt = moneyInput(s.receiptPromptOver);
  const taxOn = h('input', { type: 'checkbox', class: 'size-4 accent-[#e8b14c]', checked: s.salesTax.enabled }) as HTMLInputElement;
  const taxRate = textInput({ value: String(s.salesTax.rate), inputmode: 'decimal' });
  const rateWrap = labelled('Sales tax rate (%)', taxRate, 'sm:max-w-[12rem]');
  rateWrap.hidden = !taxOn.checked;
  taxOn.addEventListener('change', () => (rateWrap.hidden = !taxOn.checked));

  const status = statusLine();
  const save = button('Save settings', goldSmall, (b) =>
    status.run(b, async () => {
      const t = parseCents(threshold.value);
      const r = receipt.value.trim() === '' || receipt.value.trim() === '0' ? 0 : parseCents(receipt.value);
      if (t === null) throw new Error('Type the 1099 amount, like 600.');
      if (r === null) throw new Error('Type the receipt amount, like 75.');
      const next: BooksSettings = {
        ...s,
        contractor1099Threshold: t,
        receiptPromptOver: r,
        salesTax: { enabled: taxOn.checked, rate: Number(taxRate.value) || 0 },
      };
      const problems = validateBooksSettings(next);
      if (problems.length) throw new Failed('Some settings need fixing.', problems);
      await api('/settings/books', { method: 'PUT', body: next });
      ctx.books.settings = next;
      return 'Saved.';
    }),
  );

  return h(
    'div',
    { class: 'max-w-2xl' },
    subHead('Settings', updatedAt ? null : 'These are still the starting settings.'),
    h(
      'div',
      { class: 'flex flex-col gap-6' },
      h(
        'div',
        { class: 'flex flex-col gap-2' },
        h('p', { class: 'text-sm text-bone-400' }, 'The IRS sets a new mileage rate each December. Look up "IRS standard mileage rate" and type it here.'),
        rates,
        h('p', {}, addYear),
      ),
      labelled('Ask me for a receipt when I spend at least ($)', receipt, 'sm:max-w-sm'),
      h(
        'div',
        { class: 'flex flex-col gap-1' },
        labelled('Flag helpers for a 1099 when paid at least ($)', threshold, 'sm:max-w-sm'),
        h('p', { class: 'text-xs text-bone-500' }, 'Leave this at 600 unless your accountant says the IRS changed it.'),
      ),
      h('div', { class: 'flex flex-col gap-3' }, h('label', { class: 'flex items-center gap-2 text-sm text-bone-200' }, taxOn, 'I charge sales tax'), rateWrap),
      h('div', { class: 'flex flex-wrap items-center gap-4' }, save, status.el),
    ),
  );
}

/* ---------------------------------------------------- stores, helpers */

function payeesList(payees: Payee[]) {
  return h(
    'div',
    { class: 'max-w-3xl' },
    subHead(
      'Stores and helpers',
      'Everyone you have paid. Mark people you pay to help you (not stores) as helpers, so they show up for the 1099 form. Tick W-9 once they have filled one out for you. Never write down their Social Security number here.',
    ),
    payees.length
      ? h(
          'ul',
          { class: 'border-t border-ink-800' },
          ...payees.map((p) => {
            const status = statusLine();
            const kind = select([['vendor', 'Store or company'], ['contractor', 'Helper I pay']], p.kind);
            kind.classList.add('sm:w-48');
            const w9 = h('input', { type: 'checkbox', class: 'size-4 accent-[#e8b14c]', checked: p.taxFormOnFile }) as HTMLInputElement;
            const w9Label = h('label', { class: 'flex items-center gap-2 text-sm text-bone-200', hidden: p.kind !== 'contractor' }, w9, 'W-9 on file');
            const patch = (body: Record<string, unknown>, said: string) =>
              status.run(null, async () => {
                await api(`/books/payees/${p.id}`, { method: 'PATCH', body });
                return said;
              });
            kind.addEventListener('change', () => {
              w9Label.hidden = kind.value !== 'contractor';
              void patch({ kind: kind.value }, 'Saved.');
            });
            w9.addEventListener('change', () => void patch({ taxFormOnFile: w9.checked }, 'Saved.'));
            return h(
              'li',
              { class: `${rowRule} grid gap-2 py-3 sm:grid-cols-[1fr_auto_8rem] sm:items-center sm:gap-6` },
              h('div', { class: 'min-w-0' }, h('p', { class: 'truncate text-bone-50' }, p.name), status.el),
              kind,
              w9Label,
            );
          }),
        )
      : h('p', { class: 'text-sm text-bone-400' }, 'Nobody yet. They are added when you type a name in "Paid to".'),
  );
}

/* ------------------------------------------------- categories, accounts */

const NEW_KINDS: [string, string][] = [
  ['expense', 'A kind of spending'],
  ['income', 'A kind of money in'],
  ['bank', 'A bank account'],
  ['card', 'A credit card'],
];

function accountsList(ctx: BooksCtx) {
  const wrap = h('div', { class: 'max-w-3xl' });
  const draw = () => {
    const groups: [string, BooksAccount[]][] = [
      ['Bank, card and cash', ctx.books.accounts.filter((a) => a.moneyAccount)],
      ['Kinds of spending', ctx.books.accounts.filter((a) => a.type === 'expense')],
      ['Kinds of money in', ctx.books.accounts.filter((a) => a.type === 'income')],
    ];
    const reload = async () => {
      ctx.books = await loadBooks();
      draw();
    };

    const name = textInput({ placeholder: 'Like: Detailing classes' });
    const kind = select(NEW_KINDS, 'expense');
    const hint = textInput({ placeholder: 'What goes here (optional)' });
    const status = statusLine();
    const add = button('Add it', goldSmall, (b) =>
      status.run(b, async () => {
        if (!name.value.trim()) throw new Error('Give it a name.');
        const k = kind.value;
        const body =
          k === 'bank'
            ? { name: name.value.trim(), type: 'asset', moneyAccount: true }
            : k === 'card'
              ? { name: name.value.trim(), type: 'liability', moneyAccount: true }
              : { name: name.value.trim(), type: k, ...(hint.value.trim() ? { hint: hint.value.trim() } : {}) };
        await api('/books/accounts', { method: 'POST', body });
        await reload();
      }),
    );

    wrap.replaceChildren(
      subHead('Categories and accounts', 'Hide ones you never use, so they stop showing in the lists. Hidden ones keep their history.'),
      ...groups.map(([title, list]) =>
        h(
          'div',
          { class: 'mb-6' },
          h('p', { class: `${small} mb-2` }, title),
          h(
            'ul',
            { class: 'border-t border-ink-800' },
            ...list.map((a) => {
              const st = statusLine();
              return h(
                'li',
                { class: `${rowRule} flex flex-wrap items-center justify-between gap-x-6 gap-y-1 py-2` },
                h(
                  'div',
                  { class: 'min-w-0' },
                  h('p', { class: a.archived ? 'text-bone-500 line-through' : 'text-bone-50' }, a.name),
                  a.hint ? h('p', { class: 'text-xs text-bone-500' }, a.hint) : null,
                  st.el,
                ),
                button(a.archived ? 'Show again' : 'Hide', textBtn, (b) =>
                  st.run(b, async () => {
                    await api(`/books/accounts/${a.id}`, { method: 'PATCH', body: { archived: !a.archived } });
                    await reload();
                  }),
                ),
              );
            }),
          ),
        ),
      ),
      h(
        'div',
        { class: 'flex flex-col gap-3 border-l-2 border-ink-700 pl-4' },
        h('p', { class: 'text-bone-50' }, 'Add a new one'),
        h('div', { class: 'grid gap-3 sm:grid-cols-3' }, labelled('Name', name), labelled('It is', kind), labelled('Hint', hint)),
        h('div', { class: 'flex flex-wrap items-center gap-4' }, add, status.el),
      ),
    );
  };
  draw();
  return wrap;
}
