import { addDays, localDate, minutesOf, weekday, zonedToUtc } from './time.ts';
import { NEARBY_MILES, driveMinutes, milesBetween } from './travel.ts';

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
  /**
   * Kept clear either side of a job. With `travel` on, only used when either
   * job's location is unknown; otherwise the gap is the drive plus pack-up.
   */
  bufferMinutes: number;
  /**
   * Space jobs by the drive between them (estimated from ZIP codes, see
   * travel.ts). Missing on rules saved before it existed, which means off.
   */
  travel?: Travel;
  maxJobsPerDay: number;
  /** No online booking closer to now than this. */
  minNoticeHours: number;
  /** How far ahead online booking is open. */
  horizonDays: number;
}

export interface Travel {
  on: boolean;
  /** Where Jacob starts the day, for the drive to his first job. */
  homeZip: string;
  /** Packing up at one job and setting up at the next, on top of the drive. */
  packUpMinutes: number;
}

/** A span of time that's taken. Jobs get the gap around them; time off doesn't. */
export interface Busy {
  start: string | Date;
  end: string | Date;
  /** Jobs only: where it is, for the drive to and from it. */
  zip?: string | null;
}

export interface Calendar {
  jobs: Busy[];
  timeOff: Busy[];
}

export interface Day {
  date: string;
  /** ISO start instants, earliest first. */
  slots: string[];
  /** Jacob already has a job within NEARBY_MILES of this one that day. */
  nearby?: boolean;
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
 * Minutes to keep clear between a job at `a` and one at `b`: the drive plus
 * pack-up when travel is on and both places are known, else the flat buffer.
 */
export function gapMinutes(rules: BookingRules, a: string | null | undefined, b: string | null | undefined): number {
  if (!rules.travel?.on) return rules.bufferMinutes;
  const drive = driveMinutes(a, b);
  return drive === null ? rules.bufferMinutes : rules.travel.packUpMinutes + drive;
}

/**
 * The smallest gap any two jobs can have. The database's last-moment overlap
 * check uses it, since it can't estimate drives; slotProblem has already
 * checked each pair properly.
 */
export const minGapMinutes = (rules: BookingRules) =>
  rules.travel?.on ? Math.min(rules.bufferMinutes, rules.travel.packUpMinutes) : rules.bufferMinutes;

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
  zip?: string | null,
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

  for (const j of calendar.jobs) {
    const gap = gapMinutes(rules, j.zip, zip) * 60_000;
    if (s < ms(j.end) + gap && e + gap > ms(j.start)) return 'taken';
  }
  for (const t of calendar.timeOff) {
    if (s < ms(t.end) && e > ms(t.start)) return 'taken';
  }
  return null;
}

/**
 * Every bookable start for a job of `minutes` at `zip`, day by day, from
 * today to the horizon. Days where Jacob is already nearby say so.
 */
export function openSlots(rules: BookingRules, calendar: Calendar, minutes: number, now: Date, zip?: string | null): Day[] {
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
        if (slotProblem(rules, calendar, start, minutes, now, zip) === null) day.slots.push(start.toISOString());
      }
      if (day.slots.length && rules.travel?.on && zip) {
        day.nearby = calendar.jobs.some((j) => localDate(j.start, tz) === date && (milesBetween(j.zip, zip) ?? Infinity) <= NEARBY_MILES);
      }
    }
    days.push(day);
  }
  return days;
}

const ms = (t: string | Date) => new Date(t).getTime();
