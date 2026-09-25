import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

// Follow-ups (docs/crm.md, part 2): the daily rules, automatic email through a
// fake Resend (the Worker's RESEND_URL points here), the to-do actions and
// unsubscribing. Other suites share the database, so everything here is found
// by name or address, and runs repeat until the email queue is empty.
const API = process.env.API!;
const admin = { Authorization: `Bearer ${process.env.ADMIN_TOKEN}` };

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = admin) {
  const res = await fetch(`${API}/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await res.text();
  return { status: res.status, body: (t ? JSON.parse(t) : null) as any, queries: Number(res.headers.get('X-D1-Queries')) };
}

/** Emails Resend was asked to send. Anything to bounce@ is refused. */
const mail: { to: string[]; subject: string; text: string; headers?: Record<string, string> }[] = [];
const resend = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const m = JSON.parse(raw);
    res.setHeader('Content-Type', 'application/json');
    if (m.to[0].startsWith('bounce@')) {
      res.statusCode = 422;
      return res.end(JSON.stringify({ message: 'nope' }));
    }
    mail.push(m);
    res.end(JSON.stringify({ id: `re_${mail.length}` }));
  });
});
await new Promise<void>((r) => resend.listen(Number(process.env.RESEND_PORT), r));
after(() => resend.close());
const mailTo = (addr: string) => mail.filter((m) => m.to[0] === addr);

const day = (offset: number, from = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(from.getTime() + offset * 864e5));
/** Noon in St. Louis, `offset` days from today. */
const noon = (offset: number) => `${day(offset)}T17:00:00.000Z`;
const input = (service: string) => ({ service, vehicleClass: 'sedan', conditions: {}, addOns: [] });

async function job(customer: object | string, offset: number, service = 'level-1', done = true) {
  const who = typeof customer === 'string' ? { customerId: customer } : { customer };
  const r = await call('POST', '/jobs', { ...who, input: input(service), start: noon(offset), address: '12 Follow Up Ln', zip: '63129' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  if (done) assert.equal((await call('PATCH', `/jobs/${r.body.job.id}`, { status: 'done', finalPrice: 15000 })).status, 200);
  return r.body.job;
}

/** Runs the rules until nothing is waiting to email (other suites' people share the queue). */
async function run(at?: string) {
  let last: any;
  for (let i = 0; i < 6; i++) {
    const r = await call('POST', '/crm/follow-ups/run', at ? { at } : {});
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.queries < 50, `run: ${r.queries} queries`);
    last = r.body;
    if (!last.emailWaiting) break;
  }
  return last;
}

const forCustomer = async (id: string) => (await call('GET', `/crm/follow-ups?customerId=${id}`)).body.followUps as any[];

let settings: any;

test('settings: defaults, validation, and a save that sticks', async () => {
  const got = await call('GET', '/crm/follow-ups/settings');
  assert.equal(got.status, 200);
  settings = got.body.settings;
  assert.equal(settings.intervals['level-1'], 3);
  assert.equal(settings.lapsedMonths, 6);
  assert.equal(got.body.email.configured, true);
  assert.ok(got.body.services.some((s: any) => s.id === 'level-1' && s.level === 'Level I'));

  const bad = await call('PUT', '/crm/follow-ups/settings', {
    ...settings,
    reviewUrl: 'not a link',
    lapsedMonths: 0,
    templates: { ...settings.templates, rebook: { subject: 'Hi', body: 'Hi {frist name}' } },
  });
  assert.equal(bad.status, 422);
  assert.ok(bad.body.error.details.some((d: string) => d.includes('{frist name}')));
  assert.ok(bad.body.error.details.some((d: string) => d.includes('https://')));
  assert.equal(bad.body.error.details.length, 3);

  // Room for everyone other suites left in the database, and a win-back offer.
  settings = {
    ...settings,
    reviewUrl: 'https://g.page/r/ked-test/review',
    winbackOffer: '$20 off if you book this month.',
    newPerDay: { rebook: 200, winback: 200 },
    emailsPerDay: 100,
  };
  const saved = await call('PUT', '/crm/follow-ups/settings', settings);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const again = (await call('GET', '/crm/follow-ups/settings')).body.settings;
  assert.equal(again.reviewUrl, 'https://g.page/r/ked-test/review');
  assert.equal(again.newPerDay.winback, 200);
  assert.equal((await call('GET', '/crm/follow-ups/settings', undefined, {})).status, 401);
});

const people: Record<string, any> = {};

test('the daily rules find who to contact, email where they can, and never twice', async () => {
  people.thanks = (await job({ name: 'Fu Thanks', phone: '314-555-8101', email: 'fu.thanks@example.com' }, -1)).customer;
  people.remind = (await job({ name: 'Fu Remind', phone: '314-555-8102', email: 'fu.remind@example.com' }, 1, 'level-1', false)).customer;
  people.rebook = (await job({ name: 'Fu Rebook', phone: '314-555-8103' }, -125)).customer;
  people.regular = (await job({ name: 'Fu Regular', phone: '314-555-8104' }, -190, 'level-2')).customer;
  await job(people.regular.id, -130, 'level-2');
  await job(people.regular.id, -70, 'level-2');
  people.lapsed = (await job({ name: 'Fu Lapsed', phone: '314-555-8105', email: 'fu.lapsed@example.com' }, -240)).customer;
  people.booked = (await job({ name: 'Fu Booked', phone: '314-555-8106' }, -125)).customer;
  await job(people.booked.id, 10, 'level-1', false);
  people.bounce = (await job({ name: 'Fu Bounce', phone: '314-555-8107', email: 'bounce@example.com' }, -1)).customer;

  const r = await run();
  assert.equal(r.emailConfigured, true);

  // Thank-you and review ask, by email, with the saved review link and a working unsubscribe.
  const [thanks] = await forCustomer(people.thanks.id);
  assert.equal(thanks.kind, 'review');
  assert.equal(thanks.status, 'sent');
  assert.equal(thanks.email.state, 'sent');
  const [tm] = mailTo('fu.thanks@example.com');
  assert.ok(tm, 'thank-you emailed');
  assert.match(tm.text, /^Hi Fu, thanks for having me out for the Tune-Up/);
  assert.ok(tm.text.includes('https://g.page/r/ked-test/review'));
  assert.match(tm.text, /Don't want these emails\? http.*\/unsubscribe\/\?t=/);
  assert.match(tm.headers!['List-Unsubscribe']!, /^<http.*\/v1\/crm\/public\/unsubscribe\/[A-Za-z0-9_-]{20,}>$/);
  assert.equal(tm.headers!['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');

  // Tomorrow's booking: a service email with the time, place and their link, no marketing footer.
  const [rem] = await forCustomer(people.remind.id);
  assert.equal(rem.kind, 'reminder');
  assert.equal(rem.status, 'sent');
  const [rm] = mailTo('fu.remind@example.com');
  assert.ok(rm.text.includes('12 Follow Up Ln'));
  assert.ok(rm.text.includes('12 PM'), rm.text);
  assert.match(rm.text, /\?b=[A-Za-z0-9_-]{40,}/);
  assert.ok(!rm.text.includes('unsubscribe'));
  assert.equal(rm.headers, undefined);

  // No email: a text for Jacob, ready to send, with the quote link.
  const [rb] = await forCustomer(people.rebook.id);
  assert.equal(rb.kind, 'rebook');
  assert.equal(rb.status, 'open');
  assert.equal(rb.channel, 'text');
  assert.equal(rb.email, null);
  assert.match(rb.title, /^Due for a Level I: last one /);
  assert.ok(rb.message.includes('/quote/'));
  assert.ok(rb.message.includes('4 months'), rb.message);

  // A regular's own rhythm (every 60 days) beats Level II's 5 months.
  const [rg] = await forCustomer(people.regular.id);
  assert.equal(rg?.kind, 'rebook');
  assert.match(rg.title, /usually every 2 months or so/);

  // Lapsed: a win-back email with the offer.
  const [wb] = await forCustomer(people.lapsed.id);
  assert.equal(wb.kind, 'winback');
  assert.equal(wb.status, 'sent');
  assert.ok(mailTo('fu.lapsed@example.com')[0]!.text.includes('$20 off if you book this month.'));

  // Something booked: no rebook.
  assert.deepEqual(await forCustomer(people.booked.id), []);

  // Resend refused it: stays open for Jacob as a text, with why.
  const [bo] = await forCustomer(people.bounce.id);
  assert.equal(bo.status, 'open');
  assert.equal(bo.channel, 'text');
  assert.equal(bo.email.state, 'failed');
  assert.ok(bo.email.note);

  // Again: nothing new, nothing sent twice.
  const before = mail.length;
  const again = await run();
  assert.equal(mailTo('fu.thanks@example.com').length, 1);
  assert.equal(mailTo('fu.lapsed@example.com').length, 1);
  assert.ok(mail.length - before <= again.emailed);
  assert.equal((await forCustomer(people.rebook.id)).length, 1);

  // The list: today's, and what went out on its own.
  const list = (await call('GET', '/crm/follow-ups')).body;
  assert.ok(list.due.some((f: any) => f.id === rb.id));
  assert.ok(list.sent.some((f: any) => f.id === thanks.id));
  assert.equal(list.email.configured, true);
  assert.ok(list.email.sentLastDay >= 3);
});

test('a quote request still open two days later gets chased', async () => {
  const lead = await call('POST', '/leads', { name: 'Fu Quote', phone: '314-555-8108', input: input('level-2') }, {});
  assert.equal(lead.status, 201);
  // Not yet: it only just came in.
  await run();
  const leads = (await call('GET', '/leads')).body.leads;
  const customerId = leads.find((l: any) => l.id === lead.body.id).customerId;
  assert.deepEqual(await forCustomer(customerId), []);
  // Three days on (a test-only knob on the run), it's a text for Jacob.
  await run(new Date(Date.now() + 3 * 864e5).toISOString());
  const [chase] = await forCustomer(customerId);
  assert.equal(chase.kind, 'quote_chase');
  assert.equal(chase.leadId, lead.body.id);
  assert.equal(chase.channel, 'text');
  assert.match(chase.message, /^Hi Fu, .*Refresh/);
});

test('the daily email cap holds emails back until there is room', async () => {
  await call('PUT', '/crm/follow-ups/settings', { ...settings, emailsPerDay: 0 });
  const c = (await job({ name: 'Fu Capped', phone: '314-555-8109', email: 'fu.capped@example.com' }, -1)).customer;
  const r = await call('POST', '/crm/follow-ups/run', {});
  assert.ok(r.body.emailWaiting >= 1);
  const [held] = await forCustomer(c.id);
  assert.equal(held.email.state, 'queued');
  assert.equal(mailTo('fu.capped@example.com').length, 0);
  await call('PUT', '/crm/follow-ups/settings', settings);
  await run();
  assert.equal((await forCustomer(c.id))[0].status, 'sent');
  assert.equal(mailTo('fu.capped@example.com').length, 1);
});

test("Jacob's actions: edit, snooze, I texted them, skip, reopen, and his own reminders", async () => {
  const [rb] = await forCustomer(people.rebook.id);
  const edited = await call('PATCH', `/crm/follow-ups/${rb.id}`, { message: 'Hey Fu, ready for another wash?' });
  assert.equal(edited.body.message, 'Hey Fu, ready for another wash?');

  const snoozed = await call('POST', `/crm/follow-ups/${rb.id}/snooze`, { days: 7 });
  assert.equal(snoozed.body.dueDate, day(7));
  const list = (await call('GET', '/crm/follow-ups')).body;
  assert.ok(list.upcoming.some((f: any) => f.id === rb.id));
  assert.ok(!list.due.some((f: any) => f.id === rb.id));

  const texted = await call('POST', `/crm/follow-ups/${rb.id}/texted`);
  assert.equal(texted.status, 200);
  assert.equal(texted.body.status, 'done');
  assert.equal(texted.body.channel, 'text');
  assert.equal((await call('POST', `/crm/follow-ups/${rb.id}/texted`)).status, 409);
  assert.equal((await call('POST', `/crm/follow-ups/${rb.id}/reopen`)).body.status, 'open');
  assert.equal((await call('POST', `/crm/follow-ups/${rb.id}/done`, { how: 'call' })).body.status, 'done');

  const mine = await call('POST', '/crm/follow-ups', { customerId: people.booked.id, title: 'Call Fu back about the boat', dueDate: day(2) });
  assert.equal(mine.status, 201);
  assert.equal(mine.body.kind, 'custom');
  assert.equal(mine.body.customer.name, 'Fu Booked');
  assert.equal((await call('POST', `/crm/follow-ups/${mine.body.id}/skip`)).body.status, 'skipped');
  const done = (await call('GET', '/crm/follow-ups')).body.done;
  assert.ok(done.some((f: any) => f.id === mine.body.id));

  assert.equal((await call('POST', '/crm/follow-ups', { title: '' })).status, 422);
  const [rg] = await forCustomer(people.regular.id);
  assert.equal((await call('POST', `/crm/follow-ups/${rg.id}/snooze`, { days: 0 })).status, 422);
  assert.equal((await call('GET', '/crm/follow-ups/nope')).status, 404);
  assert.equal((await call('GET', '/crm/follow-ups', undefined, {})).status, 401);
});

test('unsubscribing from the link, one-click from a mail app, and it sticks', async () => {
  const link = mailTo('fu.lapsed@example.com')[0]!.text.match(/\?t=([A-Za-z0-9_-]+)/)![1]!;
  const seen = await call('GET', `/crm/public/unsubscribe/${link}`, undefined, {});
  assert.equal(seen.status, 200);
  assert.deepEqual(seen.body, { firstName: 'Fu', email: 'f•••d@example.com', unsubscribed: false });

  // One-click (RFC 8058): a form post with no session.
  const res = await fetch(`${API}/v1/crm/public/unsubscribe/${link}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'List-Unsubscribe=One-Click',
  });
  assert.equal(res.status, 200);
  assert.equal((await call('GET', `/crm/public/unsubscribe/${link}`, undefined, {})).body.unsubscribed, true);
  assert.equal((await call('POST', `/crm/public/unsubscribe/${link}`, undefined, {})).status, 200, 'twice is fine');
  assert.equal((await call('GET', '/crm/public/unsubscribe/not-a-real-token-at-all-000', undefined, {})).status, 404);

  // Their next follow-up is a text, not an email.
  await job(people.lapsed.id, -1);
  await run();
  const next = (await forCustomer(people.lapsed.id)).find((f: any) => f.kind === 'review' || f.kind === 'thank_you');
  assert.equal(next.channel, 'text');
  assert.equal(next.email, null);
  assert.equal(mailTo('fu.lapsed@example.com').length, 1);

  // Changed their mind.
  assert.equal((await call('POST', `/crm/public/unsubscribe/${link}/undo`, undefined, {})).body.unsubscribed, false);
});
