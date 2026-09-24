import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

// Run through `npm test`. The Worker's EXPO_PUSH_URL points at this fake Expo.
const API = process.env.API!;
const auth = { Authorization: `Bearer ${process.env.ADMIN_TOKEN}` };

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = auth) {
  const res = await fetch(`${API}/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await res.text();
  return { status: res.status, body: raw ? JSON.parse(raw) : null };
}

/** Pushes Expo received, in order. A token ending in "gone]" is uninstalled. */
const received: { to: string; title: string; body: string; data: { type: string; id: string } }[][] = [];
const expo = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const batch = JSON.parse(raw);
    received.push(batch);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      data: batch.map((m: any) =>
        m.to.endsWith('gone]') ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok', id: 'x' }),
    }));
  });
});
await new Promise<void>((r) => expo.listen(Number(process.env.PUSH_PORT), r));
after(() => expo.close());

/** Alerts go out after the response, so wait for the one we expect. */
async function alertFor(refId: string) {
  for (let i = 0; i < 40; i++) {
    const found = (await call('GET', '/alerts')).body.alerts.find((a: any) => a.refId === refId);
    if (found && found.pushed + (found.emailed ? 1 : 0) > 0) return found;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail(`no alert delivered for ${refId}`);
}

const PHONE = 'ExponentPushToken[jacob-phone]';
const OLD = 'ExponentPushToken[old-phone-gone]';

test('phones register, and a bad token is refused', async () => {
  assert.equal((await call('POST', '/devices', { token: PHONE })).status, 201);
  assert.equal((await call('POST', '/devices', { token: PHONE })).status, 201, 'registering again is fine');
  assert.equal((await call('POST', '/devices', { token: OLD })).status, 201);
  assert.equal((await call('POST', '/devices', { token: 'not-a-token' })).status, 422);
  assert.equal((await call('POST', '/devices', { token: PHONE }, {})).status, 401);
});

test('a website booking pushes to his phones, and an uninstalled phone is dropped', async () => {
  const input = { service: 'level-1', vehicleClass: 'sedan' };
  const slots = (await call('POST', '/availability', { input }, {})).body.days.flatMap((d: any) => d.slots);
  const booked = await call('POST', '/bookings', {
    input, start: slots.at(-1), name: 'Alex Alert', phone: '(314) 555-0321', address: '5 Pine Ct', vehicle: '2020 Civic',
  }, {});
  assert.equal(booked.status, 201);

  const a = await alertFor(booked.body.id);
  assert.equal(a.type, 'booking');
  assert.equal(a.title, 'New booking: Alex Alert');
  assert.equal(a.pushed, 1, 'one phone took it');
  const batch = received.at(-1)!;
  assert.deepEqual(batch.map((m) => m.to).sort(), [OLD, PHONE].sort());
  assert.deepEqual(batch[0]!.data, { type: 'booking', id: booked.body.id }, 'a tap opens the job');

  // The next alert skips the phone Expo said is gone.
  const lead = await call('POST', '/leads', {
    name: 'Lee Lead', phone: '(314) 555-0322', zip: '63049', input: { service: 'level-2', vehicleClass: 'large' },
  }, {});
  assert.equal(lead.status, 201);
  const l = await alertFor(lead.body.id);
  assert.equal(l.title, 'Quote request: Lee Lead');
  assert.deepEqual(received.at(-1)!.map((m) => m.to), [PHONE]);
});

test('the honeypot alerts nobody', async () => {
  const before = received.length;
  await call('POST', '/leads', { name: 'Bot', phone: '1', input: { service: 'level-1', vehicleClass: 'sedan' }, website: 'spam.example' }, {});
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(received.length, before);
});

test('the first time a customer opens an invoice, Jacob hears about it once', async () => {
  const job = await call('POST', '/jobs', {
    customer: { name: 'Olive Opener', phone: '314-555-0323' }, address: '8 Ash', start: '2036-02-01T15:00:00.000Z',
    input: { service: 'level-1', vehicleClass: 'sedan' },
  });
  const inv = (await call('POST', `/jobs/${job.body.job.id}/invoice`)).body;
  const token = new URL(inv.payUrl).searchParams.get('i');
  await call('GET', `/pay/${token}`, undefined, {});
  const a = await alertFor(inv.id);
  assert.equal(a.title, `Olive Opener opened invoice ${inv.number}`);

  const before = received.length;
  await call('GET', `/pay/${token}`, undefined, {});
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(received.length, before, 'only the first open');
});

test('signing out stops the pushes', async () => {
  assert.equal((await call('DELETE', '/devices', { token: PHONE })).status, 204);
  const job = await call('POST', '/jobs', {
    customer: { name: 'Quiet Customer', phone: '314-555-0324' }, address: '9 Ash', start: '2036-02-02T15:00:00.000Z',
    input: { service: 'level-1', vehicleClass: 'sedan' },
  });
  const inv = (await call('POST', `/jobs/${job.body.job.id}/invoice`)).body;
  const before = received.length;
  await call('GET', `/pay/${new URL(inv.payUrl).searchParams.get('i')}`, undefined, {});
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(received.length, before, 'no phones, no push');
  // Still recorded, so the app can show it.
  assert.ok((await call('GET', '/alerts')).body.alerts.some((a: any) => a.refId === inv.id));
});
