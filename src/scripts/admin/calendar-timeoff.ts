/**
 * Time off under the calendar: what's coming up, and a form to block more.
 * Time off also stops customers booking online in that span.
 */
import { addDays, localDate, zonedToUtc } from '@ked/scheduling';
import { TZ, h, api, input, sectionHead, checkbox } from './core';
import { type TimeOff, action, dayFmt, goldSmall, labelled, span, today } from './calendar-shared';

export async function timeOffSection(all: TimeOff[], refresh: () => void) {
  const upcoming = all.filter((t) => new Date(t.end) > new Date());

  const describe = (t: TimeOff) => {
    const s = localDate(t.start, TZ);
    // An all-day block ends at midnight, which is the start of the next day.
    const endDay = localDate(new Date(new Date(t.end).getTime() - 1), TZ);
    const midnight = (iso: string) => zonedToUtc(localDate(iso, TZ), '00:00', TZ).getTime() === new Date(iso).getTime();
    const day = (d: string) => dayFmt(d, { weekday: 'short', month: 'short', day: 'numeric' });
    if (midnight(t.start) && midnight(t.end)) return s === endDay ? `${day(s)}, all day` : `${day(s)} to ${day(endDay)}, all day`;
    return s === localDate(t.end, TZ) ? `${day(s)}, ${span(t.start, t.end)}` : `${day(s)} to ${day(localDate(t.end, TZ))}, ${span(t.start, t.end)}`;
  };

  const rows = upcoming.map((t) => {
    const remove = action('Remove', async () => {
      await api(`/time-off/${t.id}`, { method: 'DELETE' });
      refresh();
    });
    return h(
      'li',
      { class: 'flex flex-wrap items-center justify-between gap-3 border-b border-ink-800 py-3' },
      h('div', {}, h('p', { class: 'text-bone-50' }, describe(t)), t.reason ? h('p', { class: 'text-sm text-bone-400' }, t.reason) : null),
      remove.row,
    );
  });

  /* The form. All day by default, since that's the usual case. */
  const start = today();
  const fromDate = h('input', { type: 'date', class: input, value: start }) as HTMLInputElement;
  const toDate = h('input', { type: 'date', class: input, value: start }) as HTMLInputElement;
  const fromTime = h('input', { type: 'time', class: input, value: '08:00' }) as HTMLInputElement;
  const toTime = h('input', { type: 'time', class: input, value: '12:00' }) as HTMLInputElement;
  const reason = h('input', { type: 'text', class: input, maxlength: 200, placeholder: 'Vacation, appointment…' }) as HTMLInputElement;
  let allDay = true;
  const times = h('div', { class: 'grid grid-cols-2 gap-3', hidden: true }, labelled('From time', fromTime), labelled('To time', toTime));
  fromDate.addEventListener('change', () => {
    if (toDate.value < fromDate.value) toDate.value = fromDate.value;
  });

  const save = action(
    'Block it off',
    async () => {
      if (!fromDate.value || !toDate.value) throw new Error('Pick the days first.');
      const s = zonedToUtc(fromDate.value, allDay ? '00:00' : fromTime.value || '00:00', TZ);
      const e = allDay ? zonedToUtc(addDays(toDate.value, 1), '00:00', TZ) : zonedToUtc(toDate.value, toTime.value || '00:00', TZ);
      if (e <= s) throw new Error('The end has to be after the start.');
      await api('/time-off', { method: 'POST', body: { start: s.toISOString(), end: e.toISOString(), reason: reason.value.trim() || undefined } });
      refresh();
    },
    goldSmall,
  );

  return h(
    'div',
    { id: 'time-off', class: 'scroll-mt-24' },
    sectionHead('Time off', "Days or hours you're not working. Customers can't book online then. You can still add jobs yourself."),
    upcoming.length ? h('ul', { class: 'mb-8 border-t border-ink-800' }, ...rows) : h('p', { class: 'mb-8 text-sm text-bone-500' }, 'No time off coming up.'),
    h(
      'div',
      { class: 'flex max-w-xl flex-col gap-4 border-t border-ink-800 pt-6' },
      h('p', { class: 'font-semibold text-bone-50' }, 'Block off time'),
      h('div', { class: 'grid grid-cols-2 gap-3' }, labelled('From', fromDate), labelled('To', toDate)),
      checkbox('All day', () => allDay, (v) => {
        allDay = v;
        times.hidden = v;
      }),
      times,
      labelled('Why (only you see this)', reason),
      save.row,
    ),
    h('p', { class: 'mt-3 text-xs text-bone-500' }, 'Removing time off opens those times back up for online booking.'),
  );
}
