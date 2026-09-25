import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

// CRM insights (docs/crm.md, part 3). Jobs live in 2019 and 2020, which no
// other suite uses, so every period number here is exact. The Worker's
// ANTHROPIC_URL points at the fake Claude API below.
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

/* ----------------------------------------------------- fake Claude API */

const asked: { headers: Record<string, string | string[] | undefined>; body: any }[] = [];
/** What the fake answers next; the default is a good note. */
const replies: { status: number; body: unknown }[] = [];
const goodNote = {
  id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5', stop_reason: 'end_turn',
  content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'How last week went:\nA good week.\n\nDo these 3 things this week:\n- One\n- Two\n- Three\n\nStop doing this:\n- Waiting.' }],
  usage: { input_tokens: 2100, output_tokens: 640 },
};
const claude = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    asked.push({ headers: req.headers, body: JSON.parse(raw) });
    const next = replies.shift() ?? { status: 200, body: goodNote };
    res.statusCode = next.status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(next.body));
  });
});
await new Promise<void>((r) => claude.listen(Number(process.env.ANTHROPIC_PORT), r));
after(() => claude.close());

/* ----------------------------------------------------------- seed data */

const at = (d: string) => `${d}T15:00:00.000Z`;
const car = (addOns: string[] = []) => ({ service: 'level-1', vehicleClass: 'sedan', conditions: {}, addOns });

async function job(who: object, day: string, price: number | null, extra: Record<string, unknown> = {}) {
  const { input = car(), status = 'done', ...rest } = extra;
  const r = await call('POST', '/jobs', { ...who, input, start: at(day), address: '1 Insight Rd', zip: '63025', ...rest });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const patch: Record<string, unknown> = { status };
  if (price !== null) patch.finalPrice = price;
  assert.equal((await call('PATCH', `/jobs/${r.body.job.id}`, patch)).status, 200);
  return r.body.job;
}

const ids: Record<string, string> = {};

test('seed: a year of jobs in 2020 and one in 2019', async () => {
  const a = await job({ customer: { name: 'Ins Alpha', phone: '314-555-9101' }, source: 'maps' }, '2020-03-03', 30000, { input: car(['headlights']) });
  ids.alpha = a.customerId ?? a.customer?.id;
  if (!ids.alpha) ids.alpha = (await call('GET', `/crm/customers?segment=${encodeURIComponent(JSON.stringify({ q: 'Ins Alpha' }))}`)).body.customers[0].id;
  await job({ customerId: ids.alpha }, '2020-06-02', 30000);
  await job({ customerId: ids.alpha }, '2020-09-01', 30000);

  const b = await job({ customer: { name: 'Ins Bravo', phone: '314-555-9102' }, source: 'maps' }, '2020-04-05', 25000);
  await job({ customerId: b.customerId ?? b.customer.id }, '2020-10-05', 25000);

  const c = await job({ customer: { name: 'Ins Charlie', phone: '314-555-9103' }, source: 'instagram' }, '2020-05-05', 10000, { zip: '63088' });
  await job({ customerId: c.customerId ?? c.customer.id }, '2020-08-01', 50000, { zip: '63088', input: { service: 'marine', boatFeet: 20 } });

  const alpha = (await call('GET', `/crm/customers?segment=${encodeURIComponent(JSON.stringify({ q: 'Ins Alpha' }))}`)).body.customers[0];
  ids.alpha = alpha.id;
  await job({ customer: { name: 'Ins Delta', phone: '314-555-9104' }, attribution: { ref: alpha.referralCode } }, '2020-07-07', 20000);

  const e = await job({ customer: { name: 'Ins Echo', phone: '314-555-9105' }, source: 'van' }, '2019-06-01', 15000);
  await job({ customerId: e.customerId ?? e.customer.id }, '2020-08-08', null, { status: 'cancelled' });

  // The books for 2020: money in, and advertising out.
  assert.equal((await call('POST', '/books/income', { date: '2020-06-01', amount: 200000, depositToId: 'checking', memo: 'Insights test' })).status, 201);
  assert.equal((await call('POST', '/books/expenses', { date: '2020-06-01', amount: 30000, categoryId: 'advertising', paidFromId: 'checking', memo: 'Insights ads' })).status, 201);
});

test('marketing spend is added, changed, checked and removed', async () => {
  const bad = await call('POST', '/crm/insights/spend', { month: '2020-13', source: 'maps', amount: 100 });
  assert.equal(bad.status, 422);
  assert.equal((await call('POST', '/crm/insights/spend', { month: '2020-03', source: 'tv', amount: 100 })).status, 422);
  assert.equal((await call('POST', '/crm/insights/spend', { month: '2020-03', source: 'maps', amount: 0 })).status, 422);

  const maps = await call('POST', '/crm/insights/spend', { month: '2020-03', source: 'maps', amount: 5000, note: 'Profile boost' });
  assert.equal(maps.status, 201);
  assert.deepEqual({ ...maps.body, id: undefined, createdAt: undefined, updatedAt: undefined }, {
    id: undefined, month: '2020-03', source: 'maps', amount: 5000, note: 'Profile boost', createdAt: undefined, updatedAt: undefined,
  });
  const changed = await call('PATCH', `/crm/insights/spend/${maps.body.id}`, { amount: 10000 });
  assert.equal(changed.body.amount, 10000);
  assert.equal(changed.body.source, 'maps', 'untouched fields stay');

  const ig = await call('POST', '/crm/insights/spend', { month: '2020-05', source: 'instagram', amount: 5000 });
  const gone = await call('POST', '/crm/insights/spend', { month: '2020-05', source: 'facebook', amount: 700 });
  assert.equal((await call('DELETE', `/crm/insights/spend/${gone.body.id}`)).status, 204);
  assert.equal((await call('DELETE', `/crm/insights/spend/${gone.body.id}`)).status, 404);
  assert.equal((await call('PATCH', '/crm/insights/spend/nope', { amount: 5 })).status, 404);

  const listed = (await call('GET', '/crm/insights/spend?from=2020-01&to=2020-12')).body.spend;
  assert.deepEqual(listed.map((s: any) => s.id).sort(), [maps.body.id, ig.body.id].sort());
  assert.equal((await call('GET', '/crm/insights/spend', undefined, {})).status, 401);
});

test('a year of numbers, each counted the way the notes say', async () => {
  const r = await call('GET', '/crm/insights?from=2020-01-01&to=2020-12-31');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const d = r.body;
  assert.deepEqual(d.period.compare, { from: '2019-01-01', to: '2019-12-31' }, 'the same length just before');

  // Money: 8 done jobs, the cancelled one left out.
  const m = d.money.cur;
  assert.equal(m.jobs, 8);
  assert.equal(m.revenue, 220000);
  assert.equal(m.avgTicket, 27500);
  assert.equal(m.workDays, 8);
  assert.equal(m.customers, 4);
  assert.equal(m.addonRate, 1 / 8);
  assert.equal(m.cancelled, 1);
  assert.equal(m.cancelRate, 1 / 9);
  assert.equal(m.phone, 8, 'jobs Jacob added count as phone bookings');
  assert.equal(d.money.prev.jobs, 1);
  assert.equal(d.money.prev.revenue, 15000);
  assert.deepEqual(d.money.craft, { boats: { jobs: 1, revenue: 50000 }, cars: { jobs: 7, revenue: 170000 } });
  assert.deepEqual(d.money.addOns.map((a: any) => [a.id, a.jobs, a.revenue]), [['headlights', 1, 8000]]);
  const tuneUp = d.money.services.find((s: any) => s.service === 'level-1');
  assert.equal(tuneUp.jobs, 7);
  assert.equal(tuneUp.addonJobs, 1);
  assert.equal(d.money.byMonth.find((x: any) => x.month === '2020-06').revenue, 30000);
  assert.equal(d.money.byMonth.find((x: any) => x.month === '2020-02').revenue, 0, 'empty months are there, as zero');

  // Books: collected and advertising for the year.
  assert.equal(d.money.books.collected, 200000);
  assert.equal(d.money.books.advertising, 30000);
  assert.equal(d.money.books.profit, 170000);

  // Customers.
  assert.equal(d.customers.new, 4);
  assert.equal(d.customers.newPrev, 1);
  assert.equal(d.customers.returning, 0, 'Echo only cancelled in 2020');
  const top = d.customers.top;
  assert.equal(top[0].name, 'Ins Alpha');
  assert.equal(top[0].spend, 90000);
  assert.equal(top[0].visits, 3);
  assert.deepEqual(top.map((t: any) => t.name), ['Ins Alpha', 'Ins Charlie', 'Ins Bravo', 'Ins Delta']);
  assert.deepEqual(d.customers.top20, { count: 1, of: 4, revenue: 90000, share: 90000 / 220000 });

  // Sources: spend per channel against the customers it brought.
  const maps = d.sources.find((s: any) => s.source === 'maps');
  assert.equal(maps.newCustomers, 2);
  assert.equal(maps.revenue, 140000);
  assert.equal(maps.spend, 10000);
  assert.equal(maps.costPerCustomer, 5000);
  assert.equal(maps.returnOnSpend, 14);
  const ig = d.sources.find((s: any) => s.source === 'instagram');
  assert.equal(ig.costPerCustomer, 5000);
  assert.equal(ig.returnOnSpend, 12);
  const ref = d.sources.find((s: any) => s.source === 'referral');
  assert.equal(ref.newCustomers, 1, 'a ref code makes it a referral');
  assert.equal(d.spend.total, 15000);
  assert.equal(d.spend.booksAdvertising, 30000);
  assert.equal(d.spend.notSplit, 15000);
  const alpha = d.referrers.find((x: any) => x.id === ids.alpha);
  assert.deepEqual([alpha.referrals, alpha.referredRevenue], [1, 20000]);

  // Where: this period's revenue by ZIP, with the town and the drive.
  const eureka = d.zips.find((z: any) => z.zip === '63025');
  assert.equal(eureka.periodRevenue, 160000);
  assert.equal(eureka.periodJobs, 6);
  assert.equal(eureka.town, 'Eureka');
  assert.equal(eureka.miles, 6, 'straight line from High Ridge');
  assert.equal(d.zips.find((z: any) => z.zip === '63088').periodRevenue, 60000);

  // Actions: each with a type, the number behind it and somewhere to go, ranked by dollars.
  const types = ['reviews', 'rebook', 'area', 'pricing', 'schedule', 'channel', 'referral', 'upsell', 'leads'];
  assert.ok(d.actions.length > 0);
  for (const a of d.actions) {
    assert.ok(types.includes(a.type), a.type);
    assert.ok(a.title && a.detail && a.target.tab && a.target.label, JSON.stringify(a));
    assert.ok(a.impact === null || Number.isInteger(a.impact));
  }
  const worth = d.actions.map((a: any) => a.impact ?? -1);
  assert.deepEqual(worth, [...worth].sort((a: number, b: number) => b - a));
  assert.ok(d.actions.some((a: any) => a.id === 'referral-thanks' || a.type === 'referral'));
});

test('without compare there is no previous period, and bad periods are refused', async () => {
  const r = await call('GET', '/crm/insights?from=2020-01-01&to=2020-12-31&compare=0');
  assert.equal(r.body.period.compare, null);
  assert.equal(r.body.money.prev, null);
  assert.equal(r.body.money.cur.jobs, 8);
  const cmp = async (q: string) => (await call('GET', `/crm/insights?${q}`)).body.period.compare;
  assert.deepEqual(await cmp('from=2020-03-01&to=2020-03-20'), { from: '2020-02-01', to: '2020-02-20' }, 'this month so far: same days last month');
  assert.deepEqual(await cmp('from=2020-01-01&to=2020-06-30'), { from: '2019-01-01', to: '2019-06-30' }, 'the year so far: same dates last year');
  assert.deepEqual(await cmp('from=2020-03-01&to=2020-03-31'), { from: '2020-02-01', to: '2020-02-29' }, 'a whole month: the whole month before');
  assert.deepEqual(await cmp('from=2020-01-05&to=2020-01-11'), { from: '2019-12-29', to: '2020-01-04' }, 'a week: the week before');
  assert.equal((await call('GET', '/crm/insights?from=2020-12-31&to=2020-01-01')).status, 422);
  assert.equal((await call('GET', '/crm/insights?from=2020-1-1')).status, 422);
  assert.equal((await call('GET', '/crm/insights?from=2010-01-01&to=2020-01-01')).status, 422);
  assert.equal((await call('GET', '/crm/insights', undefined, {})).status, 401);
});

test('quote requests count by source, and booking one counts it as booked', async () => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
  const read = async () => (await call('GET', `/crm/insights?from=${today}&to=${today}&compare=0`)).body;
  const before = await read();
  const nd = (d: any) => d.sources.find((s: any) => s.source === 'nextdoor') ?? { leads: 0, leadsBooked: 0 };
  const input = car();
  await call('POST', '/leads', { name: 'Ins Lead One', phone: '314-555-9201', zip: '63025', input, source: 'nextdoor' }, {});
  await call('POST', '/leads', { name: 'Ins Lead Two', phone: '314-555-9202', zip: '63025', input, source: 'nextdoor' }, {});
  const mid = await read();
  assert.equal(nd(mid).leads - nd(before).leads, 2);
  assert.equal(mid.pipeline.openQuotes.count - before.pipeline.openQuotes.count, 2);

  const one = (await call('GET', `/crm/customers?segment=${encodeURIComponent(JSON.stringify({ q: 'Ins Lead One' }))}`)).body.customers[0];
  await call('POST', '/jobs', { customerId: one.id, input, start: '2045-06-01T15:00:00.000Z', address: '2 Insight Rd' });
  const after = await read();
  assert.equal(nd(after).leadsBooked - nd(before).leadsBooked, 1);
  assert.equal(after.pipeline.openQuotes.count - before.pipeline.openQuotes.count, 1, 'a booked one is no longer waiting');
});

test('the weekly note: Claude writes it from totals and first names only', async () => {
  // A big recent job, so this customer is among the best of the last 90 days.
  const day = new Date(Date.now() - 20 * 864e5).toISOString().slice(0, 10);
  await job({ customer: { name: 'Zed Privacyson', phone: '314-555-8899', email: 'zed@example.com' } }, day, 900000, { address: '77 Secretive Lane' });

  asked.length = 0;
  const r = await call('POST', '/crm/insights/summary');
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.source, 'claude');
  assert.match(r.body.body, /Do these 3 things this week/);
  assert.equal(r.body.inputTokens, 2100);
  assert.equal(r.body.outputTokens, 640);
  assert.match(r.body.weekStart, /^\d{4}-\d{2}-\d{2}$/);

  assert.equal(asked.length, 1);
  const req = asked[0]!;
  assert.equal(req.headers['x-api-key'], 'test');
  assert.equal(req.headers['anthropic-version'], '2023-06-01');
  assert.equal(req.body.model, 'claude-opus-5');
  assert.ok(req.body.max_tokens <= 4000);
  const sent = JSON.stringify(req.body);
  assert.match(sent, /Zed/, 'first names are fine');
  for (const secret of ['Privacyson', '8899', 'zed@example.com', 'Secretive']) assert.ok(!sent.includes(secret), `${secret} must not reach the API`);

  const listed = (await call('GET', '/crm/insights/summary')).body;
  assert.equal(listed.summaries[0].id, r.body.id, 'newest first');
  assert.equal(listed.claude, true);
});

test('the weekly note falls back to the rules when Claude fails, and retries without fallbacks on a 400', async () => {
  asked.length = 0;
  replies.push({ status: 500, body: { type: 'error', error: { type: 'api_error', message: 'down' } } }, { status: 500, body: {} });
  const down = await call('POST', '/crm/insights/summary');
  assert.equal(down.status, 201);
  assert.equal(down.body.source, 'rules');
  assert.match(down.body.note, /Claude answered 500/);
  assert.match(down.body.body, /How last week went:/);
  assert.match(down.body.body, /Do these 3 things this week:/);
  assert.match(down.body.body, /Stop doing this:/);
  replies.length = 0;

  asked.length = 0;
  replies.push({ status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'fallbacks' } } });
  const retried = await call('POST', '/crm/insights/summary');
  assert.equal(retried.body.source, 'claude');
  assert.equal(asked.length, 2);
  assert.equal(asked[0]!.body.fallbacks, 'default');
  assert.equal(asked[1]!.body.fallbacks, undefined);

  replies.push({ status: 200, body: { ...goodNote, stop_reason: 'refusal', content: [] } });
  const refused = await call('POST', '/crm/insights/summary');
  assert.equal(refused.body.source, 'rules');
  assert.equal((await call('POST', '/crm/insights/summary', undefined, {})).status, 401);
});
