import { addDays, localDate, minutesOf, weekday, zonedToUtc } from './time.ts';

export interface DayHours {
  /** 'HH:MM', 24-hour, in the business's zone. */
  open: string;
  close: string;
}

/**
 * Jacob's booking rules. Like PricingConfig, every number lives here so he can
 * change them from the app without a code change.
 */
export interface BookingRules {
  /** Master switch. Off: the website takes quote requests but no bookings. */
  onlineBooking: boolean;
  /** IANA zone every date and time below is in. */
  timezone: string;
  /** Sunday first. Null means closed that day. */
  week: [DayHours | null, DayHours | null, DayHours | null, DayHours | null, DayHours | null, DayHours | null, DayHours | null];
  /** Offered start times fall on this grid from opening time, and durations round up to it. */
  slotStepMinutes: number;
  /** Kept clear either side of a job, for driving and setup. */
  bufferMinutes: number;
  maxJobsPerDay: number;
  /** No online booking closer to now than this. */
  minNoticeHours: number;
  /** How far ahead online booking is open. */
  horizonDays: number;
}

/** A span of time that's taken. Jobs get the buffer around them; time off doesn't. */
export interface Busy {
  start: string | Date;
  end: string | Date;
}

export interface Calendar {
  jobs: Busy[];
  timeOff: Busy[];
}

export interface Day {
  date: string;
  /** ISO start instants, earliest first. */
  slots: string[];
}

export type SlotProblem =
  | 'booking_off'
  | 'too_long'
  | 'closed'
  | 'outside_hours'
  | 'off_grid'
  | 'too_soon'
  | 'too_far'
  | 'day_full'
  | 'taken';

/**
 * How long to hold the calendar for a job, from the quote's [low, high] hours.
 * The high end, so a slow job never runs into the next one, rounded up to the
 * slot grid.
 */
export function jobMinutes(hours: [number, number], rules: BookingRules): number {
  const step = rules.slotStepMinutes;
  return Math.max(step, Math.ceil((hours[1] * 60) / step) * step);
}

/**
 * Why a job of `minutes` can't start at `start`, or null if it can. The one
 * rule used both to list slots and to accept a booking, so they can't disagree.
 */
export function slotProblem(
  rules: BookingRules,
  calendar: Calendar,
  start: Date,
  minutes: number,
  now: Date,
): SlotProblem | null {
  if (!rules.onlineBooking) return 'booking_off';
  const tz = rules.timezone;
  const date = localDate(start, tz);
  const hours = rules.week[weekday(date)];
  if (!hours) return 'closed';
  if (minutes > minutesOf(hours.close) - minutesOf(hours.open)) return 'too_long';

  const open = zonedToUtc(date, hours.open, tz).getTime();
  const close = zonedToUtc(date, hours.close, tz).getTime();
  const s = start.getTime();
  const e = s + minutes * 60_000;
  if (s < open || e > close) return 'outside_hours';
  if ((s - open) % (rules.slotStepMinutes * 60_000) !== 0) return 'off_grid';
  if (s < now.getTime() + rules.minNoticeHours * 3_600_000) return 'too_soon';
  if (date > addDays(localDate(now, tz), rules.horizonDays)) return 'too_far';

  const sameDay = calendar.jobs.filter((j) => localDate(j.start, tz) === date).length;
  if (sameDay >= rules.maxJobsPerDay) return 'day_full';

  const buffer = rules.bufferMinutes * 60_000;
  for (const j of calendar.jobs) {
    if (s < ms(j.end) + buffer && e + buffer > ms(j.start)) return 'taken';
  }
  for (const t of calendar.timeOff) {
    if (s < ms(t.end) && e > ms(t.start)) return 'taken';
  }
  return null;
}

/** Every bookable start for a job of `minutes`, day by day, from today to the horizon. */
export function openSlots(rules: BookingRules, calendar: Calendar, minutes: number, now: Date): Day[] {
  if (!rules.onlineBooking) return [];
  const tz = rules.timezone;
  const today = localDate(now, tz);
  const days: Day[] = [];
  for (let i = 0; i <= rules.horizonDays; i++) {
    const date = addDays(today, i);
    const hours = rules.week[weekday(date)];
    const day: Day = { date, slots: [] };
    if (hours) {
      const last = minutesOf(hours.close) - minutes;
      for (let m = minutesOf(hours.open); m <= last; m += rules.slotStepMinutes) {
        const start = zonedToUtc(date, `${Math.floor(m / 60)}:${m % 60}`, tz);
        if (slotProblem(rules, calendar, start, minutes, now) === null) day.slots.push(start.toISOString());
      }
    }
    days.push(day);
  }
  return days;
}

const ms = (t: string | Date) => new Date(t).getTime();
