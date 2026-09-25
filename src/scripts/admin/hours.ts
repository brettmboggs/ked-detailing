import { type BookingRules, DAYS, h, $, api, sectionHead, field, checkbox, saveBar } from './core';

export async function renderHours() {
  const view = $('[data-view="hours"]');
  const { rules } = await api<{ rules: BookingRules }>('/settings/booking');
  const r: BookingRules = structuredClone(rules);

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

  view.replaceChildren(
    sectionHead('Online booking'),
    checkbox('Customers can book online', () => r.onlineBooking, (v) => (r.onlineBooking = v)),
    h('p', { class: 'mt-2 text-sm text-bone-400' }, 'Off: the website still gives quotes and sends you requests, but nobody can pick a time.'),
    sectionHead('Working days', 'Tick the days you work. Online bookings only land inside these hours.'),
    ...r.week.map((_, i) => dayRow(i)),
    sectionHead('Limits'),
    h(
      'div',
      { class: 'grid grid-cols-2 gap-3 sm:grid-cols-4' },
      field('Most jobs in a day', () => r.maxJobsPerDay, (v) => (r.maxJobsPerDay = v as number), { step: 1, min: 1 }),
      field('Minutes between jobs', () => r.bufferMinutes, (v) => (r.bufferMinutes = v as number), { step: 15, min: 0 }),
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
