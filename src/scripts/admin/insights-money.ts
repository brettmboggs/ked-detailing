/**
 * Insights → Money and What's ahead: what came in, how the work is made up
 * (packages, sizes, add-ons, boats), the months and weekdays, and the next
 * 30 days on the calendar.
 */
import { h } from './core';
import { goTab } from './calendar-shared';
import { textBtn } from './books-lib';
import {
  type Column,
  type Insights,
  MONTHS,
  chartKey,
  columns,
  delta,
  figures,
  inlineBar,
  meter,
  monthLabel,
  num,
  numbersFor,
  orDash,
  part,
  pct,
  range,
  section,
  shortDay,
  table,
  usd,
} from './insights-lib';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function moneySection(d: Insights) {
  const { cur, prev, books, booksPrev } = d.money;
  const cmp = d.period.compare;
  const change = prev && prev.revenue ? Math.round(((cur.revenue - prev.revenue) / prev.revenue) * 100) : null;
  const means = cur.jobs
    ? `You made ${usd(cur.revenue)} from ${plural(cur.jobs, 'finished job')}${change === null ? '' : `, ${change >= 0 ? 'up' : 'down'} ${Math.abs(change)}% on the period before`}. ${
        books.hasBooks ? `The books show ${books.profit < 0 ? `a loss of ${usd(-books.profit)}` : `${usd(books.profit)} profit`} after spending.` : 'Put your spending in the Books tab to see profit here too.'
      }`
    : 'No finished jobs in this period yet. Pick a longer period above.';

  return section(
    'Money',
    means,
    [
      'Money made counts finished jobs only, at the final price you set, or the quoted price if you never set one. It is counted on the day of the job.',
      'Money collected is what the books show came in (every income category, tips included), on the day it was paid. It can differ from money made when people pay later or you haven’t recorded a payment.',
      'Per working day divides money made by the days you finished at least one job. Per hour of work uses the hours each quote expected (the middle of its range), not a clock.',
      'Add-ons counts finished jobs where the customer picked at least one extra, out of jobs priced with the quote tool (imported history is left out).',
      'Profit is from the books: money in minus money out, the same as Books → Reports.',
      'Busiest months average each calendar month over the full months on record.',
    ],
    figures([
      { label: 'Money made', value: usd(cur.revenue), change: delta(cur.revenue, prev?.revenue, cmp) },
      { label: 'Money collected', value: books.hasBooks ? usd(books.collected) : '—', change: books.hasBooks ? delta(books.collected, booksPrev?.collected, cmp) : null, sub: books.hasBooks ? (books.tips ? `${usd(books.tips)} of it tips` : 'From the books') : 'Nothing in the books yet' },
      { label: 'Jobs finished', value: num(cur.jobs), change: delta(cur.jobs, prev?.jobs, cmp) },
      { label: 'Average job', value: orDash(cur.avgTicket), change: delta(cur.avgTicket, prev?.avgTicket, cmp) },
      { label: 'Per working day', value: orDash(cur.perDay), sub: `${plural(cur.workDays, 'day')} with a finished job`, change: delta(cur.perDay, prev?.perDay, cmp) },
      { label: 'Per hour of work', value: orDash(cur.perHour), sub: `${num(cur.hours, 1)} hours, as quoted`, change: delta(cur.perHour, prev?.perHour, cmp) },
      { label: 'Jobs with an add-on', value: pct(cur.addonRate), change: delta(cur.addonRate, prev?.addonRate, cmp) },
      {
        label: books.profit < 0 ? 'Loss' : 'Profit',
        value: books.hasBooks ? usd(Math.abs(books.profit)) : '—',
        change: books.hasBooks ? delta(books.profit, booksPrev?.profit, cmp) : null,
        sub: h('button', { type: 'button', class: textBtn, onclick: () => goTab('books') }, 'Profit and loss →'),
      },
    ]),
    monthsChart(d),
    seasons(d),
    weekdays(d),
    packages(d),
  );
}

function monthsChart(d: Insights) {
  const end = (d.period.to < d.period.today ? d.period.to : d.period.today).slice(0, 7);
  const months = d.money.byMonth.filter((m) => m.month <= end).slice(window.innerWidth < 640 ? -12 : -24);
  if (!months.length) return null;
  const from = d.period.from.slice(0, 7);
  const to = d.period.to.slice(0, 7);
  const cols: Column[] = months.map((m) => {
    const mm = Number(m.month.slice(5));
    return {
      key: m.month,
      tick: mm === 1 ? m.month.slice(0, 4) : [4, 7, 10].includes(mm) ? MONTHS[mm - 1]!.slice(0, 3) : '',
      value: m.revenue,
      on: m.month >= from && m.month <= to,
      tip: [usd(m.revenue), `${monthLabel(m.month, true)}, ${plural(m.jobs, 'job')}`],
    };
  });
  return h(
    'div',
    {},
    part('Money made each month', `The last ${plural(months.length, 'month')}. Point at a month for its numbers.`),
    columns(cols, { label: 'Money made each month', money: true }),
    chartKey('In the period you picked', 'Other months'),
    numbersFor(
      table(
        [
          { label: 'Month', cell: (m) => monthLabel(m.month) },
          { label: 'Jobs', cell: (m) => num(m.jobs), num: true },
          { label: 'Money made', cell: (m) => usd(m.revenue), num: true },
        ],
        [...months].reverse(),
      ),
    ),
  );
}

function seasons(d: Insights) {
  const s = d.money.seasonality;
  if (!s) return part('Busy and slow months', 'This shows once you have a full year of jobs.');
  const known = s.filter((m) => m.avgRevenue !== null);
  const ranked = [...known].sort((a, b) => b.avgRevenue! - a.avgRevenue!);
  const best = new Set(ranked.slice(0, 3).map((m) => m.month));
  const names = (ms: typeof s) => ms.map((m) => MONTHS[m.month - 1]).join(', ');
  return h(
    'div',
    {},
    part('Busy and slow months', `Usually busiest: ${names(ranked.slice(0, 3))}. Usually slowest: ${names(ranked.slice(-3).reverse())}. Plan offers a month before the slow ones.`),
    columns(
      s.map((m) => ({
        key: String(m.month),
        tick: MONTHS[m.month - 1]!.slice(0, 1),
        value: m.avgRevenue ?? 0,
        on: best.has(m.month),
        tip: [m.avgRevenue === null ? 'No data' : usd(m.avgRevenue), `${MONTHS[m.month - 1]}, average of ${plural(m.years, 'year')}`],
      })),
      { label: 'Average money made by calendar month', money: true },
    ),
    chartKey('Your three busiest months', 'The rest'),
    numbersFor(
      table(
        [
          { label: 'Month', cell: (m) => MONTHS[m.month - 1]! },
          { label: 'Years', cell: (m) => num(m.years), num: true },
          { label: 'Average', cell: (m) => orDash(m.avgRevenue), num: true },
        ],
        s,
      ),
    ),
  );
}

function weekdays(d: Insights) {
  const days = [...d.money.weekdays.slice(1), d.money.weekdays[0]!]; // Monday first
  return h(
    'div',
    {},
    part('Which days are full', `How full each weekday was in this period: jobs on it, out of ${d.pipeline.maxJobsPerDay} a day on the days you were open.`),
    table(
      [
        { label: 'Day', cell: (w) => w.name },
        { label: 'How full', cell: (w) => (w.closed ? h('span', { class: 'text-bone-500' }, 'Closed') : w.fill === null ? '—' : inlineBar(w.fill, 1, pct(w.fill))) },
        { label: 'Jobs', cell: (w) => num(w.jobs), num: true },
        { label: 'A day', cell: (w) => (w.jobsPerDay === null ? '—' : num(w.jobsPerDay, 1)), num: true, wide: true },
        { label: 'Money', cell: (w) => usd(w.revenue), num: true },
      ],
      days,
    ),
  );
}

function packages(d: Insights) {
  const m = d.money;
  const craft = m.craft;
  return h(
    'div',
    {},
    part(
      'What people buy',
      craft.boats.jobs
        ? `Boats: ${plural(craft.boats.jobs, 'job')}, ${usd(craft.boats.revenue)}. Cars: ${plural(craft.cars.jobs, 'job')}, ${usd(craft.cars.revenue)}.`
        : `All cars this period: ${plural(craft.cars.jobs, 'job')}, ${usd(craft.cars.revenue)}. No boats.`,
    ),
    table(
      [
        { label: 'Package', cell: (s) => h('span', {}, s.name, s.level ? h('span', { class: 'ml-2 text-xs text-bone-500' }, s.level) : null) },
        { label: 'Jobs', cell: (s) => num(s.jobs), num: true },
        { label: 'Money', cell: (s) => usd(s.revenue), num: true },
        { label: 'Share', cell: (s) => pct(s.share), num: true, wide: true },
        { label: 'Average', cell: (s) => orDash(s.avgTicket), num: true },
        { label: 'Add-on', cell: (s) => pct(s.addonRate), num: true },
      ],
      m.services,
      { empty: 'No finished jobs in this period.' },
    ),
    h(
      'div',
      { class: 'grid gap-x-10 lg:grid-cols-2' },
      h(
        'div',
        {},
        part('Car sizes'),
        table(
          [
            { label: 'Size', cell: (s) => s.label },
            { label: 'Jobs', cell: (s) => num(s.jobs), num: true },
            { label: 'Average', cell: (s) => orDash(s.avgTicket), num: true },
          ],
          m.sizes,
          { empty: 'No car jobs in this period.' },
        ),
      ),
      h(
        'div',
        {},
        part('Add-ons sold'),
        table(
          [
            { label: 'Add-on', cell: (a) => a.label },
            { label: 'Jobs', cell: (a) => num(a.jobs), num: true },
            { label: 'Money', cell: (a) => usd(a.revenue), num: true },
          ],
          m.addOns,
          { empty: 'No add-ons sold in this period.' },
        ),
      ),
    ),
  );
}

export function pipelineSection(d: Insights) {
  const p = d.pipeline;
  const n = p.next30;
  const c = d.money.cur;
  const cmp = d.period.compare;
  const means = `${plural(n.jobs, 'job')} worth ${usd(n.revenue)} ${n.jobs === 1 ? 'is' : 'are'} booked in the next 30 days, ${pct(n.use)} of your job slots.${
    p.openQuotes.count ? ` ${plural(p.openQuotes.count, 'quote request')} ${p.openQuotes.count === 1 ? 'is' : 'are'} waiting for an answer.` : ''
  }`;
  return section(
    'What’s ahead',
    means,
    [
      `Job slots are your open days (from Hours, less time off) times ${p.maxJobsPerDay} jobs a day.`,
      'Booked money is the quoted price of each booked job.',
      'A quote request is waiting when it is from the last 60 days, still new or contacted, and the person has booked nothing since.',
      'Cancelled counts jobs set to cancelled whose date falls in the period, out of those plus finished jobs.',
    ],
    figures([
      { label: 'Booked, next 30 days', value: usd(n.revenue), sub: `${plural(n.jobs, 'job')}, ${range(n.from, n.to)}` },
      { label: 'Job slots filled', value: pct(n.use), sub: `${n.jobs} of ${n.slots}` },
      { label: 'Quote requests waiting', value: num(p.openQuotes.count), sub: p.openQuotes.count ? `${usd(p.openQuotes.value)} as quoted${p.openQuotes.oldestDays ? `, oldest ${plural(p.openQuotes.oldestDays, 'day')}` : ''}` : 'All answered' },
      { label: 'Cancelled this period', value: num(c.cancelled), change: delta(c.cancelled, d.money.prev?.cancelled, cmp, false), sub: c.cancelled ? `${pct(c.cancelRate)} of jobs, ${usd(c.cancelledValue)}` : null },
    ]),
    meter(n.use, `${n.jobs} of ${n.slots} job slots booked in the next 30 days (${num(n.hours, 1)} of ${num(n.openHours)} open hours).`),
    p.emptyDays.length
      ? h('p', { class: 'mt-4 max-w-3xl text-sm text-bone-200' }, h('span', { class: 'text-bone-400' }, 'Open with nothing booked in the next two weeks: '), p.emptyDays.map((x) => shortDayName(x)).join(', '), '.')
      : null,
    h('p', { class: 'mt-2 max-w-3xl text-sm text-bone-400' }, `In the period you picked, ${plural(p.period.jobs, 'job')} filled ${pct(p.period.use)} of the slots on ${plural(p.period.openDays, 'open day')}.`,
      c.cancelledByCustomer ? ` ${c.cancelledByCustomer} of the cancellations came from customers through their booking link.` : ''),
  );
}

const shortDayName = (d: string) =>
  `${new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' }).format(new Date(`${d}T12:00:00Z`))} ${shortDay(d)}`;
