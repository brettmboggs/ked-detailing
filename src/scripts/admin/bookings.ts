/**
 * The Calendar tab: Jacob's week. A time grid on wide screens, a day-by-day
 * list on phones, time off on both. Opening a job, booking a new one and
 * blocking time off each draw into this same view (calendar-*.ts).
 */
import { addDays, localDate, weekday, zonedToUtc } from '@ked/scheduling';
import { type BookingRules, TZ, h, $, api, ghost, small, heading, headingStyle } from './core';
import {
  type CalJob,
  type Customer,
  type TimeOff,
  STATUS,
  STATUS_EDGE,
  STATUS_TEXT,
  dayFmt,
  goldSmall,
  minuteOfDay,
  pending,
  serviceName,
  span,
  time,
  today,
  toTop,
} from './calendar-shared';
import { renderJob } from './calendar-job';
import { renderNewJob } from './calendar-new';
import { timeOffSection } from './calendar-timeoff';

const PX_PER_HOUR = 52;

/** The Sunday that starts the week on show. Kept while Jacob moves between tabs. */
let week: string | null = null;
let rules: BookingRules | null = null;
/** Cancelled jobs stay off the calendar unless Jacob asks to see them. */
let showCancelled = false;

const sundayOf = (date: string) => addDays(date, -weekday(date));
const view = () => $('[data-view="bookings"]');

export async function renderBookings() {
  if (pending.job) {
    const id = pending.job;
    pending.job = null;
    return openJob(id);
  }
  if (pending.newJobFor) {
    const customer = pending.newJobFor;
    pending.newJobFor = null;
    return newJob({ customer });
  }
  return drawWeek();
}

export async function openJob(id: string, warnings: string[] = []) {
  toTop();
  await renderJob(view(), id, {
    back: (date) => {
      if (date) week = sundayOf(date);
      void drawWeek();
    },
    warnings,
  });
}

async function newJob(opts: { customer?: Customer; date?: string; start?: string } = {}) {
  toTop();
  await renderNewJob(view(), {
    ...opts,
    back: () => void drawWeek(),
    created: (job, warnings) => {
      week = sundayOf(job.date);
      void openJob(job.id, warnings);
    },
  });
}

async function drawWeek() {
  week ??= sundayOf(today());
  const days = Array.from({ length: 7 }, (_, i) => addDays(week!, i));
  const from = zonedToUtc(days[0]!, '00:00', TZ);
  const to = zonedToUtc(addDays(days[6]!, 1), '00:00', TZ);

  const [{ jobs }, { timeOff }, settings] = await Promise.all([
    api<{ jobs: CalJob[] }>(`/jobs?from=${from.toISOString()}&to=${to.toISOString()}`),
    api<{ timeOff: TimeOff[] }>('/time-off'),
    rules ? Promise.resolve({ rules }) : api<{ rules: BookingRules }>('/settings/booking'),
  ]);
  rules = settings.rules;
  const offs = timeOff.filter((t) => new Date(t.start) < to && new Date(t.end) > from);

  const shownWeek = week;
  const go = (date: string) => {
    week = sundayOf(date);
    void drawWeek();
  };

  const live = jobs.filter((j) => j.status !== 'cancelled');
  const cancelled = jobs.length - live.length;
  const shown = showCancelled ? jobs : live;
  const first = days[0]!;
  const last = days[6]!;
  const month = (d: string) => dayFmt(d, { month: 'long' });
  const num = (d: string) => dayFmt(d, { day: 'numeric' });
  const title =
    first.slice(0, 7) === last.slice(0, 7)
      ? `${month(first)} ${num(first)} – ${num(last)}, ${last.slice(0, 4)}`
      : `${month(first).slice(0, 3)} ${num(first)} – ${month(last).slice(0, 3)} ${num(last)}, ${last.slice(0, 4)}`;
  const isThisWeek = shownWeek === sundayOf(today());

  const jump = h('input', { type: 'date', class: 'sr-only', 'aria-label': 'Go to a day' }) as HTMLInputElement;
  jump.addEventListener('change', () => jump.value && go(jump.value));

  const header = h(
    'div',
    { class: 'mb-6 flex flex-col gap-4' },
    h(
      'div',
      { class: 'flex flex-wrap items-end justify-between gap-x-6 gap-y-3' },
      h(
        'div',
        {},
        h('h2', { class: heading, style: headingStyle }, title),
        h(
          'p',
          { class: 'mt-1 text-sm text-bone-400' },
          live.length ? `${live.length} ${live.length === 1 ? 'job' : 'jobs'} this week.` : 'Nothing booked this week.',
          cancelled
            ? h(
                'button',
                {
                  type: 'button',
                  class: 'ml-3 underline decoration-ink-600 underline-offset-4 hover:text-bone-50',
                  onclick: () => {
                    showCancelled = !showCancelled;
                    void drawWeek();
                  },
                },
                showCancelled ? `Hide ${cancelled} cancelled` : `Show ${cancelled} cancelled`,
              )
            : null,
        ),
      ),
      h(
        'div',
        { class: 'flex flex-wrap items-center gap-2' },
        h('button', { type: 'button', class: goldSmall, onclick: () => newJob({ date: isThisWeek ? today() : first }) }, 'New job'),
        h('button', { type: 'button', class: ghost, onclick: toOff }, 'Time off'),
      ),
    ),
    h(
      'nav',
      { class: 'flex flex-wrap items-center gap-2', 'aria-label': 'Weeks' },
      h('button', { type: 'button', class: ghost, onclick: () => go(addDays(first, -7)) }, '‹ Last week'),
      h('button', { type: 'button', class: ghost, disabled: isThisWeek, onclick: () => go(today()) }, 'This week'),
      h('button', { type: 'button', class: ghost, onclick: () => go(addDays(first, 7)) }, 'Next week ›'),
      h(
        'label',
        { class: `${ghost} relative cursor-pointer` },
        'Pick a day',
        jump,
      ),
    ),
  );
  // A hidden date input still opens its picker on a click on its label in
  // Chrome and Safari; showPicker covers the rest.
  jump.parentElement!.addEventListener('click', (e) => {
    e.preventDefault();
    try {
      jump.showPicker();
    } catch {
      jump.focus();
    }
  });

  const openDay = (date: string, start?: string) => newJob({ date, start });

  view().replaceChildren(
    header,
    grid(days, shown, offs, openDay),
    list(days, shown, offs, openDay),
    legend(),
    await timeOffSection(timeOff, () => void drawWeek()),
  );
}

function toOff() {
  const el = document.getElementById('time-off');
  if (!el) return;
  const ev = new CustomEvent('ked:scroll-to', { detail: el, cancelable: true });
  if (document.dispatchEvent(ev)) el.scrollIntoView();
}

/* ------------------------------------------------------------ pieces of a day */

interface Piece {
  top: number; // minutes after midnight
  bottom: number;
  job?: CalJob;
  off?: TimeOff;
  continues: boolean; // started on an earlier day
}

/** The part of each job and time off that falls on `date`. */
function piecesFor(date: string, jobs: CalJob[], offs: TimeOff[]): Piece[] {
  const dayStart = zonedToUtc(date, '00:00', TZ).getTime();
  const dayEnd = zonedToUtc(addDays(date, 1), '00:00', TZ).getTime();
  const cut = (start: string, end: string) => {
    const s = new Date(start).getTime();
    const e = new Date(end).getTime();
    if (s >= dayEnd || e <= dayStart) return null;
    return {
      top: s <= dayStart ? 0 : minuteOfDay(start),
      bottom: e >= dayEnd ? 24 * 60 : minuteOfDay(end) || 24 * 60,
      continues: s < dayStart,
    };
  };
  const out: Piece[] = [];
  for (const off of offs) {
    const c = cut(off.start, off.end);
    if (c) out.push({ ...c, off });
  }
  for (const job of jobs) {
    const c = cut(job.start, job.end);
    if (c) out.push({ ...c, job });
  }
  return out.sort((a, b) => a.top - b.top);
}

const openJobClick = (id: string) => () => void openJob(id);

/* ------------------------------------------------------------ wide: time grid */

function grid(days: string[], jobs: CalJob[], offs: TimeOff[], openDay: (date: string, start?: string) => void) {
  const now = today();
  const perDay = days.map((d) => piecesFor(d, jobs, offs));

  // Show working hours, stretched to fit anything booked outside them.
  const wk = rules?.week ?? [];
  const opens = wk.filter(Boolean).map((d) => Number(d!.open.slice(0, 2)));
  const closes = wk.filter(Boolean).map((d) => Math.ceil((Number(d!.close.slice(0, 2)) * 60 + Number(d!.close.slice(3))) / 60));
  let startHour = opens.length ? Math.min(...opens) : 8;
  let endHour = closes.length ? Math.max(...closes) : 18;
  for (const p of perDay.flat()) {
    // Only real starts and ends stretch it: all-day time off and the part of a
    // long job that spills past midnight just fill the grid they're given.
    if (p.off && p.top === 0 && p.bottom === 1440) continue;
    if (!p.continues) startHour = Math.min(startHour, Math.floor(p.top / 60));
    if (p.bottom < 1440) endHour = Math.max(endHour, Math.ceil(p.bottom / 60));
  }
  startHour = Math.max(0, startHour - 1);
  endHour = Math.min(24, endHour + 1);
  const hours = endHour - startHour;
  const height = hours * PX_PER_HOUR;
  const y = (minute: number) => ((Math.min(Math.max(minute, startHour * 60), endHour * 60) - startHour * 60) / 60) * PX_PER_HOUR;

  const hourLabel = (hr: number) => (hr === 0 || hr === 24 ? '12 AM' : hr === 12 ? 'Noon' : hr < 12 ? `${hr} AM` : `${hr - 12} PM`);

  const gutter = h(
    'div',
    { class: 'relative', style: `height:${height}px` },
    ...Array.from({ length: hours }, (_, i) =>
      h('span', { class: 'absolute right-2 -translate-y-1/2 text-[0.68rem] tabular-nums text-bone-500', style: `top:${i * PX_PER_HOUR}px` }, i === 0 ? '' : hourLabel(startHour + i)),
    ),
  );

  const columns = days.map((date, di) => {
    const closed = rules ? rules.week[weekday(date)] === null : false;
    const col = h('div', {
      class: `relative border-l border-ink-800 ${closed ? 'bg-ink-900/70' : ''} ${date === now ? 'bg-gold-500/[0.03]' : ''} cursor-copy`,
      style: `height:${height}px;background-image:linear-gradient(to bottom, var(--color-ink-800) 1px, transparent 1px);background-size:100% ${PX_PER_HOUR}px`,
      title: 'Click an empty spot to book a job then',
    });
    col.addEventListener('click', (e) => {
      if (e.target !== col) return;
      const minute = startHour * 60 + Math.floor(((e.offsetY / PX_PER_HOUR) * 60) / 30) * 30;
      const hh = String(Math.floor(minute / 60)).padStart(2, '0');
      const mm = String(minute % 60).padStart(2, '0');
      openDay(date, `${hh}:${mm}`);
    });

    const pieces = perDay[di]!;
    // Time off sits behind jobs across the whole column.
    for (const p of pieces.filter((x) => x.off)) {
      col.append(
        h(
          'div',
          {
            class: 'pointer-events-none absolute inset-x-0 border-l-2 border-bone-500 px-2 py-1 text-[0.7rem] text-bone-400',
            style: `top:${y(p.top)}px;height:${Math.max(y(p.bottom) - y(p.top), 18)}px;background-image:repeating-linear-gradient(135deg, rgb(255 255 255 / 0.045) 0 6px, transparent 6px 12px)`,
          },
          h('span', { class: 'font-semibold uppercase tracking-[0.12em] text-bone-200' }, 'Off'),
          p.off!.reason ? ` ${p.off!.reason}` : '',
        ),
      );
    }

    // Jobs side by side when they overlap.
    const jobsHere = pieces.filter((x) => x.job);
    const lanes: number[] = [];
    const laneOf = new Map<Piece, number>();
    for (const p of jobsHere) {
      let lane = lanes.findIndex((end) => end <= p.top);
      if (lane === -1) lane = lanes.push(0) - 1;
      lanes[lane] = p.bottom;
      laneOf.set(p, lane);
    }
    const n = Math.max(1, lanes.length);
    for (const p of jobsHere) {
      const j = p.job!;
      const top = y(p.top);
      const tall = Math.max(y(p.bottom) - top, 24);
      const lane = laneOf.get(p)!;
      col.append(
        h(
          'button',
          {
            type: 'button',
            class: `absolute flex flex-col justify-start overflow-hidden border-l-2 ${STATUS_EDGE[j.status]} bg-ink-850 px-2 py-1 text-left text-[0.72rem] leading-snug transition-colors hover:bg-ink-800 focus-visible:outline-2 focus-visible:outline-gold-400 ${j.status === 'cancelled' ? 'opacity-50' : ''}`,
            style: `top:${top + 1}px;height:${tall - 2}px;left:calc(${(lane / n) * 100}% + 2px);width:calc(${100 / n}% - 4px)`,
            onclick: openJobClick(j.id),
            title: `${j.customer.name}, ${serviceName(j)}`,
          },
          h('span', { class: `block tabular-nums ${STATUS_TEXT[j.status]}` }, p.continues ? `until ${time(j.end)}` : time(j.start), j.status === 'scheduled' ? '' : ` · ${STATUS[j.status]}`),
          h('span', { class: `block truncate font-semibold text-bone-50 ${j.status === 'cancelled' ? 'line-through' : ''}` }, j.customer.name),
          h('span', { class: 'block truncate text-bone-400' }, serviceName(j)),
          j.vehicle ? h('span', { class: 'block truncate text-bone-500' }, j.vehicle) : null,
          j.source === 'web' ? h('span', { class: 'block truncate text-gold-400' }, 'Booked online') : null,
        ),
      );
    }

    // The time right now, on today's column.
    if (date === now) {
      const m = minuteOfDay(new Date());
      if (m >= startHour * 60 && m <= endHour * 60) {
        col.append(
          h('div', { class: 'pointer-events-none absolute inset-x-0 z-10 h-px bg-gold-500', style: `top:${y(m)}px` }, h('span', { class: 'absolute -left-1 -top-[3px] size-[7px] bg-gold-500' })),
        );
      }
    }
    return col;
  });

  const head = days.map((date) =>
    h(
      'div',
      { class: `border-l border-t-2 px-2 pb-2 pt-2 ${date === now ? 'border-t-gold-500 border-l-ink-800' : 'border-t-transparent border-l-ink-800'}` },
      h('p', { class: `${small} ${date === now ? '!text-gold-400' : ''}` }, dayFmt(date, { weekday: 'short' }), date === now ? ' · Today' : ''),
      h('p', { class: `font-display text-2xl tabular-nums ${date === now ? 'text-gold-400' : 'text-bone-50'}`, style: "font-variation-settings:'wdth' 80,'wght' 700" }, dayFmt(date, { day: 'numeric' })),
      rules && rules.week[weekday(date)] === null ? h('p', { class: 'text-[0.7rem] text-bone-500' }, 'Closed') : null,
    ),
  );

  return h(
    'div',
    { class: 'hidden border-b border-r border-ink-800 lg:grid', style: 'grid-template-columns:3.75rem repeat(7, minmax(0, 1fr))' },
    h('div', {}),
    ...head,
    gutter,
    ...columns,
  );
}

/* ------------------------------------------------------------ narrow: a list per day */

function list(days: string[], jobs: CalJob[], offs: TimeOff[], openDay: (date: string) => void) {
  const now = today();
  return h(
    'div',
    { class: 'lg:hidden' },
    ...days.map((date) => {
      const pieces = piecesFor(date, jobs, offs);
      const isToday = date === now;
      const closed = rules ? rules.week[weekday(date)] === null : false;
      return h(
        'section',
        { class: `border-t py-4 ${isToday ? 'border-gold-500' : 'border-ink-800'}` },
        h(
          'div',
          { class: 'mb-2 flex items-baseline justify-between gap-4' },
          h(
            'h3',
            { class: `font-display text-sm uppercase tracking-[0.14em] ${isToday ? 'text-gold-400' : 'text-bone-50'}` },
            dayFmt(date, { weekday: 'long', month: 'short', day: 'numeric' }),
            isToday ? h('span', { class: 'ml-2 text-bone-400' }, 'Today') : null,
          ),
          h('button', { type: 'button', class: 'shrink-0 text-sm text-bone-400 hover:text-gold-400', onclick: () => openDay(date) }, '+ Add job'),
        ),
        pieces.length
          ? h('ul', {}, ...pieces.map((p) => (p.job ? jobRow(p) : offRow(p))))
          : h('p', { class: 'text-sm text-bone-500' }, closed ? 'Closed.' : 'Nothing booked.'),
      );
    }),
  );
}

function jobRow(p: Piece) {
  const j = p.job!;
  return h(
    'li',
    {},
    h(
      'button',
      {
        type: 'button',
        class: `grid w-full grid-cols-[4.75rem_1fr] gap-3 border-l-2 ${STATUS_EDGE[j.status]} py-2.5 pl-3 text-left transition-colors hover:bg-ink-900 ${j.status === 'cancelled' ? 'opacity-55' : ''}`,
        onclick: openJobClick(j.id),
      },
      h(
        'span',
        { class: 'flex flex-col text-sm tabular-nums' },
        h('span', { class: 'text-bone-50' }, p.continues ? 'Cont.' : time(j.start)),
        h('span', { class: 'text-bone-500' }, `to ${localDate(j.end, TZ) === localDate(j.start, TZ) ? '' : `${dayFmt(localDate(j.end, TZ), { weekday: 'short' })} `}${time(j.end)}`),
      ),
      h(
        'span',
        { class: 'flex min-w-0 flex-col gap-0.5' },
        h(
          'span',
          { class: 'flex flex-wrap items-baseline gap-x-3' },
          h('span', { class: `font-semibold text-bone-50 ${j.status === 'cancelled' ? 'line-through' : ''}` }, j.customer.name),
          h('span', { class: `text-xs uppercase tracking-[0.14em] ${STATUS_TEXT[j.status]}` }, STATUS[j.status]),
          j.source === 'web' ? h('span', { class: 'text-xs uppercase tracking-[0.14em] text-gold-400' }, 'Online') : null,
        ),
        h('span', { class: 'truncate text-sm text-bone-200' }, [serviceName(j), j.vehicle].filter(Boolean).join(' · ')),
        h('span', { class: 'truncate text-sm text-bone-400' }, j.address),
      ),
    ),
  );
}

function offRow(p: Piece) {
  const t = p.off!;
  const allDay = p.top === 0 && p.bottom === 1440;
  return h(
    'li',
    {
      class: 'grid grid-cols-[4.75rem_1fr] gap-3 border-l-2 border-bone-500 py-2.5 pl-3 text-sm',
      style: 'background-image:repeating-linear-gradient(135deg, rgb(255 255 255 / 0.04) 0 6px, transparent 6px 12px)',
    },
    h('span', { class: 'font-semibold uppercase tracking-[0.12em] text-bone-200' }, 'Off'),
    h('span', { class: 'text-bone-400' }, allDay ? 'All day' : span(t.start, t.end), t.reason ? ` · ${t.reason}` : ''),
  );
}

function legend() {
  const item = (edge: string, label: string) =>
    h('span', { class: 'flex items-center gap-2' }, h('span', { class: `inline-block h-3 border-l-2 ${edge}` }), label);
  return h(
    'p',
    { class: 'mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-bone-500' },
    item(STATUS_EDGE.scheduled, 'Booked'),
    item(STATUS_EDGE.in_progress, 'Started'),
    item(STATUS_EDGE.done, 'Done'),
    h(
      'span',
      { class: 'flex items-center gap-2' },
      h('span', { class: 'inline-block h-3 w-4 border-l-2 border-bone-500', style: 'background-image:repeating-linear-gradient(135deg, rgb(255 255 255 / 0.2) 0 2px, transparent 2px 4px)' }),
      'Time off',
    ),
    h('span', { class: 'hidden lg:inline' }, 'Click an empty spot to book a job at that time.'),
  );
}
