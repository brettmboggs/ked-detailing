import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultRules } from '@ked/scheduling';

// Run through `npm test`, which starts a local Worker with an empty D1.
const API = process.env.API!;
const admin = { Authorization: `Bearer ${process.env.ADMIN_TOKEN}` };

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${API}/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const textBody = await res.text();
  return { status: res.status, body: (textBody ? JSON.parse(textBody) : null) as any };
}

/** Level I on a sedan: 3 hours at the high end, so 180 minutes on the calendar. */
const input = { service: 'level-1', vehicleClass: 'sedan', conditions: {}, addOns: [] };
const customer = {
  name: 'Pat Booker',
  phone: '(314) 555-0142',
  email: 'pat@example.com',
  address: '12 Elm St, High Ridge',
  zip: '63049',
  vehicle: '2019 Accord',
};

async function slots() {
  const r = await call('POST', '/availability', { input });
  assert.equal(r.status, 200);
  return r.body;
}
const firstSlot = async () => (await slots()).days.find((d: any) => d.slots.length).slots[0] as string;
const allSlots = async () => (await slots()).days.flatMap((d: any) => d.slots) as string[];

test('availability sizes the job from the quote and lists open starts', async () => {
  const a = await slots();
  assert.equal(a.bookable, true);
  assert.equal(a.minutes, 180);
  assert.equal(a.timezone, 'America/Chicago');
  assert.equal(a.days.length, defaultRules.horizonDays + 1);
  assert.ok((await allSlots()).length > 50);
});

test('inspection-only work is routed to Jacob, not the calendar', async () => {
  const r = await call('POST', '/availability', { input: { service: 'ceramic', vehicleClass: 'sedan' } });
  assert.equal(r.body.bookable, false);
  assert.match(r.body.reason, /Jacob needs to see this/);
  const b = await call('POST', '/bookings', { ...customer, input: { service: 'ceramic', vehicleClass: 'sedan' }, start: await firstSlot() });
  assert.equal(b.status, 422);
  assert.equal(b.body.error.code, 'not_bookable');
});

test('a booking takes its slot, and the same slot cannot be booked twice', async () => {
  const start = await firstSlot();
  const booked = await call('POST', '/bookings', { ...customer, input, start });
  assert.equal(booked.status, 201, JSON.stringify(booked.body));
  assert.equal(booked.body.start, start);
  assert.equal(new Date(booked.body.end).getTime() - new Date(start).getTime(), 180 * 60_000);

  assert.ok(!(await allSlots()).includes(start), 'slot no longer offered');
  const again = await call('POST', '/bookings', { ...customer, name: 'Someone Else', phone: '314-555-0999', input, start });
  assert.equal(again.status, 409);
  assert.equal(again.body.error.code, 'slot_taken');
});

test('two people racing for one slot: exactly one wins', async () => {
  const start = await firstSlot();
  const [a, b] = await Promise.all([
    call('POST', '/bookings', { ...customer, name: 'Racer A', phone: '314-555-0001', input, start }),
    call('POST', '/bookings', { ...customer, name: 'Racer B', phone: '314-555-0002', input, start }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
});

test('bookings refuse made-up times and missing details', async () => {
  const start = await firstSlot();
  const offGrid = new Date(new Date(start).getTime() + 15 * 60_000).toISOString();
  assert.equal((await call('POST', '/bookings', { ...customer, input, start: offGrid })).status, 409);
  assert.equal((await call('POST', '/bookings', { ...customer, input, start: new Date().toISOString() })).status, 409);
  assert.equal((await call('POST', '/bookings', { ...customer, address: '', input, start })).status, 422);
  assert.equal((await call('POST', '/bookings', { ...customer, phone: '', input, start })).status, 422);
});

test('the honeypot books nothing', async () => {
  const before = (await allSlots()).length;
  const r = await call('POST', '/bookings', { ...customer, website: 'x', input, start: await firstSlot() });
  assert.equal(r.status, 201);
  assert.equal((await allSlots()).length, before);
});

test('jobs and customers: the booking shows up for Jacob, and repeat customers match', async () => {
  const jobs = (await call('GET', `/jobs?to=${new Date(Date.now() + 40 * 864e5).toISOString()}`, undefined, admin)).body.jobs;
  const mine = jobs.filter((j: any) => j.customer.name === 'Pat Booker');
  assert.ok(mine.length >= 1);
  assert.equal(mine[0].source, 'web');
  assert.equal(mine[0].address, customer.address);

  // Same phone, different formatting: one customer, not two.
  const start = await firstSlot();
  const repeat = await call('POST', '/bookings', { ...customer, name: 'P. Booker', phone: '+1 314 555 0142', input, start });
  assert.equal(repeat.status, 201);
  const found = (await call('GET', '/customers?q=5550142', undefined, admin)).body.customers;
  assert.equal(found.length, 1);
  assert.equal(found[0].name, 'Pat Booker', 'stored name is kept');
  const detail = (await call('GET', `/customers/${found[0].id}`, undefined, admin)).body;
  assert.ok(detail.jobs.length >= 2);
});

test('Jacob can add a clashing job by hand, and is warned', async () => {
  const jobs = (await call('GET', `/jobs?to=${new Date(Date.now() + 40 * 864e5).toISOString()}`, undefined, admin)).body.jobs;
  const existing = jobs.find((j: any) => j.status === 'scheduled');
  const r = await call(
    'POST',
    '/jobs',
    { customer: { name: 'Walk-in', phone: '314-555-0777' }, address: '1 Main St', input, start: existing.start },
    admin,
  );
  assert.equal(r.status, 201);
  assert.equal(r.body.job.source, 'app');
  assert.ok(r.body.warnings.some((w: string) => /overlaps/.test(w)));

  // Reschedule keeps the length; cancelling frees the time.
  const moved = await call('PATCH', `/jobs/${r.body.job.id}`, { start: new Date(Date.now() + 60 * 864e5).toISOString() }, admin);
  assert.equal(moved.status, 200);
  assert.equal(new Date(moved.body.end).getTime() - new Date(moved.body.start).getTime(), 180 * 60_000);
  const done = await call('PATCH', `/jobs/${r.body.job.id}`, { status: 'done', finalPrice: 16000 }, admin);
  assert.equal(done.body.status, 'done');
  assert.equal(done.body.finalPrice, 16000);
  assert.equal((await call('PATCH', `/jobs/${r.body.job.id}`, { status: 'paid' }, admin)).status, 422);
});

test('time off removes slots until it is deleted', async () => {
  const start = await firstSlot();
  const off = await call(
    'POST',
    '/time-off',
    { start, end: new Date(new Date(start).getTime() + 12 * 3_600_000).toISOString(), reason: 'Dentist' },
    admin,
  );
  assert.equal(off.status, 201);
  assert.ok(!(await allSlots()).includes(start));
  assert.equal((await call('DELETE', `/time-off/${off.body.id}`, undefined, admin)).status, 204);
  assert.ok((await allSlots()).includes(start));
});

test('booking rules: validated, saved, and switching booking off stops it', async () => {
  const got = await call('GET', '/settings/booking', undefined, admin);
  assert.deepEqual(got.body.rules, defaultRules);

  const bad = await call('PUT', '/settings/booking', { ...defaultRules, maxJobsPerDay: 0 }, admin);
  assert.equal(bad.status, 422);
  assert.ok(bad.body.error.details.length);

  assert.equal((await call('PUT', '/settings/booking', { ...defaultRules, onlineBooking: false }, admin)).status, 200);
  const closed = await slots();
  assert.equal(closed.bookable, false);
  assert.equal((await call('POST', '/bookings', { ...customer, input, start: new Date().toISOString() })).body.error.code, 'not_bookable');

  assert.equal((await call('PUT', '/settings/booking', defaultRules, admin)).status, 200);
  assert.equal((await slots()).bookable, true);
});

test('owner booking endpoints refuse strangers', async () => {
  for (const [m, p] of [['GET', '/jobs'], ['GET', '/customers'], ['GET', '/time-off'], ['GET', '/settings/booking']] as const) {
    assert.equal((await call(m, p)).status, 401, p);
  }
});
