import type { BookingRules } from './slots.ts';

/**
 * PLACEHOLDER RULES until Jacob confirms his: seven days a week per the site,
 * two jobs a day, an hour between jobs for driving, a day's notice, a month
 * ahead.
 */
const day = { open: '08:00', close: '18:00' };

export const defaultRules: BookingRules = {
  onlineBooking: true,
  timezone: 'America/Chicago',
  week: [day, day, day, day, day, day, day],
  slotStepMinutes: 60,
  bufferMinutes: 60,
  maxJobsPerDay: 2,
  minNoticeHours: 24,
  horizonDays: 30,
};
