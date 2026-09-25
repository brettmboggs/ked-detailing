import { test } from 'node:test';
import assert from 'node:assert/strict';

// CRM part 1 (docs/crm.md): the customer profile and timeline, notes and
// calls, tags, source, consent, referred-by, the CSV export and merging
// duplicates. Jobs sit in 2016 and 2045 so no other suite's calendar sees them.
const API = process.env.API!;
const admin = { Authorization: `Bearer ${process.env.ADMIN_TOKEN}` };

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = admin) {
  const res = await fetch(`${API}/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await res.text();
  let parsed: any = null;
  try {
    parsed = t ? JSON.parse(t) : null;
  } catch {
    parsed = t;
  }
  return { status: res.status, body: parsed, queries: Number(res.headers.get('X-D1-Queries')), headers: res.headers };
}
const input = { service: 'level-1', vehicleClass: 'sedan', conditions: {}, addOns: [] };
const at = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 15)).toISOString();

async function job(customer: object | string, start: string, extra: object = {}) {
  const who = typeof customer === 'string' ? { customerId: customer } : { customer };
  const r = await call('POST', '/jobs', { ...who, input, start, address: '9 Profile Ln', zip: '63105', ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.job;
}
async function doneJob(customer: object | string, start: string, price: number) {
  const j = await job(customer, start);
  assert.equal((await call('PATCH', `/jobs/${j.id}`, { status: 'done', finalPrice: price })).status, 200);
  return j;
}
const profile = (id: string) => call('GET', `/crm/customers/${id}`);

let pat = '';

test('the profile has their numbers, money, referral code and a merged timeline, newest first', async () => {
  const first = await doneJob({ name: 'Pat Profile', phone: '314-555-8601', email: 'pat.profile@example.com' }, at(2016, 1, 4), 20000);
  pat = first.customer.id;
  const second = await doneJob(pat, at(2016, 3, 4), 30000); // 60 days later
  await doneJob(pat, at(2016, 5, 3), 40000); // 60 more
  const upcoming = await job(pat, at(2045, 6, 1));
  const cancelled = await job(pat, at(2045, 7, 1));
  await call('PATCH', `/jobs/${cancelled.id}`, { status: 'cancelled' });

  const inv = (await call('POST', `/jobs/${second.id}/invoice`, { lines: [{ label: 'The Refresh', amount: 30000 }] })).body;
  assert.ok(inv.id, 'invoice made');
  const paid = await call('POST', `/invoices/${inv.id}/payments`, { date: '2016-03-05', amount: 30000, depositToId: 'cash', method: 'cash', tip: 2500 });
  assert.equal(paid.status, 201, JSON.stringify(paid.body));
  // A quote request from the same phone lands on the same person.
  assert.equal((await call('POST', '/leads', { name: 'Pat P', phone: '(314) 555-8601', input, source: 'google', notes: 'Boat too?' }, {})).status, 201);

  const r = await profile(pat);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const p = r.body;
  assert.equal(p.customer.name, 'Pat Profile');
  assert.equal(p.numbers.visits, 3);
  assert.equal(p.numbers.spend, 90000);
  assert.equal(p.numbers.avgTicket, 30000);
  assert.equal(p.numbers.firstVisit, '2016-01-04');
  assert.equal(p.numbers.lastVisit, '2016-05-03');
  assert.equal(p.numbers.customerSince, '2016-01-04', 'the first visit, not the day the record was made');
  assert.equal(p.numbers.nextVisit, upcoming.start);
  assert.equal(p.numbers.everyDays, 60);
  assert.equal(p.numbers.paid, 30000);
  assert.equal(p.numbers.tips, 2500);
  assert.equal(p.numbers.owed, 0);
  assert.match(p.referral.code, /^[A-Z2-9]{6}$/);
  assert.equal(p.referral.url, `https://www.kedservice.com/?ref=${p.referral.code}`);
  assert.equal(p.jobs.length, 5);
  assert.equal(p.invoices.length, 1);
  assert.equal(p.invoices[0].status, 'paid');
  assert.equal(p.payments.length, 2);
  assert.equal(p.quoteRequests.length, 1);
  assert.equal(p.quoteRequests[0].notes, 'Boat too?');
  assert.deepEqual(p.followUps, []);

  const types = new Set(p.timeline.map((t: any) => t.type));
  for (const t of ['job', 'invoice', 'payment', 'quote']) assert.ok(types.has(t), `timeline has a ${t}`);
  const sorted = [...p.timeline].sort((a: any, b: any) => b.at.localeCompare(a.at));
  assert.deepEqual(p.timeline.map((t: any) => t.id), sorted.map((t: any) => t.id), 'newest first');
  assert.ok(p.timeline.some((t: any) => t.title.startsWith('Cancelled')));
  assert.ok(p.timeline.some((t: any) => t.type === 'payment' && t.title === 'Tip' && t.amount === 2500));

  assert.equal((await profile('01NOPE0000000000000000000')).status, 404);
  assert.equal((await call('GET', `/crm/customers/${pat}`, undefined, {})).status, 401);
});

test('the profile stays well under the 50-query cap, however long their history', async () => {
  const id = (await doneJob({ name: 'Quinn Busy', phone: '314-555-8602' }, at(2016, 1, 5), 10000)).customer.id;
  for (let i = 0; i < 24; i++) await doneJob(id, at(2016, 2 + (i % 10), 6 + Math.floor(i / 10)), 10000 + i);
  for (let i = 0; i < 6; i++) await call('POST', `/crm/customers/${id}/activities`, { kind: 'note', body: `Note ${i}` });
  const r = await profile(id);
  assert.equal(r.status, 200);
  assert.equal(r.body.jobs.length, 25);
  assert.ok(r.queries > 0 && r.queries < 50, `profile: ${r.queries} queries`);
  assert.ok(r.queries <= 12, `profile: ${r.queries} queries, expected a handful`);
});

test('notes, calls and texts go on the timeline; Jacob can edit and delete his own', async () => {
  const note = await call('POST', `/crm/customers/${pat}/activities`, { kind: 'note', body: '  Likes the tire shine extra glossy.  ' });
  assert.equal(note.status, 201);
  assert.equal(note.body.body, 'Likes the tire shine extra glossy.');
  assert.equal(note.body.editable, true);
  const called = await call('POST', `/crm/customers/${pat}/activities`, { kind: 'call', body: 'Wants October', direction: 'in' });
  assert.equal(called.body.title, 'They called');
  const texted = await call('POST', `/crm/customers/${pat}/activities`, { kind: 'text' });
  assert.equal(texted.status, 201, 'a text needs no words');
  assert.equal(texted.body.title, 'Texted them');

  for (const bad of [{ kind: 'note', body: '' }, { kind: 'email', body: 'x' }, { kind: 'call', direction: 'sideways' }, { kind: 'note', body: 'x'.repeat(5001) }]) {
    assert.equal((await call('POST', `/crm/customers/${pat}/activities`, bad)).status, 422, JSON.stringify(bad).slice(0, 60));
  }
  assert.equal((await call('POST', '/crm/customers/01NOPE0000000000000000000/activities', { body: 'hi' })).status, 404);

  const edited = await call('PATCH', `/crm/customers/${pat}/activities/${note.body.id}`, { body: 'Likes it glossy. Dog named Rex.' });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.body, 'Likes it glossy. Dog named Rex.');
  assert.ok(edited.body.meta.editedAt);
  const callEdit = await call('PATCH', `/crm/customers/${pat}/activities/${called.body.id}`, { body: 'Wants November' });
  assert.equal(callEdit.body.meta.direction, 'in', 'the direction is kept');

  let tl = (await profile(pat)).body.timeline;
  assert.equal(tl.find((t: any) => t.id === note.body.id).body, 'Likes it glossy. Dog named Rex.');
  assert.equal((await call('DELETE', `/crm/customers/${pat}/activities/${texted.body.id}`)).status, 204);
  tl = (await profile(pat)).body.timeline;
  assert.ok(!tl.some((t: any) => t.id === texted.body.id));
  assert.equal((await call('DELETE', `/crm/customers/${pat}/activities/${texted.body.id}`)).status, 404);
});

test('tags, source, consent and referred-by are validated and saved', async () => {
  const ok = await call('PATCH', `/crm/customers/${pat}`, {
    tags: [' VIP ', 'boat   owner', 'vip', 'Fleet'],
    source: 'nextdoor',
    sourceDetail: 'Post in the Kirkwood group',
    emailOk: false,
    textOk: true,
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(ok.body.tags, ['vip', 'boat owner', 'fleet']);
  assert.equal(ok.body.source, 'nextdoor');
  assert.equal(ok.body.sourceDetail, 'Post in the Kirkwood group');
  assert.equal(ok.body.emailOk, false);
  // The older route takes the same fields.
  assert.equal((await call('PATCH', `/customers/${pat}`, { textOk: false })).body.textOk, false);

  const bad = [
    { tags: 'vip' },
    { tags: Array.from({ length: 13 }, (_, i) => `t${i}`) },
    { tags: ['x'.repeat(25)] },
    { tags: ['<b>'] },
    { source: 'tiktok' },
    { emailOk: 'yes' },
    { referredBy: pat },
    { referredBy: '01NOPE0000000000000000000' },
  ];
  for (const b of bad) assert.equal((await call('PATCH', `/crm/customers/${pat}`, b)).status, 422, JSON.stringify(b).slice(0, 80));

  const sam = (await doneJob({ name: 'Sam Sender', phone: '314-555-8603' }, at(2016, 2, 9), 15000)).customer.id;
  const set = await call('PATCH', `/crm/customers/${pat}`, { referredBy: sam });
  assert.equal(set.body.referredBy, sam);
  assert.equal((await call('PATCH', `/crm/customers/${sam}`, { referredBy: pat })).status, 422, 'no loops');
  const p = (await profile(pat)).body;
  assert.deepEqual(p.referral.referredBy, { id: sam, name: 'Sam Sender' });
  const s = (await profile(sam)).body;
  assert.deepEqual(s.referral.referred.map((r: any) => r.name), ['Pat Profile']);
  assert.equal(s.numbers.referrals, 1);
  assert.equal((await call('PATCH', `/crm/customers/${pat}`, { referredBy: null, source: null })).body.referredBy, null);
  await call('PATCH', `/crm/customers/${pat}`, { emailOk: true, textOk: true, source: 'nextdoor' });
});

test('the tag list counts people, and the export is a safe spreadsheet', async () => {
  const other = (await doneJob({ name: '=Evil Formula', phone: '314-555-8604', email: 'evil@example.com' }, at(2016, 4, 9), 12345)).customer.id;
  await call('PATCH', `/crm/customers/${other}`, { tags: ['VIP'] });
  const tags = (await call('GET', '/crm/customers/tags')).body.tags;
  assert.equal(tags.find((t: any) => t.tag === 'vip').count, 2);
  assert.equal(tags.find((t: any) => t.tag === 'fleet').count, 1);

  const seg = encodeURIComponent(JSON.stringify({ tags: ['vip'], sort: 'spend' }));
  const csv = await call('GET', `/crm/customers/export?segment=${seg}`);
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type')!, /text\/csv/);
  assert.match(csv.headers.get('content-disposition')!, /attachment; filename="ked-customers-\d{4}-\d{2}-\d{2}\.csv"/);
  const lines = (csv.body as string).replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(lines[0], 'Name,Phone,Email,Visits,Spent,Last visit,Next booking,Source,Tags,Can email,Can text');
  assert.equal(lines.length, 3);
  assert.ok(lines[1]!.startsWith('Pat Profile,314-555-8601,pat.profile@example.com,3,900.00,2016-05-03,2045-06-01,nextdoor,vip; boat owner; fleet,'), lines[1]);
  assert.ok(lines[2]!.startsWith("'=Evil Formula,"), 'formulas are defused');
  assert.equal((await call('GET', `/crm/customers/export?segment=${encodeURIComponent('{"sort":"nope"}')}`)).status, 422);
  assert.equal((await call('GET', '/crm/customers/export', undefined, {})).status, 401);
});

test('merging two records of one person keeps the older one and moves everything over', async () => {
  // The older record: an import with a name and phone only.
  const oldJob = await doneJob({ name: 'Morgan Merge', phone: '314-555-8605' }, at(2016, 6, 1), 25000);
  const older = oldJob.customer.id;
  await call('PATCH', `/crm/customers/${older}`, { tags: ['boat'], notes: 'Gate code 1234', textOk: false });
  // A second record: booked again with an email, from another number.
  const newJob = await doneJob({ name: 'Morgan M.', phone: '636-555-8605', email: 'morgan@example.com', address: '5 New Rd' }, at(2016, 7, 1), 35000);
  const newer = newJob.customer.id;
  await call('PATCH', `/crm/customers/${newer}`, { tags: ['vip', 'Boat'], notes: 'Prefers texts', source: 'instagram' });
  await call('POST', `/crm/customers/${newer}/activities`, { kind: 'note', body: 'From the newer record' });
  const friend = (await doneJob({ name: 'Frankie Friend', phone: '314-555-8606' }, at(2016, 7, 2), 10000)).customer.id;
  await call('PATCH', `/crm/customers/${friend}`, { referredBy: newer });
  const inv = (await call('POST', `/jobs/${newJob.id}/invoice`, { lines: [{ label: 'The Refresh', amount: 35000 }] })).body;

  const dups = (await call('GET', '/crm/customers/duplicates')).body.groups;
  assert.ok(Array.isArray(dups));

  assert.equal((await call('POST', `/crm/customers/${older}/merge`, { otherId: older })).status, 422);
  assert.equal((await call('POST', `/crm/customers/${older}/merge`, {})).status, 422);
  // Called from the newer one: the older one still stays.
  const m = await call('POST', `/crm/customers/${newer}/merge`, { otherId: older });
  assert.equal(m.status, 200, JSON.stringify(m.body));
  assert.equal(m.body.kept, older);
  assert.equal(m.body.removed, newer);
  const c = m.body.customer;
  assert.equal(c.name, 'Morgan Merge', 'keeps its own name');
  assert.equal(c.phone, '314-555-8605', 'keeps its own phone');
  assert.equal(c.email, 'morgan@example.com', 'fills the blank email');
  assert.equal(c.address, '5 New Rd');
  assert.equal(c.source, 'instagram');
  assert.deepEqual(c.tags, ['boat', 'vip']);
  assert.equal(c.notes, 'Gate code 1234\n\nPrefers texts');
  assert.equal(c.textOk, false, 'a no on either record stands');

  const p = (await profile(older)).body;
  assert.equal(p.numbers.visits, 2);
  assert.equal(p.numbers.spend, 60000);
  assert.equal(p.invoices.length, 1);
  assert.equal(p.invoices[0].id, inv.id);
  assert.ok(p.timeline.some((t: any) => t.body === 'From the newer record'));
  const log = p.timeline.find((t: any) => t.type === 'system');
  assert.match(log.body, /Morgan M\., 636-555-8605, morgan@example.com/);
  assert.equal(log.editable, false);
  assert.equal((await call('DELETE', `/crm/customers/${older}/activities/${log.id}`)).status, 403, 'the system note stays');
  assert.equal((await profile(friend)).body.referral.referredBy.id, older, 'referrals follow');
  assert.equal((await profile(newer)).status, 404);
  assert.equal((await call('GET', `/jobs/${newJob.id}`)).body.customer.id, older);
  assert.equal((await call('POST', `/crm/customers/${older}/merge`, { otherId: newer })).status, 404);
});
