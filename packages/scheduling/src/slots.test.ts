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
  driveMinutes,
  gapMinutes,
  minGapMinutes,
  roadMiles,
  zipOf,
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

test('drive estimates from ZIP codes, and finding the ZIP in an address', () => {
  assert.equal(driveMinutes('63049', '63049'), 5, 'same ZIP: just getting going');
  assert.equal(driveMinutes('63049', '63122'), 25, 'High Ridge to Kirkwood');
  assert.equal(driveMinutes('63049', '62025'), 65, 'across the river to Edwardsville');
  assert.equal(roadMiles('63049', '63122'), 11);
  assert.equal(driveMinutes('63049', '99501'), null, 'outside the table');
  assert.equal(driveMinutes(null, '63049'), null);
  assert.equal(zipOf(null, '12 Oak St, Fenton MO 63026'), '63026');
  assert.equal(zipOf('63026-1234'), '63026');
  assert.equal(zipOf('', '4 Elm St'), null);
});

test('with travel on, jobs are spaced by the drive plus pack-up; unknown places get the flat buffer', () => {
  // A 10-12 job in Kirkwood. Travel on, 15 minutes to pack up.
  const cal: Calendar = { jobs: [{ start: at('2026-07-02', '10:00'), end: at('2026-07-02', '12:00'), zip: '63122' }], timeOff: [] };
  assert.equal(gapMinutes(rules, '63122', '63122'), 20);
  assert.equal(gapMinutes(rules, '63122', '62025'), 15 + driveMinutes('63122', '62025')!);
  assert.equal(gapMinutes(rules, '63122', null), 60);

  // Next door: 12:20 would do, so 13:00 on the hourly grid is the first after it.
  assert.deepEqual(slotsOn(openSlots(rules, cal, 60, now, '63122'), '2026-07-02'), ['08:00', '13:00', '14:00', '15:00', '16:00', '17:00']);
  // Edwardsville needs about an hour and a half after 12: 14:00 at the earliest,
  // and has to finish that long before 10, so 8:00 is out.
  const far = slotsOn(openSlots(rules, cal, 60, now, '62025'), '2026-07-02');
  assert.equal(far[0], '14:00');
  // No ZIP: the flat hour either side, as before (8-9 still leaves an hour before 10).
  assert.deepEqual(slotsOn(openSlots(rules, cal, 60, now), '2026-07-02'), ['08:00', '13:00', '14:00', '15:00', '16:00', '17:00']);

  const off: BookingRules = { ...rules, travel: { ...rules.travel!, on: false } };
  assert.equal(gapMinutes(off, '63122', '63122'), 60);
  assert.equal(minGapMinutes(rules), 15);
  assert.equal(minGapMinutes(off), 60);
});

test('a day with a job nearby says so', () => {
  const cal: Calendar = { jobs: [{ start: at('2026-07-02', '08:00'), end: at('2026-07-02', '10:00'), zip: '63122' }], timeOff: [] };
  const near = openSlots(rules, cal, 60, now, '63119'); // Webster Groves, next to Kirkwood
  assert.equal(near.find((d) => d.date === '2026-07-02')!.nearby, true);
  assert.equal(near.find((d) => d.date === '2026-07-03')!.nearby, false);
  assert.equal(openSlots(rules, cal, 60, now, '62025').find((d) => d.date === '2026-07-02')!.nearby, false);
});

test('travel settings are checked', () => {
  const bad = structuredClone(rules) as BookingRules;
  bad.travel = { on: true, homeZip: 'High Ridge', packUpMinutes: -5 };
  assert.equal(validateRules(bad).length, 2, validateRules(bad).join('\n'));
  const old = structuredClone(rules) as BookingRules;
  delete old.travel;
  assert.deepEqual(validateRules(old), [], 'rules saved before travel existed are still fine');
});
