/**
 * Insights → Marketing spend: what Jacob paid each channel, month by month.
 * Stored apart from the books (POST /crm/insights/spend) because one ad bill
 * can cover several channels and book entries are never edited. The books'
 * Advertising total sits next to it, so anything not split out yet shows.
 */
import { h, api } from './core';
import { askFirst, button, goldSmall, labelled, moneyInput, parseCents, select, statusLine, textBtn, textInput } from './books-lib';
import { type Insights, type SpendRow, part, section, table, usd } from './insights-lib';

const CHANNELS: [string, string][] = [
  ['maps', 'Google Maps'],
  ['google', 'Google search ads'],
  ['instagram', 'Instagram'],
  ['facebook', 'Facebook'],
  ['nextdoor', 'Nextdoor'],
  ['van', 'Van wrap, signs, door hangers'],
  ['referral', 'Referral rewards'],
  ['repeat', 'Offers to past customers'],
  ['other', 'Something else'],
];
const channelName = (s: string) => CHANNELS.find(([k]) => k === s)?.[1] ?? s;
const monthName = (m: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${m}-15T12:00:00Z`));

export function spendSection(d: Insights, reload: () => Promise<void>) {
  const s = d.spend;
  const bits: string[] = [];
  if (s.total) bits.push(`You logged ${usd(s.total)} of marketing for this period.`);
  if (s.booksAdvertising) bits.push(`The books show ${usd(s.booksAdvertising)} under Advertising${s.notSplit ? `; ${usd(s.notSplit)} of it isn’t split by channel yet. Add it below to see what each channel costs per customer.` : '.'}`);
  if (!bits.length) bits.push('Add what you spend on each channel each month, and the Leads and sources table shows what each new customer cost and what came back for every dollar.');

  return section(
    'Marketing spend',
    bits.join(' '),
    [
      'Each line is one channel for one month. For a period that covers part of a month, that month’s spend is split by days.',
      'Advertising in the books is every expense filed under Advertising in the period. It is only there to compare; the channel lines are what the cost per customer uses.',
    ],
    addForm(reload),
    part('Logged for this period'),
    table(
      [
        { label: 'Month', cell: (r: SpendRow) => monthName(r.month) },
        { label: 'Channel', cell: (r: SpendRow) => h('span', {}, channelName(r.source), r.note ? h('span', { class: 'block text-xs text-bone-500' }, r.note) : null) },
        { label: 'Amount', cell: (r: SpendRow) => usd(r.amount), num: true },
        { label: '', cell: (r: SpendRow) => rowTools(r, reload), num: true },
      ],
      s.rows,
      { empty: 'Nothing logged for these months yet.' },
    ),
  );
}

function fields(row?: SpendRow) {
  const month = textInput({ type: 'month', value: row?.month ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date()).slice(0, 7) });
  const channel = select(CHANNELS, row?.source ?? 'maps');
  const amount = moneyInput(row?.amount);
  const note = textInput({ value: row?.note ?? '', placeholder: 'Optional, like “boosted 2 posts”' });
  const read = () => {
    const cents = parseCents(amount.value);
    if (!/^\d{4}-\d{2}$/.test(month.value)) throw new Error('Pick the month.');
    if (cents === null) throw new Error('Type the amount, like 40 or 40.00.');
    return { month: month.value, source: channel.value, amount: cents, note: note.value.trim() || null };
  };
  return { month, channel, amount, note, read };
}

function addForm(reload: () => Promise<void>) {
  const f = fields();
  const status = statusLine();
  const save = button('Add spending', goldSmall, (b) =>
    status.run(b, async () => {
      await api('/crm/insights/spend', { method: 'POST', body: f.read() });
      await reload();
    }),
  );
  return h(
    'div',
    { class: 'mt-6 grid max-w-3xl gap-3 border-t border-ink-700 pt-5 sm:grid-cols-[13rem_1fr_8rem]' },
    labelled('Month', f.month),
    labelled('Channel', f.channel),
    labelled('Amount ($)', f.amount),
    labelled('Note', f.note, 'sm:col-span-3'),
    h('div', { class: 'flex flex-wrap items-center gap-4 sm:col-span-3' }, save, status.el),
  );
}

function rowTools(r: SpendRow, reload: () => Promise<void>) {
  const host = h('div', { class: 'flex justify-end gap-4' });
  const status = statusLine();
  const edit = () => {
    const f = fields(r);
    host.replaceChildren(
      h(
        'div',
        { class: 'grid min-w-[16rem] gap-2 text-left' },
        labelled('Month', f.month),
        labelled('Channel', f.channel),
        labelled('Amount ($)', f.amount),
        labelled('Note', f.note),
        h(
          'div',
          { class: 'flex flex-wrap items-center gap-4' },
          button('Save', goldSmall, (b) =>
            status.run(b, async () => {
              await api(`/crm/insights/spend/${r.id}`, { method: 'PATCH', body: f.read() });
              await reload();
            }),
          ),
          button('Cancel', textBtn, () => host.replaceChildren(...tools())),
        ),
        status.el,
      ),
    );
  };
  const tools = () => [
    button('Change', textBtn, edit),
    button('Remove', textBtn, () =>
      askFirst(host, `Remove ${usd(r.amount)} for ${channelName(r.source)}, ${monthName(r.month)}?`, 'Yes, remove it', 'No', (b) =>
        status.run(b, async () => {
          await api(`/crm/insights/spend/${r.id}`, { method: 'DELETE' });
          await reload();
        }),
      ),
    ),
  ];
  host.replaceChildren(...tools());
  return h('div', {}, host, status.el);
}
