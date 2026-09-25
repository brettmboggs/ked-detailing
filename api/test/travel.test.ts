import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, defaultRules, driveMinutes, localDate, zonedToUtc } from '@ked/scheduling';

// Run through `npm test`, which starts a local Worker with an empty D1.
const API = process.env.API!;
const admin = { Authorization: `Bearer ${process.env.ADMIN_TOKEN}` };

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${API}/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await res.text();
  return { status: res.status, body: raw ? JSON.parse(raw) : null };
}

const tz = defaultRules.timezone;
const input = (zip: string) => ({ service: 'level-1', vehicleClass: 'sedan', zip });
const clock = (iso: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

/** A day inside the booking window with nothing on it yet. */
async function emptyDay() {
  const today = localDate(new Date(), tz);
  const jobs = (await call('GET', `/jobs?to=${new Date(Date.now() + 40 * 864e5).toISOString()}`, undefined, admin)).body.jobs;
  const busy = new Set(jobs.filter((j: { status: string }) => j.status !== 'cancelled').map((j: { date: string }) => j.date));
  for (let i = 25; i > 3; i--) {
    const d = addDays(today, i);
    if (!busy.has(d)) return d;
  }
  throw new Error('no empty day in the window');
}

test('open times allow for the drive from the job before, and say when Jacob is nearby', async () => {
  assert.equal((await call('PUT', '/settings/booking', defaultRules, admin)).status, 200);
  const day = await emptyDay();
  // A 10:00 job in High Ridge (3 hours with the default quote).
  const first = await call(
    'POST',
    '/jobs',
    { customer: { name: 'High Ridge Job', phone: '636-555-0101' }, address: '1 Main St, High Ridge MO 63049', input: input('63049'), start: zonedToUtc(day, '10:00', tz).toISOString() },
    admin,
  );
  assert.equal(first.status, 201);
  const ends = clock(first.body.job.end);

  const on = async (zip: string) => {
    const r = await call('POST', '/availability', { input: input(zip) });
    return r.body.days.find((d: { date: string }) => d.date === day) as { slots: string[]; nearby?: boolean };
  };
  // Next door: pack-up plus a short drive, so the next hour on the grid.
  const near = await on('63049');
  const firstNear = near.slots.map(clock).find((t) => t > ends)!;
  assert.equal(near.nearby, true);
  // Farmington is over an hour's drive: its first slot after is later.
  const far = await on('63640');
  const firstFar = far.slots.map(clock).find((t) => t > ends)!;
  assert.equal(far.nearby, false);
  assert.ok(firstFar > firstNear, `${firstFar} should be later than ${firstNear}`);
  const gap = (t: string) => {
    const [h, m] = t.split(':').map(Number) as [number, number];
    const [eh, em] = ends.split(':').map(Number) as [number, number];
    return h * 60 + m - (eh * 60 + em);
  };
  assert.ok(gap(firstFar) >= 15 + driveMinutes('63049', '63640')!, 'leaves the drive plus pack-up');

  // Booking the near slot works; the far customer can't take a time that's too tight.
  const tight = zonedToUtc(day, firstNear, tz).toISOString();
  const refused = await call('POST', '/bookings', { name: 'Far Customer', phone: '573-555-0199', address: '2 Oak St', zip: '63640', input: input('63640'), start: tight });
  assert.equal(refused.status, 409);
  const booked = await call('POST', '/bookings', { name: 'Near Customer', phone: '636-555-0102', address: '3 Elm St', zip: '63049', input: input('63049'), start: tight });
  assert.equal(booked.status, 201);

  // Jacob booking by hand gets told when the drive won't fit.
  const squeezed = await call(
    'POST',
    '/jobs',
    { customer: { name: 'Squeezed In', phone: '314-555-0198' }, address: '9 Pine St, Farmington MO 63640', input: input('63640'), start: zonedToUtc(day, '07:00', tz).toISOString(), minutes: 150 },
    admin,
  );
  assert.equal(squeezed.status, 201);
  assert.ok(
    squeezed.body.warnings.some((w: string) => /Only 30 minutes between this and the 10:00 AM job, and the drive is about \d+\./.test(w)),
    squeezed.body.warnings.join(' | '),
  );

  // Leave the calendar as it was for other suites.
  for (const id of [first.body.job.id, booked.body.id, squeezed.body.job.id]) {
    await call('PATCH', `/jobs/${id}`, { status: 'cancelled' }, admin);
  }
});
