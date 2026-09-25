import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

// Marketing (docs/crm.md, part 4): campaigns by email and text list, tracking
// links, referrals, reviews and the playbook. The Worker's RESEND_URL points
// at the fake Resend below (see run.sh).
const API = process.env.API!;
const admin = { Authorization: `Bearer ${process.env.ADMIN_TOKEN}` };
const CAP = 50;

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = admin) {
  const res = await fetch(`${API}/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await res.text();
  return { status: res.status, body: (t ? JSON.parse(t) : null) as any, queries: Number(res.headers.get('X-D1-Queries')) };
}

/* A fake Resend that records every email, and fails an address once when asked. */
const mail: any[] = [];
const failOnce = new Set<string>();
const resend = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const m = JSON.parse(raw);
    const to = m.to[0] as string;
    if (failOnce.delete(to)) {
      res.statusCode = 500;
      return res.end('{"message":"boom"}');
    }
    mail.push(m);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ id: `fake-${mail.length}` }));
  });
});
await new Promise<void>((r) => resend.listen(Number(process.env.RESEND_PORT), r));
after(() => resend.close());

const input = { service: 'level-3', vehicleClass: 'sedan', conditions: {}, addOns: [] };
// 2022: no other suite books jobs then.
const at = (month: number, day: number, hour = 15) => new Date(Date.UTC(2022, month - 1, day, hour)).toISOString();

async function doneJob(body: object, start: string, price = 20000) {
  const r = await call('POST', '/jobs', { input, start, zip: '63051', ...body });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal((await call('PATCH', `/jobs/${r.body.job.id}`, { status: 'done', finalPrice: price })).status, 200);
  return r.body.job;
}

const segment = { q: 'Mktest' };
const people: { id: string; name: string; email: string | null }[] = [];

test('setup: thirteen customers, twelve with email', async () => {
  const names = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet', 'Kilo', 'Lima', 'Mike'];
  for (const [i, first] of names.entries()) {
    const email = first === 'Mike' ? undefined : `${first.toLowerCase()}@mktest.example`;
    const job = await doneJob(
      { customer: { name: `${first} Mktest`, phone: `314-555-8${String(i).padStart(3, '0')}`, email }, address: `${10 + i * 2} Mktest Lane, House Springs` },
      at(3, i + 1),
    );
    people.push({ id: job.customer.id, name: `${first} Mktest`, email: email ?? null });
  }
});

test('templates cover the seasons and the asks', async () => {
  const r = await call('GET', '/crm/campaigns/templates');
  assert.equal(r.status, 200);
  const ids = r.body.templates.map((t: any) => t.id);
  for (const id of ['spring-boats', 'winter-salt', 'holiday-gift', 'miss-you', 'ceramic-upsell', 'referral']) assert.ok(ids.includes(id), id);
  assert.equal((await call('GET', '/crm/campaigns/templates', undefined, {})).status, 401);
});

let emailId = '';

test('a draft previews who gets it and how it reads', async () => {
  const draft = {
    name: 'Spring Mktest',
    segment,
    channel: 'email',
    subject: 'Hi {first}',
    body: 'Hey {first}, it has been a while since your {last service}. Book here: {quote link}\nShare: {referral link} {nope}',
  };
  const p = await call('POST', '/crm/campaigns/preview', { ...draft, sampleId: people[1]!.id });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.equal(p.body.count, 13);
  assert.equal(p.body.canEmail, 12);
  assert.equal(p.body.canText, 13);
  assert.equal(p.body.sample.name, 'Bravo Mktest');
  assert.equal(p.body.sample.subject, 'Hi Bravo');
  assert.match(p.body.sample.body, /^Hey Bravo, it has been a while since your Knockout\./);
  assert.match(p.body.sample.body, /quote\/\?utm_source=email&utm_campaign=spring-mktest/);
  assert.match(p.body.sample.body, /\/\?ref=[A-Z2-9]{6}/);
  assert.deepEqual(p.body.unknown, ['nope']);

  const created = await call('POST', '/crm/campaigns', draft);
  assert.equal(created.status, 201);
  assert.equal(created.body.status, 'draft');
  emailId = created.body.id;
  const edited = await call('PATCH', `/crm/campaigns/${emailId}`, { body: draft.body.replace(' {nope}', '') });
  assert.equal(edited.status, 200);
  assert.ok(!edited.body.body.includes('{nope}'));
  assert.equal((await call('POST', '/crm/campaigns', { ...draft, channel: 'fax' })).status, 422);
});

test('an email campaign sends in batches under the query cap, then reports what happened', async () => {
  failOnce.add('kilo@mktest.example');
  const first = await call('POST', `/crm/campaigns/${emailId}/send`);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.ok(first.queries < CAP, `first batch: ${first.queries} queries`);
  // The first call also queues everyone, so it sends a smaller batch.
  assert.equal(first.body.batch.sent + first.body.batch.failed, 6);
  assert.equal(first.body.batch.failed, 1);
  assert.equal(first.body.campaign.status, 'sending');
  assert.equal(first.body.campaign.stats.queued, 6);
  assert.equal(first.body.campaign.stats.skipped, 1); // Mike has no email

  const second = await call('POST', `/crm/campaigns/${emailId}/send`);
  assert.ok(second.queries < CAP, `second batch: ${second.queries} queries`);
  assert.equal(second.body.batch.sent, 6);
  assert.equal(second.body.campaign.status, 'sent');
  assert.deepEqual(
    { sent: second.body.campaign.stats.sent, failed: second.body.campaign.stats.failed, skipped: second.body.campaign.stats.skipped },
    { sent: 11, failed: 1, skipped: 1 },
  );

  const ours = mail.filter((m) => m.to[0].endsWith('@mktest.example'));
  assert.equal(ours.length, 11);
  const bravo = ours.find((m) => m.to[0] === 'bravo@mktest.example');
  assert.equal(bravo.subject, 'Hi Bravo');
  assert.match(bravo.text, /Hey Bravo, it has been a while since your Knockout/);
  assert.match(bravo.text, /\/unsubscribe\/\?t=/);
  assert.ok(bravo.headers['List-Unsubscribe']);

  // The failed one goes back in the queue and out on the next send.
  const retried = await call('POST', `/crm/campaigns/${emailId}/retry`);
  assert.equal(retried.body.stats.queued, 1);
  assert.equal(retried.body.status, 'sending');
  const third = await call('POST', `/crm/campaigns/${emailId}/send`);
  assert.equal(third.body.batch.sent, 1);
  assert.equal(third.body.campaign.status, 'sent');
  assert.equal(third.body.campaign.stats.sent, 12);
  assert.equal(mail.filter((m) => m.to[0] === 'kilo@mktest.example').length, 1);

  // Sending again does nothing; a sent campaign can't be edited or deleted.
  const again = await call('POST', `/crm/campaigns/${emailId}/send`);
  assert.equal(again.body.batch, null);
  assert.equal(mail.filter((m) => m.to[0].endsWith('@mktest.example')).length, 12);
  assert.equal((await call('PATCH', `/crm/campaigns/${emailId}`, { name: 'x' })).status, 409);
  assert.equal((await call('DELETE', `/crm/campaigns/${emailId}`)).status, 409);

  const list = await call('GET', `/crm/campaigns/${emailId}/people`);
  const mike = list.body.people.find((p: any) => p.name === 'Mike Mktest');
  assert.equal(mike.status, 'skipped');
  assert.equal(mike.reason, 'no_email');
});

test('bookings by recipients within 30 days count toward the campaign', async () => {
  const r = await call('POST', '/jobs', { customerId: people[0]!.id, input, start: at(9, 1), zip: '63051', address: '10 Mktest Lane' });
  assert.equal(r.status, 201);
  const camp = await call('GET', `/crm/campaigns/${emailId}`);
  assert.equal(camp.body.stats.bookings, 1);
  assert.ok(camp.body.stats.bookedValue > 0);
  const all = await call('GET', '/crm/campaigns');
  assert.ok(all.queries < CAP);
  assert.equal(all.body.campaigns.find((x: any) => x.id === emailId).stats.bookings, 1);
  assert.equal(all.body.emailReady, true);
});

test('a text campaign is a list Jacob works through, logging each text', async () => {
  const created = await call('POST', '/crm/campaigns', {
    name: 'Referral Mktest',
    segment: { q: 'Mktest', limit: 3, sort: 'name' },
    channel: 'text',
    body: 'Hey {first}! Send friends {referral link}. They get {friend gets}, you get {you get}.',
  });
  assert.equal(created.status, 201);
  const id = created.body.id;
  const started = await call('POST', `/crm/campaigns/${id}/send`);
  assert.equal(started.status, 200);
  assert.equal(started.body.batch, null);
  assert.equal(started.body.campaign.status, 'sending');
  assert.equal(started.body.campaign.stats.queued, 3);

  const list = await call('GET', `/crm/campaigns/${id}/people`);
  assert.deepEqual(list.body.people.map((p: any) => p.name), ['Alpha Mktest', 'Bravo Mktest', 'Charlie Mktest']);
  const alpha = list.body.people[0];
  assert.match(alpha.message, /^Hey Alpha! Send friends https:\/\/www\.kedservice\.com\/\?ref=[A-Z2-9]{6}\. They get \$20 off their first detail/);
  assert.ok(alpha.phone);

  let r = await call('POST', `/crm/campaigns/${id}/texted`, { customerId: alpha.customerId, message: alpha.message });
  assert.equal(r.body.stats.sent, 1);
  r = await call('POST', `/crm/campaigns/${id}/texted`, { customerId: alpha.customerId, texted: false });
  assert.equal(r.body.stats.sent, 0);
  for (const p of list.body.people) r = await call('POST', `/crm/campaigns/${id}/texted`, { customerId: p.customerId, message: p.message });
  assert.equal(r.body.stats.sent, 3);
  assert.equal(r.body.status, 'sent');
});

test('a template makes a draft, and drafts can be thrown away', async () => {
  const r = await call('POST', '/crm/campaigns', { template: 'referral' });
  assert.equal(r.status, 201);
  assert.equal(r.body.template, 'referral');
  assert.equal(r.body.channel, 'text');
  assert.deepEqual(r.body.segment, { lifecycle: 'repeat', sort: 'spend', limit: 25 });
  assert.match(r.body.body, /\{referral link\}/);
  const asEmail = await call('POST', '/crm/campaigns', { template: 'winter-salt', channel: 'email' });
  assert.ok(asEmail.body.subject);
  assert.equal((await call('DELETE', `/crm/campaigns/${r.body.id}`)).status, 204);
  assert.equal((await call('DELETE', `/crm/campaigns/${asEmail.body.id}`)).status, 204);
  assert.equal((await call('GET', `/crm/campaigns/${r.body.id}`)).status, 404);
});

test('tracking links count the leads and bookings they bring', async () => {
  const link = await call('POST', '/crm/campaigns/links', { name: 'Van magnet', channel: 'van', source: 'Van', medium: 'magnet', campaign: 'mktest 2022' });
  assert.equal(link.status, 201, JSON.stringify(link.body));
  assert.equal(link.body.url, 'https://www.kedservice.com/?utm_source=van&utm_medium=magnet&utm_campaign=mktest-2022');
  assert.equal((await call('POST', '/crm/campaigns/links', { name: 'Again', source: 'van', medium: 'x', campaign: 'mktest-2022' })).status, 409);
  assert.equal((await call('POST', '/crm/campaigns/links', { name: 'Bad', source: 'v a/n', medium: 'x', campaign: '' })).status, 422);

  const attribution = { utmSource: 'VAN', utmMedium: 'magnet', utmCampaign: 'mktest-2022' };
  assert.equal((await call('POST', '/leads', { name: 'Vanna Mklink', phone: '314-555-8201', input, attribution }, {})).status, 201);
  await doneJob({ customer: { name: 'Vic Mklink', phone: '314-555-8202' }, address: '5 Elm St', attribution }, at(4, 2));

  const links = await call('GET', '/crm/campaigns/links');
  assert.ok(links.queries < CAP);
  const mine = links.body.links.find((l: any) => l.id === link.body.id);
  assert.equal(mine.leads, 2);
  assert.equal(mine.bookings, 1);
  assert.equal(mine.revenue, 20000);

  const renamed = await call('PATCH', `/crm/campaigns/links/${link.body.id}`, { name: 'Van magnet, driver side' });
  assert.equal(renamed.body.name, 'Van magnet, driver side');
  assert.equal((await call('DELETE', `/crm/campaigns/links/${link.body.id}`)).status, 204);
});

test('referrals: settings, each customer link, and the leaderboard', async () => {
  const saved = await call('PUT', '/crm/campaigns/settings', { referrerGets: '$25 off', friendGets: '$15 off' });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.settings.referrerGets, '$25 off');
  assert.equal((await call('PUT', '/crm/campaigns/settings', { reviewUrl: 'not a link' })).status, 422);

  const alpha = await call('GET', `/crm/campaigns/referrals/${people[0]!.id}`);
  assert.equal(alpha.status, 200);
  assert.equal(alpha.body.link, `https://www.kedservice.com/?ref=${alpha.body.code}`);
  await doneJob({ customer: { name: 'Friend Mkref', phone: '314-555-8301' }, address: '7 Elm St', attribution: { ref: alpha.body.code } }, at(5, 3), 30000);

  const r = await call('GET', '/crm/campaigns/referrals');
  assert.ok(r.queries < CAP);
  const lead = r.body.leaders.find((l: any) => l.id === people[0]!.id);
  assert.deepEqual({ referred: lead.referred, becameCustomers: lead.becameCustomers, revenue: lead.revenue }, { referred: 1, becameCustomers: 1, revenue: 30000 });
  assert.equal(r.body.referrerGets, '$25 off');
  await call('PUT', '/crm/campaigns/settings', { referrerGets: '', friendGets: '' }); // back to the defaults
});

test('reviews: recent jobs to ask, until they are asked', async () => {
  const saved = await call('PUT', '/crm/campaigns/settings', { reviewUrl: 'https://g.page/r/example/review' });
  assert.equal(saved.body.settings.reviewUrl, 'https://g.page/r/example/review');
  const recent = new Date(Date.now() - 5 * 864e5);
  recent.setUTCHours(11, 7, 0, 0);
  const job = await doneJob({ customer: { name: 'Rev Mkreview', phone: '314-555-8401' }, address: '9 Elm St' }, recent.toISOString());

  let r = await call('GET', '/crm/campaigns/reviews');
  assert.equal(r.status, 200);
  assert.ok(r.queries < CAP);
  assert.equal(r.body.reviewUrl, 'https://g.page/r/example/review');
  const row = r.body.toAsk.find((x: any) => x.jobId === job.id);
  assert.ok(row, 'the job is on the list');
  assert.equal(row.service, 'The Knockout');
  assert.equal(row.onToday, false);

  assert.equal((await call('POST', '/crm/campaigns/reviews/asked', { jobId: job.id })).status, 200);
  r = await call('GET', '/crm/campaigns/reviews');
  assert.ok(!r.body.toAsk.some((x: any) => x.jobId === job.id));
  assert.equal(r.body.recent[0].name, 'Rev Mkreview');
  assert.equal((await call('POST', '/crm/campaigns/reviews/asked', { jobId: 'nope' })).status, 404);
});

test('the playbook reads his own streets, ZIPs and channels, and remembers ticks', async () => {
  // Two more jobs on one street, inside the playbook's two-year window.
  const recent = (d: number) => {
    const t = new Date(Date.now() - d * 864e5);
    t.setUTCHours(10, 13, 0, 0);
    return t.toISOString();
  };
  await doneJob({ customerId: people[2]!.id, address: '12 Mkstreet Road, High Ridge', zip: '63049' }, recent(40));
  await doneJob({ customerId: people[3]!.id, address: '40 mkstreet rd.', zip: '63049' }, recent(41));

  const r = await call('GET', '/crm/campaigns/playbook');
  assert.equal(r.status, 200);
  assert.ok(r.queries < CAP);
  const street = r.body.streets.find((s: any) => s.street === 'Mkstreet Rd');
  assert.deepEqual({ jobs: street.jobs, customers: street.customers, zip: street.zip, town: street.town }, { jobs: 2, customers: 2, zip: '63049', town: 'High Ridge' });
  assert.ok(r.body.zips.some((z: any) => z.zip === '63049'));
  assert.equal(r.body.channels.length, 7);
  assert.ok(r.body.seasons.length >= 1);
  assert.ok(r.body.checklist.length >= 10);

  const ticked = await call('POST', '/crm/campaigns/playbook/done', { key: 'van', done: true });
  assert.equal(ticked.body.done, true);
  assert.equal((await call('GET', '/crm/campaigns/playbook')).body.checklist.find((c: any) => c.key === 'van').done, true);
  assert.equal((await call('POST', '/crm/campaigns/playbook/done', { key: 'van', done: false })).body.done, false);
  assert.equal((await call('POST', '/crm/campaigns/playbook/done', { key: 'nope' })).status, 422);
});
