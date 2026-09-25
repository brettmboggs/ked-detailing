import { formatRange } from '@ked/pricing';
import { type Job, h, $, dollars, when, dayTitle, api, showError, small, ghost, sectionHead } from './core';

export async function renderBookings() {
  const view = $('[data-view="bookings"]');
  const from = new Date(Date.now() - 864e5).toISOString();
  const to = new Date(Date.now() + 45 * 864e5).toISOString();
  const { jobs } = await api<{ jobs: Job[] }>(`/jobs?from=${from}&to=${to}`);
  const live = jobs.filter((j) => j.status !== 'cancelled');
  if (!live.length) {
    view.replaceChildren(sectionHead('Bookings'), h('p', { class: 'text-bone-400' }, 'Nothing booked in the next six weeks.'));
    return;
  }
  const byDay = new Map<string, Job[]>();
  for (const j of live) byDay.set(j.date, [...(byDay.get(j.date) ?? []), j]);

  view.replaceChildren(
    sectionHead('Bookings', 'The next six weeks. "Booked online" means the customer picked the time on the website: text them to confirm.'),
    ...[...byDay].map(([date, list]) =>
      h(
        'div',
        { class: 'mb-8' },
        h('h3', { class: 'mb-2 font-display text-sm uppercase tracking-[0.14em] text-gold-400' }, dayTitle(date)),
        h('ul', { class: 'border-t border-ink-800' }, ...list.map(jobRow)),
      ),
    ),
  );
}

function jobRow(j: Job) {
  const price = j.finalPrice !== null ? dollars(j.finalPrice) : j.quote.range ? formatRange(j.quote.range) : 'Price on site';
  const confirm = h('button', { type: 'button', class: ghost }, 'Copy confirmation text') as HTMLButtonElement;
  confirm.addEventListener('click', async () => {
    try {
      const { message } = await api<{ message: string }>(`/jobs/${j.id}/confirmation`, { method: 'POST' });
      await navigator.clipboard.writeText(message);
      confirm.textContent = 'Copied. Paste it in a text.';
    } catch (err) {
      showError(err);
    }
  });
  return h(
    'li',
    { class: 'grid gap-2 border-b border-ink-800 py-4 sm:grid-cols-[7rem_1fr_auto] sm:items-start sm:gap-6' },
    h('p', { class: 'font-semibold tabular-nums text-bone-50' }, when(j.start, { hour: 'numeric', minute: '2-digit' })),
    h(
      'div',
      { class: 'flex flex-col gap-0.5' },
      h('p', { class: 'text-bone-50' }, j.customer.name, j.source === 'web' ? h('span', { class: 'ml-3 text-xs uppercase tracking-[0.14em] text-gold-400' }, 'Booked online') : null),
      h('p', { class: 'text-sm text-bone-200' }, [j.quote.lines[0]?.label, j.vehicle].filter(Boolean).join(' · ')),
      h('p', { class: 'text-sm text-bone-400' }, j.address),
      j.customer.phone ? h('a', { class: 'text-sm text-gold-400 hover:text-gold-500', href: `tel:${j.customer.phone}` }, j.customer.phone) : null,
      j.notes ? h('p', { class: 'mt-1 text-sm italic text-bone-400' }, j.notes) : null,
    ),
    h('div', { class: 'flex flex-col items-start gap-2 sm:items-end' }, h('p', { class: 'tabular-nums text-bone-200' }, price), j.status === 'scheduled' ? confirm : h('p', { class: small }, j.status.replace('_', ' '))),
  );
}
