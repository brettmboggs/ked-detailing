import { test } from 'node:test';
import assert from 'node:assert/strict';

const API = process.env.API!;
const auth = { Authorization: `Bearer ${process.env.ADMIN_TOKEN}` };

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array(60).fill(9)]);
const heic = new Uint8Array([0, 0, 0, 24, ...[...'ftypheic'].map((c) => c.charCodeAt(0)), ...Array(40).fill(1)]);

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = auth) {
  const res = await fetch(`${API}/v1${path}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const raw = await res.text();
  return { status: res.status, headers: res.headers, body: raw ? JSON.parse(raw) : null };
}
async function upload(bytes: Uint8Array, headers: Record<string, string> = auth) {
  const res = await fetch(`${API}/v1/site/photos`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...headers }, body: bytes });
  return { status: res.status, body: (await res.json()) as any };
}

test('site: nothing saved is an empty document, public and cached briefly', async () => {
  const res = await call('GET', '/site', undefined, {});
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control') ?? '', /max-age=60/);
  // Another suite may have saved by now only if it runs after this one; this suite owns the key.
  assert.deepEqual(Object.keys(res.body).sort(), ['content', 'updatedAt']);
});

test('site: only the owner can save', async () => {
  assert.equal((await call('PUT', '/site', { intro: 'Hi' }, {})).status, 401);
  assert.equal((await upload(jpeg, {})).status, 401);
});

test('site: strict validation, with every problem listed', async () => {
  const bad = await call('PUT', '/site', {
    hero: { headline: ['One', 'Two'], sub: '<b>bold</b>', extra: 'x' },
    intro: '',
    contact: { phone: '555-1234', email: 'nope', instagram: 'https://evil.example/x', facebook: 'http://facebook.com/k' },
    reviews: { rating: '6', count: -1, list: [] },
    packages: { 'level-9': {}, 'level-1': { includes: [], photo: '../../etc/passwd' } },
    faqs: [{ q: 'Why?', a: 'x'.repeat(801) }],
    marquee: ['Porsche'],
    recent: [{ photo: '01ARZ3NDEKTSV4RRFFQ69G5FAV', alt: 'Never uploaded' }],
    theme: 'pink',
  });
  assert.equal(bad.status, 422);
  assert.equal(bad.body.error.code, 'invalid_site');
  const details: string[] = bad.body.error.details;
  const has = (re: RegExp) => assert.ok(details.some((d) => re.test(d)), `expected ${re} in ${JSON.stringify(details, null, 1)}`);
  has(/"theme" isn't/);
  has(/Top of the page: "extra"/);
  has(/headline needs at least 3/);
  has(/< and >/);
  has(/About paragraph can't be empty/);
  has(/Phone number needs 10 digits/);
  has(/Email doesn't look/);
  has(/Instagram link must be a instagram.com link/);
  has(/Facebook link must start with https/);
  has(/Star rating/);
  has(/Number of reviews/);
  has(/Reviews needs at least 1/);
  has(/"level-9"/);
  has(/Level I: what's included needs at least 1/);
  has(/Level I: photo isn't a photo/);
  has(/Question 1: answer is too long/);
  has(/Scrolling names needs at least 3/);
  has(/didn't finish uploading/);

  // Nothing was stored.
  assert.equal((await call('GET', '/site')).body.updatedAt, null);
});

test('site: a save keeps known fields, tidies them and rebuilds', async () => {
  const saved = await call('PUT', '/site', {
    hero: { headline: ['Clean', 'Cars', 'Only.'], sub: '  We come to you.  ' },
    contact: { phone: '1-314-555-0199', email: 'Jacob@Example.com', instagram: 'https://instagram.com/ked/' },
    packages: { 'level-2': { name: 'The Reset', includes: ['Wash', 'Vacuum'], photo: 'van-logo.jpg' } },
    faqs: [{ q: 'Do you come to me?', a: 'Yes.' }],
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.content.hero.sub, 'We come to you.');
  assert.equal(saved.body.content.contact.phone, '(314) 555-0199');
  assert.equal(saved.body.content.contact.email, 'jacob@example.com');
  assert.equal(saved.body.content.contact.instagram, 'https://instagram.com/ked/');
  assert.ok(saved.body.updatedAt);

  const pub = await call('GET', '/site', undefined, {});
  assert.deepEqual(pub.body.content, saved.body.content);
  assert.equal(pub.body.updatedAt, saved.body.updatedAt);
  assert.equal(Number(pub.headers.get('x-d1-queries')), 1);
});

test('site photos: upload checks, and served publicly only while the site uses them', async () => {
  assert.equal((await upload(heic)).status, 415, 'HEIC is converted in the browser first');
  assert.equal((await upload(new Uint8Array())).status, 422);
  assert.equal((await upload(new Uint8Array(5 * 1024 * 1024 + 1).fill(0xff))).status, 413);

  const up = await upload(jpeg);
  assert.equal(up.status, 201);
  assert.equal(up.body.contentType, 'image/jpeg');
  assert.equal(up.body.url, `/v1/site/photos/${up.body.id}`);

  // Uploaded but not on the site: not public.
  assert.equal((await fetch(`${API}${up.body.url}`)).status, 404);

  const saved = await call('PUT', '/site', { recent: [{ photo: up.body.id, alt: 'Fresh wax on a black truck' }, { photo: 'rivian-r1s.jpg', alt: 'Rivian' }] });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));

  const img = await fetch(`${API}${up.body.url}`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
  assert.match(img.headers.get('cache-control') ?? '', /immutable/);
  assert.deepEqual(new Uint8Array(await img.arrayBuffer()), jpeg);

  // Taken off the site: no longer public.
  await call('PUT', '/site', {});
  assert.equal((await fetch(`${API}${up.body.url}`)).status, 404);
});

test('site photos: job photos and receipts can never come out of the public route', async () => {
  const receipt = await fetch(`${API}/v1/photos?kind=receipt`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...auth }, body: jpeg });
  const { id } = (await receipt.json()) as { id: string };
  assert.equal((await fetch(`${API}/v1/site/photos/${id}`)).status, 404);
  // Even if the site document names it, the id isn't a site upload, so the save is refused.
  const refused = await call('PUT', '/site', { recent: [{ photo: id, alt: 'A receipt' }] });
  assert.equal(refused.status, 422);
  assert.equal((await fetch(`${API}/v1/site/photos/${id}`)).status, 404);
  assert.equal((await fetch(`${API}/v1/site/photos/..%2F..%2Freceipts`)).status, 404);
});
