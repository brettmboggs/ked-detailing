import { test } from 'node:test';
import assert from 'node:assert/strict';

const API = process.env.API!;
const auth = { Authorization: `Bearer ${process.env.ADMIN_TOKEN}` };
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(40).fill(3)]);

const upload = (body: Uint8Array, headers: Record<string, string> = auth) =>
  fetch(`${API}/v1/print-files`, { method: 'POST', headers: { 'Content-Type': 'image/png', ...headers }, body });

test('print files: owner uploads a PNG, anyone with the address can fetch it', async () => {
  const res = await upload(png);
  assert.equal(res.status, 201);
  const { url } = (await res.json()) as { url: string };
  assert.match(url, /^\/v1\/print-files\/[A-Za-z0-9_-]{40,}\.png$/);

  const got = await fetch(`${API}${url}`);
  assert.equal(got.status, 200, 'no sign-in: the print shop fetches it');
  assert.equal(got.headers.get('content-type'), 'image/png');
  assert.deepEqual(new Uint8Array(await got.arrayBuffer()), png);

  assert.equal((await fetch(`${API}/v1/print-files/nope.png`)).status, 404);
  assert.equal((await fetch(`${API}/v1/print-files/AAAAAAAAAAAAAAAAAAAAAAAA.png`)).status, 404);
});

test('print files: owner only, PNG only', async () => {
  assert.equal((await upload(png, {})).status, 401);
  assert.equal((await upload(new TextEncoder().encode('%PDF-1.7'))).status, 422);
  assert.equal((await upload(new Uint8Array())).status, 422);
});
