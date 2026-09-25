import type { BookingRules } from './slots.ts';
import { minutesOf } from './time.ts';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Plain-English problems, empty when the rules are safe to save. */
export function validateRules(rules: BookingRules): string[] {
  const errors: string[] = [];
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: rules.timezone });
  } catch {
    errors.push(`"${rules.timezone}" isn't a time zone.`);
  }
  if (!Array.isArray(rules.week) || rules.week.length !== 7) {
    errors.push('Hours need an entry for each day of the week.');
  } else {
    rules.week.forEach((h, i) => {
      if (h === null) return;
      if (!HHMM.test(h.open) || !HHMM.test(h.close)) {
        errors.push(`${DAYS[i]}: times must look like 08:00.`);
      } else if (minutesOf(h.close) <= minutesOf(h.open)) {
        errors.push(`${DAYS[i]}: closing time must be after opening time.`);
      }
    });
  }
  const whole = (n: number, min: number) => Number.isInteger(n) && n >= min;
  if (!whole(rules.slotStepMinutes, 5) || 1440 % rules.slotStepMinutes !== 0) {
    errors.push('Start times must be a step that divides the day, like 30 or 60 minutes.');
  }
  if (!whole(rules.bufferMinutes, 0)) errors.push('Time between jobs must be whole minutes, zero or more.');
  if (rules.travel !== undefined) {
    const t = rules.travel;
    if (!t || typeof t.on !== 'boolean') errors.push('Drive time must be on or off.');
    else {
      if (!/^\d{5}$/.test(t.homeZip)) errors.push('Home ZIP must be 5 digits.');
      if (!whole(t.packUpMinutes, 0) || t.packUpMinutes > 240) errors.push('Pack-up time must be whole minutes, up to 4 hours.');
    }
  }
  if (!whole(rules.maxJobsPerDay, 1)) errors.push('Jobs per day must be at least 1.');
  if (!(rules.minNoticeHours >= 0)) errors.push("Notice can't be negative.");
  if (!whole(rules.horizonDays, 1) || rules.horizonDays > 365) {
    errors.push('Booking ahead must be between 1 and 365 days.');
  }
  if (typeof rules.onlineBooking !== 'boolean') errors.push('Online booking must be on or off.');
  return errors;
}
