import { formatRange } from '@ked/pricing';
import { type Lead, h, $, when, api, showError, ghost, sectionHead } from './core';
import { goTab } from './calendar-shared';

export async function renderLeads() {
  const view = $('[data-view="leads"]');
  const { leads } = await api<{ leads: Lead[] }>('/leads');
  const open = leads.filter((l) => l.status === 'new' || l.status === 'contacted');
  view.replaceChildren(
    sectionHead('Quote requests', 'People who priced a job on the website and tapped “Send to Jacob” instead of picking a time. Call or text them, then mark each one.'),
    open.length
      ? h('ul', { class: 'border-t border-ink-800' }, ...open.map(leadRow))
      : h(
          'p',
          { class: 'max-w-2xl text-bone-400' },
          'No one is waiting on you. People who pick a time and book go straight onto the ',
          h('button', { type: 'button', class: 'text-gold-400 underline underline-offset-4 hover:text-gold-500', onclick: () => goTab('bookings') }, 'Calendar'),
          '.',
        ),
  );
}

function leadRow(l: Lead) {
  const set = (status: Lead['status']) => async () => {
    try {
      await api(`/leads/${l.id}`, { method: 'PATCH', body: { status } });
      await renderLeads();
    } catch (err) {
      showError(err);
    }
  };
  return h(
    'li',
    { class: 'grid gap-3 border-b border-ink-800 py-4 sm:grid-cols-[1fr_auto] sm:gap-6' },
    h(
      'div',
      { class: 'flex flex-col gap-0.5' },
      h('p', { class: 'text-bone-50' }, l.name, h('span', { class: `ml-3 text-xs uppercase tracking-[0.14em] ${l.status === 'new' ? 'text-gold-400' : 'text-bone-500'}` }, l.status)),
      h('p', { class: 'text-sm text-bone-200' }, [l.quote.lines[0]?.label, l.vehicle, l.zip && `ZIP ${l.zip}`].filter(Boolean).join(' · ')),
      h('p', { class: 'text-sm tabular-nums text-bone-200' }, l.quote.range ? `Estimate ${formatRange(l.quote.range)}` : 'Needs a look to price'),
      h('p', { class: 'flex flex-wrap gap-x-4 text-sm' },
        l.phone ? h('a', { class: 'text-gold-400 hover:text-gold-500', href: `tel:${l.phone}` }, l.phone) : null,
        l.email ? h('a', { class: 'text-gold-400 hover:text-gold-500', href: `mailto:${l.email}` }, l.email) : null,
      ),
      l.notes ? h('p', { class: 'mt-1 whitespace-pre-line text-sm italic text-bone-400' }, l.notes) : null,
      h('p', { class: 'text-xs text-bone-500' }, `Sent ${when(l.createdAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`),
    ),
    h(
      'div',
      { class: 'flex flex-wrap items-start gap-2 sm:justify-end' },
      l.status === 'new' ? h('button', { type: 'button', class: ghost, onclick: set('contacted') }, 'Contacted') : null,
      h('button', { type: 'button', class: ghost, onclick: set('booked') }, 'Booked'),
      h('button', { type: 'button', class: ghost, onclick: set('lost') }, 'Lost'),
    ),
  );
}
