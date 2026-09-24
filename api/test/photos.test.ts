import { test } from 'node:test';
import assert from 'node:assert/strict';

const API = process.env.API!;
const auth = { Authorization: `Bearer ${process.env.ADMIN_TOKEN}` };

// Smallest bytes that pass the image check; the storage doesn't decode them.
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array(60).fill(7)]);
const heic = new Uint8Array([0, 0, 0, 24, ...[...'ftypheic'].map((c) => c.charCodeAt(0)), ...Array(40).fill(1)]);
const notImage = new TextEncoder().encode('%PDF-1.7 definitely not a photo');

async function upload(query: string, bytes: Uint8Array, headers: Record<string, string> = auth) {
  const res = await fetch(`${API}/v1/photos?${query}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...headers }, body: bytes });
  return { status: res.status, body: (await res.json()) as any };
}
async function json(method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}/v1${path}`, { method, headers: { 'Content-Type': 'application/json', ...auth }, body: body && JSON.stringify(body) });
  const raw = await res.text();
  return { status: res.status, body: raw ? JSON.parse(raw) : null };
}

test('receipts: upload, fetch back byte for byte, attach to an expense, and then they are kept', async () => {
  const up = await upload('kind=receipt', jpeg);
  assert.equal(up.status, 201);
  assert.equal(up.body.contentType, 'image/jpeg');

  const img = await fetch(`${API}${up.body.url}`, { headers: auth });
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(new Uint8Array(await img.arrayBuffer()), jpeg);
  assert.equal((await fetch(`${API}${up.body.url}`)).status, 401, 'owner only');

  const spent = await json('POST', '/books/expenses', {
    date: '2032-01-05', amount: 4200, categoryId: 'supplies', paidFromId: 'checking', receiptKey: up.body.id,
  });
  assert.equal(spent.status, 201);
  assert.equal(spent.body.receiptKey, up.body.id);
  assert.equal((await json('DELETE', `/photos/${up.body.id}`)).status, 409, 'receipts in the books are kept');

  // Attaching after the fact.
  const later = await upload('kind=receipt', heic);
  assert.equal(later.body.contentType, 'image/heic');
  const noReceipt = await json('POST', '/books/expenses', { date: '2032-01-06', amount: 900, categoryId: 'meals', paidFromId: 'cash' });
  const attached = await json('POST', `/books/entries/${noReceipt.body.id}/receipt`, { photoId: later.body.id });
  assert.equal(attached.body.receiptKey, later.body.id);
  assert.equal((await json('POST', '/books/expenses', { date: '2032-01-06', amount: 900, categoryId: 'meals', paidFromId: 'cash', receiptKey: 'nope' })).status, 422);
});

test('job photos: before and after, listed per job, deletable', async () => {
  const job = await json('POST', '/jobs', {
    customer: { name: 'Photo Customer', phone: '314-555-0400' }, address: '2 Lake Rd',
    input: { service: 'level-1', vehicleClass: 'sedan' }, start: '2032-02-01T15:00:00.000Z',
  });
  assert.equal(job.status, 201);
  const id = job.body.job.id;
  const before = await upload(`kind=job&jobId=${id}&stage=before`, jpeg);
  const after = await upload(`kind=job&jobId=${id}&stage=after&caption=Hood`, jpeg);
  assert.equal(before.status, 201);
  const list = (await json('GET', `/jobs/${id}/photos`)).body.photos;
  assert.deepEqual(list.map((p: any) => p.stage), ['before', 'after']);
  assert.equal(list[1].caption, 'Hood');
  assert.equal((await json('DELETE', `/photos/${after.body.id}`)).status, 204);
  assert.equal((await fetch(`${API}${after.body.url}`, { headers: auth })).status, 404);
});

test('uploads refuse non-images, empty bodies, bad kinds and strangers', async () => {
  assert.equal((await upload('kind=receipt', notImage)).status, 415);
  assert.equal((await upload('kind=receipt', new Uint8Array())).status, 422);
  assert.equal((await upload('kind=selfie', jpeg)).status, 422);
  assert.equal((await upload('kind=job', jpeg)).status, 422, 'job photos need a job');
  assert.equal((await upload('kind=receipt', jpeg, {})).status, 401);
});
