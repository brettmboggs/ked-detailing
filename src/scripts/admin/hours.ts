import { type BookingRules, DAYS, h, $, api, sectionHead, field, checkbox, saveBar } from './core';

export async function renderHours() {
  const view = $('[data-view="hours"]');
  const { rules } = await api<{ rules: BookingRules }>('/settings/booking');
  const r: BookingRules = structuredClone(rules);
  // Rules saved before drive time existed: offer it switched off, with High Ridge filled in.
  // TENANT: home base.
  r.travel ??= { on: false, homeZip: '63049', packUpMinutes: 15 };
  const t = r.travel;

  const dayRow = (i: number) => {
    const times = h('div', { class: 'grid grid-cols-2 gap-3' });
    const drawTimes = () => {
      const d = r.week[i];
      times.replaceChildren(
        ...(d
          ? [
              field('Start', () => d.open, (v) => (d.open = String(v)), { kind: 'time' }),
              field('Finish', () => d.close, (v) => (d.close = String(v)), { kind: 'time' }),
            ]
          : [h('p', { class: 'col-span-2 self-end pb-2 text-sm text-bone-500' }, 'Closed')]),
      );
    };
    drawTimes();
    const last = r.week.find(Boolean) ?? { open: '08:00', close: '17:00' };
    return h(
      'div',
      { class: 'grid items-end gap-3 border-t border-ink-800 py-4 sm:grid-cols-[10rem_1fr]' },
      checkbox(DAYS[i]!, () => r.week[i] !== null, (on) => {
        r.week[i] = on ? { ...(r.week[i] ?? last) } : null;
        drawTimes();
      }),
      times,
    );
  };

  const gapField = field('Minutes between jobs', () => r.bufferMinutes, (v) => (r.bufferMinutes = v as number), { step: 15, min: 0 });
  const gapLabel = gapField.querySelector('span')!;
  if (t.on) gapLabel.textContent = 'When the address has no ZIP (minutes)';

  view.replaceChildren(
    sectionHead('Online booking'),
    checkbox('Customers can book online', () => r.onlineBooking, (v) => (r.onlineBooking = v)),
    h('p', { class: 'mt-2 text-sm text-bone-400' }, 'Off: the website still gives quotes and sends you requests, but nobody can pick a time.'),
    sectionHead('Working days', 'Tick the days you work. Online bookings only land inside these hours.'),
    ...r.week.map((_, i) => dayRow(i)),
    sectionHead('Time between jobs', 'So you are never booked somewhere you can’t reach in time.'),
    checkbox('Leave time for the drive', () => t.on, (v) => {
      t.on = v;
      gapLabel.textContent = v ? 'When the address has no ZIP (minutes)' : 'Minutes between jobs';
    }),
    h(
      'p',
      { class: 'mt-2 max-w-2xl text-sm text-bone-400' },
      'The gap between two jobs becomes the drive between them plus your pack-up time. Drives are estimated from ZIP codes, a little on the long side. Online booking only offers times you can reach.',
    ),
    h(
      'div',
      { class: 'mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4' },
      field('Pack up and set up (minutes)', () => t.packUpMinutes, (v) => (t.packUpMinutes = v as number), { step: 5, min: 0 }),
      field('Home ZIP (where you start)', () => t.homeZip, (v) => (t.homeZip = String(v)), { kind: 'text' }),
      gapField,
    ),
    sectionHead('Limits'),
    h(
      'div',
      { class: 'grid grid-cols-2 gap-3 sm:grid-cols-4' },
      field('Most jobs in a day', () => r.maxJobsPerDay, (v) => (r.maxJobsPerDay = v as number), { step: 1, min: 1 }),
      field('Hours of notice', () => r.minNoticeHours, (v) => (r.minNoticeHours = v as number), { step: 1, min: 0 }),
      field('Days ahead people can book', () => r.horizonDays, (v) => (r.horizonDays = v as number), { step: 1, min: 1 }),
      field('Start times every (minutes)', () => r.slotStepMinutes, (v) => (r.slotStepMinutes = v as number), { step: 15, min: 15 }),
    ),
    saveBar('Save hours', async () => {
      await api('/settings/booking', { method: 'PUT', body: r });
      return 'Saved. Online booking uses these now, and the website shows them in a few minutes.';
    }),
  );
}
