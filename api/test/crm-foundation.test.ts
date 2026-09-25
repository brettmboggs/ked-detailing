import { test } from 'node:test';
import assert from 'node:assert/strict';

// The CRM foundation (docs/crm.md): where people came from, referral codes,
// and customer segments with their numbers.
const API = process.env.API!;
const admin = { Authorization: `Bearer ${process.env.ADMIN_TOKEN}` };

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${API}/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await res.text();
  return { status: res.status, body: (t ? JSON.parse(t) : null) as any };
}
const segment = (s: object) => call('GET', `/crm/customers?segment=${encodeURIComponent(JSON.stringify(s))}`, undefined, admin);
const input = { service: 'level-1', vehicleClass: 'sedan', conditions: {}, addOns: [] };
// Far in the past, so these jobs never collide with other suites' calendars.
const at = (d: number) => new Date(Date.UTC(2021, 0, d, 15)).toISOString();

async function doneJob(customer: object | string, day: number, price: number, extra: object = {}) {
  const who = typeof customer === 'string' ? { customerId: customer } : { customer };
  const r = await call('POST', '/jobs', { ...who, input, start: at(day), address: '1 Crm Way', zip: '63129', ...extra }, admin);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const done = await call('PATCH', `/jobs/${r.body.job.id}`, { status: 'done', finalPrice: price }, admin);
  assert.equal(done.status, 200);
  return r.body.job;
}

test('a quote request becomes a CRM person with where they heard about us', async () => {
  const r = await call('POST', '/leads', {
    name: 'Ivy Gram', phone: '314-555-7001', zip: '63129', input,
    source: 'instagram', attribution: { utmSource: 'ig', landing: '/services?x=1', referrer: 'https://l.instagram.com/abc' },
  });
  assert.equal(r.status, 201);
  const [ivy] = (await segment({ q: 'Ivy Gram' })).body.customers;
  assert.equal(ivy.source, 'instagram');
  assert.equal(ivy.visits, 0);
  assert.ok(/^[A-Z2-9]{6}$/.test(ivy.referralCode));
  const leads = await call('GET', '/leads', undefined, admin);
  const lead = leads.body.leads.find((l: any) => l.name === 'Ivy Gram');
  assert.equal(lead.customerId, ivy.id);
  assert.equal(lead.source, 'instagram');
});

test('the source is guessed from the visit when they skip the question, and a ref code links the referrer', async () => {
  const [ivy] = (await segment({ q: 'Ivy Gram' })).body.customers;
  await call('POST', '/leads', { name: 'Gus Search', phone: '314-555-7002', input, attribution: { referrer: 'www.google.com' } });
  await call('POST', '/leads', { name: 'Rae Friend', phone: '314-555-7003', input, attribution: { ref: ivy.referralCode.toLowerCase() } });
  assert.equal((await segment({ q: 'Gus Search' })).body.customers[0].source, 'google');
  const [rae] = (await segment({ q: 'Rae Friend' })).body.customers;
  assert.equal(rae.source, 'referral');
  assert.equal(rae.referredBy, ivy.id);
  assert.equal((await segment({ q: 'Ivy Gram' })).body.customers[0].referrals, 1);
});

test('segments rank customers by what they spent and find repeat, lapsed and lead-only people', async () => {
  const big = await doneJob({ name: 'Crm Bigspender', phone: '314-555-7101' }, 3, 90000, { source: 'maps' });
  await doneJob(big.customer.id, 10, 60000);
  await doneJob({ name: 'Crm Once', phone: '314-555-7102' }, 5, 15000);

  const top = (await segment({ q: 'Crm ', sort: 'spend' })).body.customers;
  assert.equal(top[0].name, 'Crm Bigspender');
  assert.equal(top[0].visits, 2);
  assert.equal(top[0].spend, 150000);
  assert.equal(top[0].avgTicket, 75000);
  assert.equal(top[0].lastVisit, '2021-01-10');
  assert.equal(top[0].source, 'maps');
  assert.equal(top[0].zip, '63129');
  assert.deepEqual(top[0].services, ['level-1']);

  const repeat = (await segment({ q: 'Crm ', lifecycle: 'repeat' })).body.customers.map((c: any) => c.name);
  assert.deepEqual(repeat, ['Crm Bigspender']);
  const lapsed = (await segment({ q: 'Crm ', lifecycle: 'lapsed' })).body.customers.map((c: any) => c.name).sort();
  assert.deepEqual(lapsed, ['Crm Bigspender', 'Crm Once']);
  assert.ok((await segment({ lifecycle: 'lead' })).body.customers.some((c: any) => c.name === 'Gus Search'));
  assert.equal((await segment({ q: 'Crm ', minSpend: 100000 })).body.customers.length, 1);
  assert.equal((await segment({ q: 'Crm ', zips: ['631'] })).body.customers.length, 2);
  assert.equal((await segment({ q: 'Crm ', sources: ['maps'] })).body.customers.length, 1);
  assert.equal((await segment({ lifecycle: 'nope' })).status, 422);
  assert.equal((await call('GET', '/crm/customers')).status, 401);
});
