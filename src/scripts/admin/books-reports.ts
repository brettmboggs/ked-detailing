/**
 * Books → Reports: how the business did (profit and loss), what's in each
 * account, the tax-form lines, drives, and helpers who need a 1099. Plus the
 * CSV files an accountant asks for, downloaded with the owner's session.
 */
import { type Child, h, api, small } from './core';
import type { BooksCtx } from './books';
import {
  type Trip,
  askFirst,
  button,
  dateInput,
  download,
  kids,
  labelled,
  periods,
  rowRule,
  select,
  shortDate,
  statusLine,
  subHead,
  textBtn,
  usd,
} from './books-lib';

interface PL {
  from: string;
  to: string;
  income: { accountId: string; name: string; scheduleC: string | null; total: number }[];
  expenses: { accountId: string; name: string; scheduleC: string | null; total: number }[];
  totalIncome: number;
  costOfGoods: number;
  totalExpenses: number;
  net: number;
  scheduleC: { line: string; label: string; total: number }[];
}
interface Balances {
  asOf: string;
  accounts: { accountId: string; name: string; type: string; balance: number }[];
}
interface Mileage {
  year: string;
  miles: number;
  trips: number;
  centsPerMile: number | null;
  deduction: number | null;
}
interface Contractors {
  year: string;
  threshold: number;
  contractors: { payeeId: string; name: string; taxFormOnFile: boolean; total: number; needs1099: boolean }[];
}

const state = { period: 'year', from: '', to: '' };

export async function renderReports(host: HTMLElement, ctx: BooksCtx) {
  const ps = periods();
  const period = select([...ps.map((p): [string, string] => [p.key, p.label]), ['custom', 'Pick dates…']], state.period);
  const from = dateInput(state.from || ps[3]!.from);
  const to = dateInput(state.to || ps[3]!.to);
  const custom = h('div', { class: 'grid grid-cols-2 gap-3', hidden: period.value !== 'custom' }, labelled('From', from), labelled('To', to));
  const out = h('div');

  const range = () => {
    if (period.value === 'custom') return { from: from.value, to: to.value };
    const p = ps.find((x) => x.key === period.value) ?? ps[3]!;
    return { from: p.from, to: p.to };
  };

  async function load() {
    state.period = period.value;
    state.from = from.value;
    state.to = to.value;
    custom.hidden = period.value !== 'custom';
    const r = range();
    if (!r.from || !r.to || r.from > r.to) {
      out.replaceChildren(h('p', { class: 'mt-6 text-bone-400' }, 'Pick a start date before the end date.'));
      return;
    }
    const year = r.to.slice(0, 4);
    out.replaceChildren(h('p', { class: 'mt-6 text-bone-400' }, 'Loading…'));
    const [pl, bal, miles, trips, helpers] = await Promise.all([
      api<PL>(`/books/reports/profit-loss?from=${r.from}&to=${r.to}`),
      api<Balances>('/books/reports/balances'),
      api<Mileage>(`/books/reports/mileage?year=${year}`),
      api<{ trips: Trip[] }>(`/books/trips?year=${year}`),
      api<Contractors>(`/books/reports/contractors?year=${year}`),
    ]);
    out.replaceChildren(
      ...kids(
      profitLoss(pl),
      balances(bal, ctx),
      taxLines(pl),
      mileage(miles, trips.trips, ctx, load),
      contractors(helpers),
      downloads(r, year),
      ),
    );
  }

  for (const el of [period, from, to]) el.addEventListener('change', () => void load().catch((err: Error) => out.replaceChildren(h('p', { class: 'mt-6 text-red-300' }, err.message))));

  host.replaceChildren(
    h('div', { class: 'flex max-w-xl flex-col gap-3' }, labelled('Show me', period), custom),
    out,
  );
  await load();
}

/* ----------------------------------------------------------- pieces */

const money = (c: number, cls = '') => h('span', { class: `tabular-nums ${cls}` }, usd(c));

const bigNumber = (label: string, cents: number, tone = 'text-bone-50') =>
  h(
    'div',
    { class: 'min-w-0 border-b border-ink-800 py-4 sm:border-b-0 sm:border-r sm:px-6 sm:first:pl-0 sm:last:border-r-0' },
    h('p', { class: small }, label),
    h(
      'p',
      { class: `mt-1 font-display tabular-nums ${tone}`, style: "font-variation-settings:'wdth' 80,'wght' 800;font-size:clamp(1.6rem,4vw,2.3rem);line-height:1.1" },
      usd(cents),
    ),
  );

const table = (rows: [Child, Child, string?][]) =>
  h(
    'ul',
    { class: 'border-t border-ink-800' },
    ...rows.map(([label, value, cls]) =>
      h('li', { class: `${rowRule} flex items-baseline justify-between gap-6 py-2 ${cls ?? ''}` }, h('span', { class: 'min-w-0' }, label), value),
    ),
  );

function profitLoss(pl: PL) {
  const outTotal = pl.totalExpenses + pl.costOfGoods;
  return h(
    'div',
    {},
    subHead('How the business did', `${shortDate(pl.from)} to ${shortDate(pl.to)}. Profit is what came in minus what the business spent. Money you took for yourself doesn't count as spending.`),
    h(
      'div',
      { class: 'grid border-y border-ink-800 sm:grid-cols-3' },
      bigNumber('Money in', pl.totalIncome, 'text-gold-400'),
      bigNumber('Money out', outTotal),
      bigNumber(pl.net < 0 ? 'Loss' : 'Profit', Math.abs(pl.net), pl.net < 0 ? 'text-red-300' : 'text-bone-50'),
    ),
    h(
      'div',
      { class: 'mt-6 grid gap-8 lg:grid-cols-2' },
      h(
        'div',
        {},
        h('p', { class: `${small} mb-2` }, 'Where it came from'),
        pl.income.length
          ? table([...pl.income.map((r): [Child, Child] => [h('span', { class: 'text-bone-200' }, r.name), money(r.total, 'text-bone-50')]), [h('span', { class: 'text-bone-50' }, 'Total'), money(pl.totalIncome, 'font-semibold text-bone-50')]])
          : h('p', { class: 'text-sm text-bone-400' }, 'No money in yet.'),
      ),
      h(
        'div',
        {},
        h('p', { class: `${small} mb-2` }, 'Where it went'),
        pl.expenses.length
          ? table([
              ...[...pl.expenses].sort((a, b) => b.total - a.total).map((r): [Child, Child] => [h('span', { class: 'text-bone-200' }, r.name), money(r.total, 'text-bone-50')]),
              [h('span', { class: 'text-bone-50' }, 'Total'), money(outTotal, 'font-semibold text-bone-50')],
            ])
          : h('p', { class: 'text-sm text-bone-400' }, 'No spending yet.'),
      ),
    ),
  );
}

function balances(b: Balances, ctx: BooksCtx) {
  const byId = ctx.books.byId;
  const money = b.accounts.filter((a) => byId.get(a.accountId)?.moneyAccount && !(byId.get(a.accountId)?.archived && a.balance === 0));
  return h(
    'div',
    {},
    subHead("What's in each account today", 'From what\'s in the books. If it doesn\'t match your bank, a bank file is probably missing, or a line is still waiting in To do.'),
    table(
      money.map((a): [Child, Child] => [
        h('span', { class: 'text-bone-200' }, a.name, a.type === 'liability' ? h('span', { class: 'ml-2 text-xs text-bone-500' }, a.balance >= 0 ? 'you owe' : 'in credit') : null),
        h('span', { class: 'tabular-nums text-bone-50' }, usd(a.type === 'liability' ? Math.abs(a.balance) : a.balance)),
      ]),
    ),
  );
}

function taxLines(pl: PL) {
  if (!pl.scheduleC.length) return null;
  return h(
    'div',
    {},
    subHead('For your taxes', 'The same money, sorted by the line it goes on the Schedule C tax form. Show this to whoever does your taxes.'),
    table(
      pl.scheduleC.map((r): [Child, Child] => [
        h('span', { class: 'text-bone-200' }, h('span', { class: 'mr-3 inline-block w-10 tabular-nums text-bone-500' }, r.line), r.label),
        money(r.total, 'text-bone-50'),
      ]),
    ),
  );
}

function mileage(m: Mileage, trips: Trip[], ctx: BooksCtx, reload: () => Promise<void>) {
  const note =
    m.centsPerMile === null
      ? h('span', {}, `Set the IRS rate for ${m.year} under `, button('Settings', textBtn, () => ctx.go('settings')), ' to see what these miles are worth.')
      : `At ${m.centsPerMile}¢ a mile, the IRS rate for ${m.year}.`;
  return h(
    'div',
    {},
    subHead(`Drives in ${m.year}`, note),
    h(
      'div',
      { class: 'grid grid-cols-3 border-y border-ink-800' },
      ...[
        ['Miles', m.miles.toLocaleString('en-US')],
        ['Drives', String(m.trips)],
        ['Off your taxes', m.deduction === null ? '—' : usd(m.deduction)],
      ].map(([k, v]) =>
        h('div', { class: 'border-r border-ink-800 py-3 pr-3 pl-3 first:pl-0 last:border-r-0' }, h('p', { class: small }, k), h('p', { class: 'mt-1 text-xl tabular-nums text-bone-50' }, v)),
      ),
    ),
    trips.length
      ? h(
          'details',
          { class: 'mt-3' },
          h('summary', { class: `${small} cursor-pointer select-none py-2 hover:text-bone-200` }, `Every drive (${trips.length})`),
          h(
            'ul',
            { class: 'border-t border-ink-800' },
            ...trips.map((t) => {
              const status = statusLine();
              const right = h(
                'div',
                { class: 'flex items-center gap-4' },
                h('span', { class: 'tabular-nums text-bone-50' }, `${t.miles} mi`),
                button('Remove', textBtn, () =>
                  askFirst(right, 'Remove this drive from the log?', 'Yes, remove it', 'No', (b) =>
                    status.run(b, async () => {
                      await api(`/books/trips/${t.id}`, { method: 'DELETE' });
                      await reload();
                    }),
                  ),
                ),
              );
              return h(
                'li',
                { class: `${rowRule} flex flex-wrap items-center justify-between gap-x-6 gap-y-1 py-2 text-sm` },
                h('span', { class: 'min-w-0 text-bone-200' }, h('span', { class: 'mr-3 text-bone-400' }, shortDate(t.date)), t.purpose, t.to ? h('span', { class: 'text-bone-500' }, ` · ${t.to}`) : null),
                h('div', {}, right, status.el),
              );
            }),
          ),
        )
      : h('p', { class: 'mt-3' }, button('Log a drive', textBtn, () => ctx.go('add', { addKind: 'drive' }))),
  );
}

function contractors(c: Contractors) {
  return h(
    'div',
    {},
    subHead(
      `Helpers paid in ${c.year}`,
      `Anyone you paid ${usd(c.threshold)} or more in a year (who isn't an employee) needs a 1099-NEC form by January 31. Get a W-9 form from each helper before you pay them.`,
    ),
    c.contractors.length
      ? table(
          c.contractors.map((r): [Child, Child] => [
            h(
              'span',
              { class: 'text-bone-200' },
              r.name,
              h('span', { class: `ml-3 text-xs ${r.needs1099 ? 'text-gold-400' : 'text-bone-500'}` }, r.needs1099 ? 'Needs a 1099' : 'No 1099 yet'),
              h('span', { class: `ml-3 text-xs ${r.taxFormOnFile ? 'text-bone-500' : 'text-red-300'}` }, r.taxFormOnFile ? 'W-9 on file' : 'No W-9 yet'),
            ),
            money(r.total, 'text-bone-50'),
          ]),
        )
      : h('p', { class: 'text-sm text-bone-400' }, 'No helpers paid this year. When you pay one, tick "This is a helper I pay" so they show up here.'),
  );
}

function downloads(r: { from: string; to: string }, year: string) {
  const status = statusLine();
  const file = (label: string, path: string, name: string) =>
    button(label, textBtn, (b) => status.run(b, async () => `Downloaded ${await download(path, name)}. Look in your Downloads folder.`));
  return h(
    'div',
    {},
    subHead('Files for your accountant', 'Spreadsheet files (.csv) that open in Excel or Numbers. Send them to whoever does your taxes.'),
    h(
      'div',
      { class: 'flex flex-col items-start gap-3 border-t border-ink-800 pt-4' },
      file(`Every entry, ${shortDate(r.from)} to ${shortDate(r.to)}`, `/books/export/ledger?from=${r.from}&to=${r.to}`, `ked-general-ledger-${r.from}-to-${r.to}.csv`),
      file(`Profit and loss, ${shortDate(r.from)} to ${shortDate(r.to)}`, `/books/export/profit-loss?from=${r.from}&to=${r.to}`, `ked-profit-and-loss-${r.from}-to-${r.to}.csv`),
      file(`Mileage log, ${year}`, `/books/export/mileage?year=${year}`, `ked-mileage-log-${year}.csv`),
      file(`Helpers paid, ${year}`, `/books/export/contractors?year=${year}`, `ked-contractor-payments-${year}.csv`),
      status.el,
    ),
  );
}
