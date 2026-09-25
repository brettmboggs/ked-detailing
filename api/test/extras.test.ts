import { test } from 'node:test';
import assert from 'node:assert/strict';

// Run through `npm test`, which starts a local Worker with an empty D1.
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
const pub = (method: string, path: string, body?: unknown) => call(method, path, body, {});

let phone = 100;

/** A job in this suite's own year (2035), with its own phone so customers don't merge. */
async function job(name: string, start: string) {
  const res = await call('POST', '/jobs', {
    customer: { name, phone: `636-555-0${phone++}` },
    address: '4 Elm St',
    vehicle: '2019 Tahoe',
    input: { service: 'level-1', vehicleClass: 'sedan' },
    start,
  });
  assert.equal(res.status, 201);
  return res.body.job;
}

const tokenOf = (url: string) => new URL(url).searchParams.get('a')!;
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array(60).fill(3)]);

test('offer from the price list or by hand, send a link, and the customer says yes and no', async () => {
  const j = await job('Morgan Reyes', '2035-04-01T15:00:00.000Z');

  const listed = await call('GET', `/jobs/${j.id}/extras`);
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.extras, []);
  assert.equal(listed.body.url, null);
  const suggestion = listed.body.suggestions[0];
  assert.ok(suggestion?.id && suggestion.amount > 0, 'the price list offers something for a level-1 sedan');

  // A photo of what he found, and an add-on from the price list with it.
  const photo = await fetch(`${API}/v1/photos?kind=job&jobId=${j.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', ...auth },
    body: jpeg,
  }).then((r) => r.json());
  const fromList = await call('POST', `/jobs/${j.id}/extras`, { addOnId: suggestion.id, note: 'Headlights are cloudy.', photoId: photo.id });
  assert.equal(fromList.status, 201);
  assert.equal(fromList.body.amount, suggestion.amount);
  assert.equal(fromList.body.status, 'offered');
  const custom = await call('POST', `/jobs/${j.id}/extras`, { label: 'Tar removal', amount: 3500 });
  assert.equal(custom.status, 201);

  const again = await call('GET', `/jobs/${j.id}/extras`);
  assert.ok(!again.body.suggestions.some((s: { id: string }) => s.id === suggestion.id), 'an offered add-on is not suggested twice');

  const sent = await call('POST', `/jobs/${j.id}/extras/send`);
  assert.equal(sent.status, 200);
  assert.match(sent.body.url, /\/approve\/\?a=[A-Za-z0-9_-]{43}$/);
  assert.match(sent.body.message, /^Hi Morgan, Jacob here\. While working on your 2019 Tahoe/);
  assert.ok(sent.body.message.includes('$35') && sent.body.message.includes(sent.body.url));
  const token = tokenOf(sent.body.url);
  assert.equal((await call('POST', `/jobs/${j.id}/extras/send`)).body.url, sent.body.url, 'sending again keeps the same link');

  // The customer's page: first name, both add-ons, the photo through the link.
  const page = await pub('GET', `/approve/${token}`);
  assert.equal(page.status, 200);
  assert.equal(page.body.customerName, 'Morgan');
  assert.equal(page.body.extras.length, 2);
  const shown = page.body.extras.find((e: { id: string }) => e.id === fromList.body.id);
  assert.equal(shown.note, 'Headlights are cloudy.');
  const img = await fetch(`${API}${shown.photo}`);
  assert.equal(img.status, 200);
  assert.deepEqual(new Uint8Array(await img.arrayBuffer()), jpeg);
  assert.equal((await fetch(`${API}/v1/photos/${photo.id}`)).status, 401, 'the regular photo URL stays owner-only');

  const yes = await pub('POST', `/approve/${token}/${fromList.body.id}`, { yes: true });
  assert.equal(yes.status, 200);
  assert.equal(yes.body.extras.find((e: { id: string }) => e.id === fromList.body.id).status, 'approved');
  assert.equal((await pub('POST', `/approve/${token}/${fromList.body.id}`, { yes: false })).status, 409, 'an answer is final');
  const no = await pub('POST', `/approve/${token}/${custom.body.id}`, { yes: false });
  assert.equal(no.body.extras.find((e: { id: string }) => e.id === custom.body.id).status, 'declined');

  // The invoice has the yes and not the no.
  const inv = (await call('POST', `/jobs/${j.id}/invoice`)).body;
  assert.deepEqual(inv.lines.at(-1), { label: fromList.body.label, amount: suggestion.amount });
  assert.ok(!inv.lines.some((l: { label: string }) => l.label === 'Tar removal'));
  assert.equal(inv.total, j.quote.total + suggestion.amount);
});

test('a yes after the invoice exists adds a line to it and raises the settled price', async () => {
  const j = await job('Sam Patel', '2035-04-02T15:00:00.000Z');
  await call('PATCH', `/jobs/${j.id}`, { finalPrice: j.quote.total - 1000 });
  const inv = (await call('POST', `/jobs/${j.id}/invoice`)).body;
  assert.equal(inv.total, j.quote.total - 1000);

  const extra = (await call('POST', `/jobs/${j.id}/extras`, { label: 'Pet hair', amount: 4000 })).body;
  // He tells Jacob in person.
  const marked = await call('PATCH', `/extras/${extra.id}`, { status: 'approved' });
  assert.equal(marked.status, 200);
  assert.equal(marked.body.decidedBy, 'owner');

  const after = (await call('GET', `/invoices/${inv.id}`)).body;
  assert.deepEqual(after.lines.at(-1), { label: 'Pet hair', amount: 4000 });
  assert.equal(after.total, inv.total + 4000);
  assert.equal((await call('GET', `/jobs/${j.id}`)).body.finalPrice, inv.total + 4000);
});

test('with a settled price and no invoice yet, the add-on is its own line, not an adjustment', async () => {
  const j = await job('Alex Kim', '2035-04-03T15:00:00.000Z');
  await call('PATCH', `/jobs/${j.id}`, { finalPrice: j.quote.total - 2000 });
  const extra = (await call('POST', `/jobs/${j.id}/extras`, { label: 'Engine bay', amount: 5000 })).body;
  await call('PATCH', `/extras/${extra.id}`, { status: 'approved' });
  const inv = (await call('POST', `/jobs/${j.id}/invoice`)).body;
  assert.deepEqual(inv.lines.slice(-2), [{ label: 'Engine bay', amount: 5000 }, { label: 'Discount', amount: -2000 }]);
  assert.equal(inv.total, j.quote.total + 3000);
});

test('taking one back, bad input, and a cancelled job', async () => {
  const j = await job('Jo Brennan', '2035-04-04T15:00:00.000Z');
  const other = await job('Pat Other', '2035-04-05T15:00:00.000Z');
  const extra = (await call('POST', `/jobs/${j.id}/extras`, { label: 'Clay bar', amount: 6000 })).body;
  const token = tokenOf((await call('POST', `/jobs/${j.id}/extras/send`)).body.url);

  assert.equal((await call('PATCH', `/extras/${extra.id}`, { status: 'withdrawn' })).body.status, 'withdrawn');
  assert.equal((await pub('GET', `/approve/${token}`)).body.extras.length, 0, 'a withdrawn add-on disappears from their page');
  assert.equal((await pub('POST', `/approve/${token}/${extra.id}`, { yes: true })).status, 404);
  assert.equal((await call('POST', `/jobs/${j.id}/extras/send`)).status, 409, 'nothing waiting');

  for (const body of [{}, { label: 'X' }, { label: 'X', amount: 0 }, { label: 'X', amount: 12.5 }, { addOnId: 'nope' }]) {
    assert.equal((await call('POST', `/jobs/${j.id}/extras`, body)).status, 422, JSON.stringify(body));
  }
  // A photo from another job can't be attached.
  const theirs = await fetch(`${API}/v1/photos?kind=job&jobId=${other.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', ...auth },
    body: jpeg,
  }).then((r) => r.json());
  assert.equal((await call('POST', `/jobs/${j.id}/extras`, { label: 'X', amount: 100, photoId: theirs.id })).status, 422);

  const later = (await call('POST', `/jobs/${j.id}/extras`, { label: 'Wax', amount: 2000 })).body;
  await call('POST', `/jobs/${j.id}/extras/send`);
  await call('PATCH', `/jobs/${j.id}`, { status: 'cancelled' });
  assert.equal((await pub('GET', `/approve/${token}`)).body.open, false);
  assert.equal((await pub('POST', `/approve/${token}/${later.id}`, { yes: true })).status, 409);
  assert.equal((await call('POST', `/jobs/${j.id}/extras`, { label: 'X', amount: 100 })).status, 409);

  assert.equal((await pub('GET', '/approve/not-a-real-token')).status, 404);
  assert.equal((await call('GET', `/jobs/${j.id}/extras`, undefined, {})).status, 401);
});
