/**
 * Invoices tab: what's owed, every invoice, and one invoice opened up
 * (invoices-detail.ts). Paid is worked out by the API from the books, so after
 * any change this refetches instead of doing sums of its own.
 */
import { type Job, h, $, api, sectionHead, showError } from './core';
import { renderDetail } from './invoices-detail';
import { type Invoice, money, stateOf, unpaid, pastDue, shortDay, shortWhen, label, plain, action, bringIntoView } from './invoices-shared';

type Filter = 'unpaid' | 'paid' | 'void' | 'all';
let filter: Filter = 'unpaid';

const view = () => $('[data-view="invoices"]');

export async function renderInvoices() {
  await renderList();
}

/** Open one invoice. Exported so other tabs (a job on the Calendar) could link here. */
export async function openInvoice(id: string, flash?: string) {
  await renderDetail(view(), id, { back: () => renderList(), open: (next, note) => openInvoice(next, note) }, flash);
  bringIntoView(view());
}

async function renderList() {
  const from = new Date(Date.now() - 90 * 864e5).toISOString();
  const to = new Date(Date.now() + 864e5).toISOString();
  const [{ invoices }, jobs] = await Promise.all([
    api<{ invoices: Invoice[] }>('/invoices'),
    // Only feeds "Ready to bill"; the list still works if it fails.
    api<{ jobs: (Job & { history?: boolean })[] }>(`/jobs?from=${from}&to=${to}`).then((r) => r.jobs).catch(() => []),
  ]);

  const owed = invoices.filter(unpaid);
  const billed = new Set(invoices.filter((i) => i.status !== 'void').map((i) => i.jobId));
  const ready = jobs.filter((j) => j.status === 'done' && !j.history && !billed.has(j.id)).sort((a, b) => b.start.localeCompare(a.start));

  view().replaceChildren(
    sectionHead('Invoices'),
    summary(owed),
    ...(ready.length ? [readyToBill(ready)] : []),
    listing(invoices),
  );
}

/* ------------------------------------------------------------ summary */

function summary(owed: Invoice[]) {
  const total = owed.reduce((s, i) => s + i.balance, 0);
  const notSent = owed.filter((i) => i.status === 'draft').length;
  const late = owed.filter(pastDue).length;
  const facts = [
    owed.length ? `${owed.length} not paid yet` : null,
    notSent ? `${notSent} not sent yet` : null,
    late ? `${late} past due` : null,
  ].filter(Boolean);
  return h(
    'div',
    { class: 'mb-10 border-l-2 border-gold-500 pl-5' },
    h('p', { class: label }, 'Owed to you'),
    h('p', { class: 'mt-1 font-display tabular-nums text-bone-50', style: "font-variation-settings:'wdth' 80,'wght' 800;font-size:clamp(2rem,6vw,2.75rem);line-height:1" }, money(total)),
    h('p', { class: 'mt-2 text-sm text-bone-400' }, facts.length ? facts.join(' · ') : 'Everyone has paid. Nice.'),
  );
}

/* ------------------------------------------------------------ ready to bill */

function readyToBill(jobs: Job[]) {
  return h(
    'div',
    { class: 'mb-12' },
    h('h3', { class: 'mb-1 font-display text-sm uppercase tracking-[0.14em] text-gold-400' }, 'Done, but no invoice yet'),
    h('p', { class: 'mb-3 text-sm text-bone-400' }, 'Jobs from the last 90 days you finished and haven’t billed.'),
    h(
      'ul',
      { class: 'border-t border-ink-800' },
      ...jobs.map((j) =>
        h(
          'li',
          { class: 'flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-ink-800 py-3' },
          h(
            'div',
            { class: 'min-w-0' },
            h('p', { class: 'text-bone-50' }, j.customer.name),
            h('p', { class: 'text-sm text-bone-400' }, [shortDay(j.date), j.quote.lines[0]?.label, j.vehicle].filter(Boolean).join(' · ')),
          ),
          h(
            'div',
            { class: 'flex items-center gap-4' },
            j.finalPrice !== null ? h('p', { class: 'tabular-nums text-bone-200' }, money(j.finalPrice)) : null,
            action('Make invoice', plain, async () => {
              const inv = await api<Invoice>(`/jobs/${j.id}/invoice`, { method: 'POST', body: {} });
              await openInvoice(inv.id, `Invoice ${inv.number} is made. Check it, then text it to ${j.customer.name.split(' ')[0]}.`);
            }),
          ),
        ),
      ),
    ),
  );
}

/* ------------------------------------------------------------ the list */

const filters: [Filter, string][] = [
  ['unpaid', 'Not paid'],
  ['paid', 'Paid'],
  ['void', 'Void'],
  ['all', 'All'],
];

function listing(all: Invoice[]) {
  const holder = h('div');
  const counts: Record<Filter, number> = {
    unpaid: all.filter(unpaid).length,
    paid: all.filter((i) => i.status === 'paid').length,
    void: all.filter((i) => i.status === 'void').length,
    all: all.length,
  };
  const bar = h('div', { class: 'mb-2 flex gap-4 overflow-x-auto border-b border-ink-800 [scrollbar-width:none] sm:gap-6', role: 'group', 'aria-label': 'Show' });
  const draw = () => {
    bar.replaceChildren(
      ...filters.map(([key, name]) => {
        const b = h(
          'button',
          {
            type: 'button',
            'aria-pressed': String(filter === key),
            class:
              'shrink-0 border-b-2 border-transparent px-1 py-2 font-display text-[0.74rem] uppercase tracking-[0.16em] text-bone-400 transition-colors hover:text-bone-50 aria-pressed:border-gold-500 aria-pressed:text-bone-50',
          },
          name,
          h('span', { class: 'ml-1.5 tabular-nums text-bone-500' }, String(counts[key])),
        );
        b.addEventListener('click', () => ((filter = key), draw()));
        return b;
      }),
    );
    const shown = sorted(all.filter((i) => filter === 'all' || (filter === 'unpaid' ? unpaid(i) : i.status === filter)));
    holder.replaceChildren(
      bar,
      shown.length
        ? h('ul', {}, ...shown.map(invoiceRow))
        : h('p', { class: 'py-6 text-bone-400' }, filter === 'unpaid' ? 'Nothing waiting on payment.' : 'None here.'),
    );
  };
  draw();
  return h('div', {}, h('h3', { class: 'sr-only' }, 'All invoices'), holder);
}

/** Unpaid first (past due at the very top), then paid, then void; newest first in each. */
function sorted(list: Invoice[]) {
  const rank = (i: Invoice) => (pastDue(i) ? 0 : unpaid(i) ? 1 : i.status === 'paid' ? 2 : 3);
  return [...list].sort((a, b) => rank(a) - rank(b) || b.number - a.number);
}

function invoiceRow(inv: Invoice) {
  const { word, tone } = stateOf(inv);
  const when = inv.status === 'paid' && inv.paidOn
    ? `Paid ${shortDay(inv.paidOn)}`
    : inv.status === 'void' && inv.voidedAt
      ? `Voided ${shortWhen(inv.voidedAt)}`
      : inv.sentAt
        ? `Sent ${shortWhen(inv.sentAt)}${inv.viewedAt ? ', they opened it' : ''}`
        : `Made ${shortWhen(inv.createdAt)}`;
  const amount = unpaid(inv)
    ? h('p', { class: 'font-semibold tabular-nums text-bone-50' }, money(inv.balance), inv.paid > 0 ? h('span', { class: 'ml-1 text-sm font-normal text-bone-400' }, 'left') : null)
    : h('p', { class: `tabular-nums ${inv.status === 'void' ? 'text-bone-500 line-through' : 'text-bone-200'}` }, money(inv.total));

  const btn = h(
    'button',
    { type: 'button', class: 'group flex w-full items-start gap-4 border-b border-ink-800 py-4 text-left transition-colors hover:bg-ink-900 focus-visible:outline-2 focus-visible:outline-gold-400 sm:gap-6 sm:px-2' },
    h('span', { class: 'hidden w-14 shrink-0 pt-0.5 text-sm tabular-nums text-bone-500 sm:block' }, `#${inv.number}`),
    h(
      'span',
      { class: 'min-w-0 flex-1' },
      h('span', { class: 'block truncate text-bone-50 group-hover:text-gold-400' }, inv.customer.name),
      h('span', { class: 'block text-sm text-bone-400' }, h('span', { class: 'sm:hidden' }, `#${inv.number} · `), when),
    ),
    h('span', { class: 'shrink-0 text-right' }, amount, h('span', { class: `block text-xs uppercase tracking-[0.14em] ${tone}` }, word)),
  );
  btn.addEventListener('click', () => openInvoice(inv.id).catch(showError));
  return h('li', {}, btn);
}
