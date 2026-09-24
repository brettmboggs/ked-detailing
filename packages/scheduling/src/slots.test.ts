import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultRules,
  jobMinutes,
  localDate,
  openSlots,
  slotProblem,
  validateRules,
  weekday,
  zonedToUtc,
  type BookingRules,
  type Calendar,
} from './index.ts';

const rules = defaultRules;
const empty: Calendar = { jobs: [], timeOff: [] };
const tz = 'America/Chicago';
/** 07:00 on Wed 1 July 2026 in St. Louis. */
const now = new Date('2026-07-01T12:00:00Z');
const at = (date: string, time: string) => zonedToUtc(date, time, tz);
const clock = (iso: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
const slotsOn = (days: ReturnType<typeof openSlots>, date: string) =>
  days.find((d) => d.date === date)!.slots.map(clock);

test('wall-clock conversion, including both DST changes', () => {
  assert.equal(at('2026-07-01', '08:00').toISOString(), '2026-07-01T13:00:00.000Z'); // CDT
  assert.equal(at('2026-12-01', '08:00').toISOString(), '2026-12-01T14:00:00.000Z'); // CST
  assert.equal(at('2026-03-08', '08:00').toISOString(), '2026-03-08T13:00:00.000Z'); // spring forward
  assert.equal(at('2026-11-01', '08:00').toISOString(), '2026-11-01T14:00:00.000Z'); // fall back
  assert.equal(localDate('2026-07-02T03:00:00Z', tz), '2026-07-01');
});

test('the defaults are valid', () => {
  assert.deepEqual(validateRules(rules), []);
});

test('job length is the high end of the quote, rounded up to the grid', () => {
  assert.equal(jobMinutes([2, 3], rules), 180);
  assert.equal(jobMinutes([4, 7.2], rules), 480);
  assert.equal(jobMinutes([0, 0.2], rules), 60);
});

test('an empty calendar offers every grid start that fits, after the notice period', () => {
  const days = openSlots(rules, empty, 240, now);
  assert.equal(days.length, rules.horizonDays + 1);
  assert.deepEqual(slotsOn(days, '2026-07-01'), [], 'today is inside 24 hours');
  assert.deepEqual(slotsOn(days, '2026-07-02'), ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00']);
});

test('a booked job blocks itself plus the travel buffer either side', () => {
  const cal: Calendar = { jobs: [{ start: at('2026-07-02', '10:00'), end: at('2026-07-02', '14:00') }], timeOff: [] };
  assert.deepEqual(slotsOn(openSlots(rules, cal, 240, now), '2026-07-02'), []);
  assert.deepEqual(slotsOn(openSlots(rules, cal, 120, now), '2026-07-02'), ['15:00', '16:00']);
});

test('a full day offers nothing, however much time is left', () => {
  const cal: Calendar = {
    jobs: [
      { start: at('2026-07-03', '08:00'), end: at('2026-07-03', '09:00') },
      { start: at('2026-07-03', '10:00'), end: at('2026-07-03', '11:00') },
    ],
    timeOff: [],
  };
  assert.deepEqual(slotsOn(openSlots(rules, cal, 60, now), '2026-07-03'), []);
  assert.equal(slotProblem(rules, cal, at('2026-07-03', '15:00'), 60, now), 'day_full');
});

test('time off blocks without a buffer', () => {
  const cal: Calendar = { jobs: [], timeOff: [{ start: at('2026-07-04', '08:00'), end: at('2026-07-04', '12:00') }] };
  assert.equal(slotsOn(openSlots(rules, cal, 240, now), '2026-07-04')[0], '12:00');
});

test('closed days, too-long jobs, off-grid and out-of-range starts are refused', () => {
  const closed: BookingRules = structuredClone(rules);
  closed.week[weekday('2026-07-05')] = null;
  assert.deepEqual(slotsOn(openSlots(closed, empty, 60, now), '2026-07-05'), []);

  assert.ok(openSlots(rules, empty, 11 * 60, now).every((d) => d.slots.length === 0));
  assert.equal(slotProblem(rules, empty, at('2026-07-02', '08:00'), 11 * 60, now), 'too_long');
  assert.equal(slotProblem(rules, empty, at('2026-07-02', '08:30'), 60, now), 'off_grid');
  assert.equal(slotProblem(rules, empty, at('2026-07-02', '07:00'), 60, now), 'outside_hours');
  assert.equal(slotProblem(rules, empty, at('2026-07-01', '14:00'), 60, now), 'too_soon');
  assert.equal(slotProblem(rules, empty, at('2026-08-15', '08:00'), 60, now), 'too_far');
  assert.equal(slotProblem(rules, empty, at('2026-07-02', '08:00'), 60, now), null);
});

test('switching online booking off empties the calendar', () => {
  const off = { ...rules, onlineBooking: false };
  assert.deepEqual(openSlots(off, empty, 60, now), []);
  assert.equal(slotProblem(off, empty, at('2026-07-02', '08:00'), 60, now), 'booking_off');
});

test('slots on a DST change day are still on the local grid', () => {
  const march = new Date('2026-03-06T12:00:00Z');
  assert.deepEqual(slotsOn(openSlots(rules, empty, 540, march), '2026-03-08'), ['08:00', '09:00']);
});

test('validation catches hand-edit mistakes', () => {
  const bad = structuredClone(rules) as BookingRules;
  bad.timezone = 'Mars/Olympus';
  bad.week[1] = { open: '18:00', close: '08:00' };
  bad.week[2] = { open: '8am', close: '5pm' };
  bad.slotStepMinutes = 7;
  bad.maxJobsPerDay = 0;
  assert.equal(validateRules(bad).length, 5, validateRules(bad).join('\n'));
});
