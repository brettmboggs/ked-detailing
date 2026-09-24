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

const item = async (body: Record<string, unknown>) => {
  const res = await call('POST', '/inventory', body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
};

test('items: a starting count, a barcode found either way it is scanned, and no two items share one', async () => {
  const soap = await item({ name: 'Car soap', unit: 'gal', barcode: '012345678905', onHand: 2, reorderAt: 1, cost: 2499 });
  assert.equal(soap.barcode, '0012345678905', 'UPC-A kept in its 13-digit form');
  assert.equal(soap.onHand, 2);
  assert.equal(soap.low, false);

  assert.equal((await call('GET', '/inventory/barcode/012345678905')).body.id, soap.id);
  assert.equal((await call('GET', '/inventory/barcode/0012345678905')).body.id, soap.id);
  assert.equal((await call('GET', '/inventory/barcode/999')).status, 404);

  const dupe = await call('POST', '/inventory', { name: 'Other soap', unit: 'gal', barcode: '0012345678905' });
  assert.equal(dupe.status, 409);
  assert.equal(dupe.body.error.code, 'barcode_taken');

  const history = (await call('GET', `/inventory/${soap.id}/movements`)).body.movements;
  assert.deepEqual(history.map((m: any) => [m.reason, m.delta, m.note]), [['adjust', 2, 'Starting count']]);

  assert.equal((await call('POST', '/inventory', { unit: 'gal' })).status, 422);
  assert.equal((await call('POST', '/inventory', { name: 'X', reorderUrl: 'javascript:alert(1)' })).status, 422);
  assert.equal((await call('PATCH', `/inventory/${soap.id}`, { onHand: 9 })).status, 422, 'counts only move through movements');
});

test('movements: restock and use by sign, a shelf count, fractions that stay exact, and low stock', async () => {
  const wax = await item({ name: 'Spray wax', unit: 'bottle', onHand: 3, reorderAt: 2 });

  let after = await call('POST', `/inventory/${wax.id}/movements`, { reason: 'used', delta: 2 });
  assert.equal(after.body.onHand, 1, 'used always takes away');
  assert.equal(after.body.low, true);

  after = await call('POST', `/inventory/${wax.id}/movements`, { reason: 'restock', delta: -6, unitCost: 1299 });
  assert.equal(after.body.onHand, 7, 'restock always adds');
  assert.equal(after.body.cost, 1299);

  after = await call('POST', `/inventory/${wax.id}/movements`, { reason: 'adjust', count: 5 });
  assert.equal(after.body.onHand, 5);

  for (let i = 0; i < 3; i++) await call('POST', `/inventory/${wax.id}/movements`, { reason: 'used', delta: 0.1 });
  assert.equal((await call('GET', `/inventory/${wax.id}`)).body.onHand, 4.7, 'no float drift');

  const history = (await call('GET', `/inventory/${wax.id}/movements`)).body.movements;
  assert.equal(history[0].onHand, 4.7, 'each line keeps the count it left');

  // Two taps at once both land.
  await Promise.all([1, 2].map(() => call('POST', `/inventory/${wax.id}/movements`, { reason: 'restock', delta: 1 })));
  assert.equal((await call('GET', `/inventory/${wax.id}`)).body.onHand, 6.7);

  await call('POST', `/inventory/${wax.id}/movements`, { reason: 'used', delta: 5 });
  const low = (await call('GET', '/inventory?low=true')).body;
  assert.ok(low.items.some((i: any) => i.id === wax.id));
  assert.ok(low.items.every((i: any) => i.low));
  assert.equal(low.lowCount, low.items.length);
  const all = (await call('GET', '/inventory')).body.items;
  assert.equal(all[0].low, true, 'low items come first');

  for (const bad of [{ reason: 'stolen', delta: 1 }, { reason: 'used', delta: 0 }, { reason: 'used', count: 3 }, { reason: 'adjust', count: -1 }]) {
    assert.equal((await call('POST', `/inventory/${wax.id}/movements`, bad)).status, 422, JSON.stringify(bad));
  }
});

test('archiving hides an item from the list but keeps it findable by barcode', async () => {
  const pads = await item({ name: 'Old pads', unit: 'pack', barcode: 'PADS-1' });
  await call('PATCH', `/inventory/${pads.id}`, { archived: true });
  assert.ok(!(await call('GET', '/inventory')).body.items.some((i: any) => i.id === pads.id));
  assert.ok((await call('GET', '/inventory?archived=true')).body.items.some((i: any) => i.id === pads.id));
  assert.equal((await call('GET', '/inventory/barcode/PADS-1')).body.archived, true);
});

test('job usage: pre-filled from the package, saved as differences, and costed', async () => {
  const shampoo = await item({ name: 'Upholstery shampoo', unit: 'oz', onHand: 100, cost: 20 });
  const towels = await item({ name: 'Towels', unit: 'each', onHand: 50, cost: 150 });
  assert.equal((await call('PUT', '/inventory/usage/level-1', { items: [{ itemId: shampoo.id, amount: 8 }, { itemId: towels.id, amount: 4 }] })).status, 200);
  assert.equal((await call('PUT', '/inventory/usage/not-a-package', { items: [] })).status, 404);
  assert.equal((await call('PUT', '/inventory/usage/level-1', { items: [{ itemId: 'nope', amount: 1 }] })).status, 422);

  const job = await call('POST', '/jobs', {
    customer: { name: 'Usage Customer', phone: '314-555-0900' }, address: '1 Elm', start: '2035-01-10T15:00:00.000Z',
    input: { service: 'level-1', vehicleClass: 'sedan' },
  });
  const jobId = job.body.job.id;

  const before = (await call('GET', `/jobs/${jobId}/usage`)).body;
  assert.deepEqual(before.used, []);
  assert.deepEqual(before.suggested.map((s: any) => [s.name, s.amount]), [['Towels', 4], ['Upholstery shampoo', 8]]);

  const saved = (await call('PUT', `/jobs/${jobId}/usage`, { items: [{ itemId: shampoo.id, amount: 10 }, { itemId: towels.id, amount: 4 }] })).body;
  assert.deepEqual(saved.suggested, [], 'no suggestion once something is recorded');
  assert.equal(saved.productCost, 10 * 20 + 4 * 150);
  assert.equal((await call('GET', `/inventory/${shampoo.id}`)).body.onHand, 90);

  // Same list again: nothing moves. Drop the towels: they go back on the shelf.
  await call('PUT', `/jobs/${jobId}/usage`, { items: [{ itemId: shampoo.id, amount: 10 }, { itemId: towels.id, amount: 4 }] });
  assert.equal((await call('GET', `/inventory/${towels.id}/movements`)).body.movements.length, 2);
  const fixed = (await call('PUT', `/jobs/${jobId}/usage`, { items: [{ itemId: shampoo.id, amount: 6 }] })).body;
  assert.deepEqual(fixed.used.map((u: any) => [u.name, u.amount]), [['Upholstery shampoo', 6]]);
  assert.equal((await call('GET', `/inventory/${shampoo.id}`)).body.onHand, 94);
  assert.equal((await call('GET', `/inventory/${towels.id}`)).body.onHand, 50);

  assert.equal((await call('PUT', `/jobs/${jobId}/usage`, { items: [{ itemId: shampoo.id, amount: 1 }, { itemId: shampoo.id, amount: 2 }] })).status, 422);
});

test('inventory is owner-only', async () => {
  assert.equal((await call('GET', '/inventory', undefined, {})).status, 401);
  assert.equal((await call('GET', '/inventory/barcode/123', undefined, {})).status, 401);
  assert.equal((await call('GET', '/inventory/usage', undefined, {})).status, 401);
});
