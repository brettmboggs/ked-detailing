import type { BookingRules } from './slots.ts';

/**
 * PLACEHOLDER RULES until Jacob confirms his: seven days a week per the site,
 * two jobs a day, jobs spaced by the drive between them plus 15 minutes to
 * pack up (an hour when we can't tell where a job is), a day's notice, a
 * month ahead.
 */
const day = { open: '08:00', close: '18:00' };

export const defaultRules: BookingRules = {
  onlineBooking: true,
  timezone: 'America/Chicago',
  week: [day, day, day, day, day, day, day],
  slotStepMinutes: 60,
  bufferMinutes: 60,
  // TENANT: home base is High Ridge.
  travel: { on: true, homeZip: '63049', packUpMinutes: 15 },
  maxJobsPerDay: 2,
  minNoticeHours: 24,
  horizonDays: 30,
};
