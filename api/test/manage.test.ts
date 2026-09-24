import { test } from 'node:test';
import assert from 'node:assert/strict';

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

const input = { service: 'level-1', vehicleClass: 'sedan' };

/** Open starts on the last few bookable days, so earlier suites' bookings don't crowd these out. */
async function lateSlots() {
  const days = (await call('POST', '/availability', { input })).body.days.filter((d: any) => d.slots.length);
  return days.slice(-4).map((d: any) => d.slots[0] as string);
}

async function book(name: string, phone: string, start: string) {
  const r = await call('POST', '/bookings', { input, start, name, phone, address: '3 Birch Ln', vehicle: '2018 Camry' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}

const tokenOf = (url: string) => new URL(url).searchParams.get('b')!;

test('a booking comes back with its own link, which shows it to the customer', async () => {
  const [start] = await lateSlots();
  const b = await book('Morgan Mover', '314-555-0601', start!);
  assert.match(b.manageUrl, /\/booking\/\?b=[A-Za-z0-9_-]{43}$/);
  assert.equal(b.manageToken, undefined, 'the raw token only travels inside the URL');

  const view = await call('GET', `/manage/${tokenOf(b.manageUrl)}`);
  assert.equal(view.status, 200);
  assert.equal(view.body.status, 'scheduled');
  assert.equal(view.body.customerName, 'Morgan');
  assert.equal(view.body.start, start);
  assert.equal(view.body.canChange, true);
  assert.equal(view.body.locked, null);
  assert.ok(Array.isArray(view.body.estimate));
  assert.ok(!JSON.stringify(view.body).includes('555-0601'), 'no phone on the customer copy');
});

test('moving: its own time counts as free, a taken time is refused, and the job moves', async () => {
  const [mine, other, target] = (await lateSlots()).slice(-3);
  const b = await book('Riley Resched', '314-555-0602', mine!);
  await book('Someone Else', '314-555-0603', other!);
  const token = tokenOf(b.manageUrl);

  const open = (await call('GET', `/manage/${token}/availability`)).body;
  const starts = open.days.flatMap((d: any) => d.slots);
  assert.ok(starts.includes(mine), 'its own time is offered');
  assert.ok(!starts.includes(other), "someone else's time is not");

  const taken = await call('POST', `/manage/${token}/reschedule`, { start: other });
  assert.equal(taken.status, 409);

  const same = await call('POST', `/manage/${token}/reschedule`, { start: mine });
  assert.equal(same.status, 200);

  const moved = await call('POST', `/manage/${token}/reschedule`, { start: target });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.equal(moved.body.start, target);
  assert.equal((await call('GET', `/jobs/${b.id}`, undefined, admin)).body.start, target);
  assert.equal((await call('POST', `/manage/${token}/reschedule`, { start: 'whenever' })).status, 422);
});

test('cancelling frees the time, keeps the reason for Jacob, and locks the link', async () => {
  const slots = await lateSlots();
  const start = slots[0]!;
  const b = await book('Casey Cancel', '314-555-0604', start);
  const token = tokenOf(b.manageUrl);

  const done = await call('POST', `/manage/${token}/cancel`, { reason: 'Car is in the shop' });
  assert.equal(done.status, 200);
  assert.equal(done.body.status, 'cancelled');
  assert.equal(done.body.canChange, false);

  const job = (await call('GET', `/jobs/${b.id}`, undefined, admin)).body;
  assert.equal(job.status, 'cancelled');
  assert.equal(job.cancelledBy, 'customer');
  assert.equal(job.cancelReason, 'Car is in the shop');

  assert.equal((await call('POST', `/manage/${token}/cancel`, {})).status, 409);
  assert.equal((await call('POST', `/manage/${token}/reschedule`, { start })).status, 409);
  const again = (await call('POST', '/availability', { input })).body.days.flatMap((d: any) => d.slots);
  assert.ok(again.includes(start), 'the time is open again');
});

test('inside the notice window the link only shows the booking', async () => {
  const soon = new Date(Date.now() + 2 * 36e5);
  soon.setUTCMinutes(0, 0, 0);
  const job = await call('POST', '/jobs', {
    customer: { name: 'Sam Soon', phone: '314-555-0605' }, address: '4 Birch', input, start: soon.toISOString(),
  }, admin);
  const text = await call('POST', `/jobs/${job.body.job.id}/confirmation`, undefined, admin);
  assert.equal(text.status, 200);
  assert.match(text.body.message, /^Hi Sam, this is Jacob/);
  assert.ok(text.body.message.endsWith(text.body.url));

  const token = tokenOf(text.body.url);
  const view = (await call('GET', `/manage/${token}`)).body;
  assert.equal(view.canChange, false);
  assert.match(view.locked, /too close/);
  assert.equal((await call('GET', `/manage/${token}/availability`)).body.days.length, 0);
  assert.equal((await call('POST', `/manage/${token}/cancel`, {})).status, 409);

  // Jacob cancelling is recorded as his.
  await call('PATCH', `/jobs/${job.body.job.id}`, { status: 'cancelled' }, admin);
  assert.equal((await call('GET', `/jobs/${job.body.job.id}`, undefined, admin)).body.cancelledBy, 'owner');
});

test('bad links and strangers', async () => {
  assert.equal((await call('GET', '/manage/nope')).status, 404);
  assert.equal((await call('GET', `/manage/${'A'.repeat(43)}`)).status, 404);
  assert.equal((await call('POST', '/jobs/whatever/confirmation')).status, 401);
});
