import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

// After-care (api/src/care.ts, weather.ts): the rain nudge against a fake
// National Weather Service, the done page, coating certificates, stickers and
// coating upkeep reminders. Other suites share the database, so everything
// here is found by its own customer.
const API = process.env.API!;
const admin = { Authorization: `Bearer ${process.env.ADMIN_TOKEN}` };

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = admin) {
  const res = await fetch(`${API}/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await res.text();
  return { status: res.status, body: (t ? JSON.parse(t) : null) as any };
}

/** Fake weather: every hour has `chance`% rain. Counts point lookups. */
let chance = 80;
let pointLookups = 0;
const weather = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/geo+json');
  if (req.url!.startsWith('/points/')) {
    pointLookups++;
    return res.end(JSON.stringify({ properties: { forecastHourly: 'https://api.weather.gov/gridpoints/LSX/90,70/forecast/hourly' } }));
  }
  const start = Math.floor(Date.now() / 36e5) * 36e5;
  const periods = Array.from({ length: 96 }, (_, i) => ({
    startTime: new Date(start + i * 36e5).toISOString(),
    endTime: new Date(start + (i + 1) * 36e5).toISOString(),
    probabilityOfPrecipitation: { value: chance },
    shortForecast: 'Showers',
  }));
  res.end(JSON.stringify({ properties: { periods } }));
});
await new Promise<void>((r) => weather.listen(Number(process.env.WEATHER_PORT), r));

const mail: { to: string[]; subject: string; text: string; html: string }[] = [];
const resend = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    mail.push(JSON.parse(raw));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ id: `re_${mail.length}` }));
  });
});
await new Promise<void>((r) => resend.listen(Number(process.env.RESEND_PORT), r));
after(() => (weather.close(), resend.close()));

let n = 0;
async function job(name: string, start: string, extra: Record<string, unknown> = {}) {
  const r = await call('POST', '/jobs', {
    customer: { name, phone: `314-555-6${String(n++).padStart(3, '0')}`, ...extra },
    address: '5 Care Ct, St. Louis MO 63129',
    zip: '63129',
    vehicle: '2021 Tacoma',
    input: { service: 'level-2', vehicleClass: 'sedan' },
    start,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.job;
}

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array(60).fill(9)]);
const upload = (query: string) =>
  fetch(`${API}/v1/photos?${query}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...admin }, body: jpeg }).then((r) =>
    r.json(),
  ) as Promise<any>;

const nudges = async (customerId: string) =>
  ((await call('GET', `/crm/follow-ups?customerId=${customerId}`)).body.followUps as any[]).filter((f) => f.title.startsWith('Rain likely'));

test('rain during a job puts a text on the list, once, and takes it off when it clears', async () => {
  const soon = new Date(Date.now() + 30 * 36e5);
  soon.setUTCMinutes(0, 0, 0);
  const j = await job('Rainy Ray', soon.toISOString());

  chance = 80;
  const first = await call('POST', '/care/run');
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.ok(first.body.weather.atRisk.some((r: any) => r.jobId === j.id));
  let open = (await nudges(j.customer.id)).filter((f) => f.status === 'open');
  assert.equal(open.length, 1);
  assert.match(open[0].title, /\(80%\): Rainy Ray/);
  assert.equal(open[0].channel, 'text');
  assert.ok(open[0].message.includes(`/booking/?b=${j.manageToken}`), 'offers their own reschedule link');
  assert.equal((await call('GET', `/jobs/${j.id}`)).body.start, j.start, 'nothing moved');

  const lookups = pointLookups;
  await call('POST', '/care/run');
  assert.equal((await nudges(j.customer.id)).length, 1, 'not repeated');
  assert.equal(pointLookups, lookups, 'the grid point is remembered');

  chance = 10;
  await call('POST', '/care/run');
  assert.equal((await nudges(j.customer.id)).length, 0, 'cleared up, so it comes off the list');

  chance = 90;
  await call('POST', '/care/run');
  open = (await nudges(j.customer.id)).filter((f) => f.status === 'open');
  assert.equal(open.length, 1, 'and comes back if the rain does');
  chance = 0;
  await call('POST', '/care/run');
});

test('the done page shows the job's own photos, and the thank-you carries it', async () => {
  const j = await job('Photo Phil', '2036-05-04T15:00:00.000Z', { email: 'phil@example.com' });
  await call('PATCH', `/jobs/${j.id}`, { status: 'done', finalPrice: 20000 });
  const before = await upload(`kind=job&jobId=${j.id}&stage=before`);
  const afterPic = await upload(`kind=job&jobId=${j.id}&stage=after`);

  const link = await call('POST', `/jobs/${j.id}/done-link`);
  assert.equal(link.status, 200);
  assert.match(link.body.url, /\/done\/\?d=[A-Za-z0-9_-]{43}$/);
  assert.equal(link.body.photos, 2);
  assert.ok(link.body.message.includes(link.body.url));
  assert.ok(Date.parse(link.body.expiresAt) > Date.now() + 29 * 864e5);

  const token = new URL(link.body.url).searchParams.get('d')!;
  const page = await call('GET', `/done/${token}`, undefined, {});
  assert.equal(page.status, 200);
  assert.equal(page.body.firstName, 'Photo');
  assert.deepEqual(page.body.photos.map((p: any) => p.id).sort(), [before.id, afterPic.id].sort());
  assert.ok(!JSON.stringify(page.body).includes('Care Ct'), 'no address on the public copy');
  const img = await fetch(`${API}/v1/done/${token}/photos/${afterPic.id}`);
  assert.equal(img.status, 200);
  const other = await upload('kind=receipt');
  assert.equal((await fetch(`${API}/v1/done/${token}/photos/${other.id}`)).status, 404, "only this job's photos");
  assert.equal((await call('GET', '/done/not-a-real-token-at-all-but-long-enough-000000', undefined, {})).status, 404);

  // The next day's thank-you links to it; one without photos has no photos line.
  const bare = await job('Bare Bea', '2036-05-04T18:00:00.000Z', { email: 'bea@example.com' });
  await call('PATCH', `/jobs/${bare.id}`, { status: 'done', finalPrice: 20000 });
  const run = await call('POST', '/crm/follow-ups/run', { at: '2036-05-05T15:00:00.000Z' });
  assert.equal(run.status, 200, JSON.stringify(run.body));
  const thanks = (await call('GET', `/crm/follow-ups?customerId=${j.customer.id}`)).body.followUps.find((f: any) => f.jobId === j.id);
  assert.ok(thanks.message.includes(`/done/?d=${token}`), thanks.message);
  const plain = (await call('GET', `/crm/follow-ups?customerId=${bare.customer.id}`)).body.followUps.find((f: any) => f.jobId === bare.id);
  assert.ok(!/photos/i.test(plain.message), plain.message);
});

test('a coating: certificate emailed, public page, upkeep and a sticker', async () => {
  const j = await job('Coated Cora', '2036-06-01T15:00:00.000Z', { email: 'cora@example.com' });
  await call('PATCH', `/jobs/${j.id}`, { status: 'done', finalPrice: 90000 });

  assert.equal((await call('POST', '/coatings', { jobId: j.id, warrantyMonths: 60 })).status, 422, 'needs a product');
  const made = await call('POST', '/coatings', { jobId: j.id, product: 'Gtechniq Crystal Serum Light', warrantyMonths: 60 });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const c = made.body.coating;
  assert.equal(c.appliedOn, '2036-06-01');
  assert.equal(c.vehicle, '2021 Tacoma');
  assert.equal(c.maintenanceMonths, 12);
  assert.equal(c.warrantyUntil, '2041-06-01');
  assert.equal(c.nextMaintenance, '2037-06-01');
  assert.match(c.url, /\/car\/\?c=[A-Za-z0-9_-]{43}$/);
  assert.equal(made.body.emailed, true);
  const email = mail.find((m) => m.to[0] === 'cora@example.com')!;
  assert.ok(email.html.includes('View your certificate'));

  const cert = new URL(c.url).searchParams.get('c')!;
  const pub = await call('GET', `/coating/${cert}`, undefined, {});
  assert.equal(pub.status, 200);
  assert.equal(pub.body.coating.product, 'Gtechniq Crystal Serum Light');
  assert.equal(pub.body.history.length, 1);
  assert.ok(!JSON.stringify(pub.body).includes('Cora'), 'no name on the public page');

  const kept = await call('POST', `/coatings/${c.id}/maintenance`, { date: '2037-05-20' });
  assert.equal(kept.body.nextMaintenance, '2038-05-20');
  assert.equal((await call('POST', `/coatings/${c.id}/maintenance`, { date: '2030-01-01' })).status, 422);

  // Sticker: scanned as its whole URL, then read back by anyone.
  const tag = await call('POST', '/tags', { code: 'https://www.kedservice.com/c/kd7q2m', jobId: j.id, coatingId: c.id });
  assert.equal(tag.status, 201, JSON.stringify(tag.body));
  assert.equal(tag.body.tag.code, 'KD7Q2M');
  assert.equal((await call('POST', '/tags', { code: 'KD7Q2M', jobId: j.id })).status, 200, 'same car again is fine');
  const car = await call('GET', '/car/kd7q2m', undefined, {});
  assert.equal(car.status, 200);
  assert.equal(car.body.coating.status, 'active');
  assert.match(car.body.bookUrl, /utm_source=sticker/);
  assert.deepEqual((await call('GET', `/coatings?jobId=${j.id}`)).body.coatings[0].tags, ['KD7Q2M']);

  const someoneElse = await job('Other Otto', '2036-06-02T15:00:00.000Z');
  const taken = await call('POST', '/tags', { code: 'KD7Q2M', jobId: someoneElse.id });
  assert.equal(taken.status, 409);
  assert.equal(taken.body.error.code, 'taken');
  assert.equal((await call('POST', '/tags', { code: 'no!', jobId: j.id })).status, 422);

  assert.equal((await call('DELETE', '/tags/KD7Q2M')).status, 204);
  assert.equal((await call('GET', '/car/KD7Q2M', undefined, {})).status, 404, 'unlinked sticker');

  assert.equal((await call('POST', `/coatings/${c.id}/void`)).body.status, 'void');
  assert.equal((await call('GET', `/coating/${cert}`, undefined, {})).status, 404);
});

test('upkeep coming due puts a reminder on the list, once', async () => {
  // Applied a year ago less a week: upkeep is due in about a week.
  const applied = new Date(Date.now() - 358 * 864e5).toISOString().slice(0, 10);
  const j = await job('Due Dora', `${applied}T15:00:00.000Z`);
  await call('PATCH', `/jobs/${j.id}`, { status: 'done', finalPrice: 90000 });
  const c = (await call('POST', '/coatings', { jobId: j.id, product: 'CarPro CQuartz', warrantyMonths: 36, appliedOn: applied })).body.coating;
  assert.equal(c.status, 'due');

  await call('POST', '/care/run');
  await call('POST', '/care/run');
  const list = (await call('GET', `/crm/follow-ups?customerId=${j.customer.id}`)).body.followUps.filter((f: any) => f.title.startsWith('Coating upkeep'));
  assert.equal(list.length, 1);
  assert.ok(list[0].message.includes('CarPro CQuartz'));
  assert.equal(list[0].status, 'open', 'for Jacob to send, not sent');
});
