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

test('customers: matched by phone or email, including repeats within one chunk, and gaps filled', async () => {
  const first = await call('POST', '/import/customers', {
    customers: [
      { name: 'Hana Housecall', phone: '(314) 555-0801', email: 'HANA@example.com' },
      { name: 'Hana H.', phone: '314.555.0801', address: '7 Maple Dr' }, // same phone
      { name: 'Ivan Import', email: 'ivan@example.com', notes: 'Gate code 1234' },
    ],
  });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.deepEqual(first.body, { added: 2, matched: 1 });

  const again = await call('POST', '/import/customers', { customers: [{ name: 'Ivan I', email: 'ivan@example.com', phone: '314-555-0802' }] });
  assert.deepEqual(again.body, { added: 0, matched: 1 });

  const hana = (await call('GET', '/customers?q=5550801')).body.customers;
  assert.equal(hana.length, 1);
  assert.equal(hana[0].name, 'Hana Housecall', 'the first name wins; later rows only fill gaps');
  assert.equal(hana[0].address, '7 Maple Dr');
  assert.equal(hana[0].email, 'hana@example.com');
  const ivan = (await call('GET', '/customers?q=ivan@example.com')).body.customers[0];
  assert.equal(ivan.phone, '314-555-0802');

  assert.equal((await call('POST', '/import/customers', { customers: Array(21).fill({ name: 'X' }) })).status, 422);
  assert.equal((await call('POST', '/import/customers', { customers: [{ phone: '1' }] })).status, 422);
  assert.equal((await call('POST', '/import/customers', { customers: [] }, {})).status, 401);
});

test('jobs: upcoming ones land on the calendar, past ones are quiet history, and re-running adds nothing', async () => {
  const future = new Date(Date.now() + 10 * 864e5);
  future.setUTCHours(15, 0, 0, 0);
  const past = new Date(Date.now() - 10 * 864e5);
  past.setUTCHours(15, 0, 0, 0);
  const hours = (d: Date, h: number) => new Date(d.getTime() + h * 36e5).toISOString();
  const jobs = [
    { ref: '1001', customer: { name: 'Jules Upcoming', phone: '314-555-0803' }, address: '1 Future Way',
      start: future.toISOString(), end: hours(future, 3), status: 'scheduled', total: 22500, description: 'Full detail' },
    { ref: '0998', customer: { name: 'Kit History', phone: '314-555-0804' }, address: '2 Past Pl',
      start: past.toISOString(), end: hours(past, 2), status: 'scheduled', total: 15000, description: 'Interior' },
    { ref: '0997', customer: { name: 'Kit History', phone: '314-555-0804' }, address: '2 Past Pl',
      start: hours(past, -48), status: 'cancelled', description: 'Wash' },
  ];
  const first = await call('POST', '/import/jobs', { jobs });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.deepEqual(first.body, { added: 3, skipped: 0 });
  assert.deepEqual((await call('POST', '/import/jobs', { jobs })).body, { added: 0, skipped: 3 });

  const listed = (await call('GET', `/jobs?from=${hours(past, -72)}&to=${hours(future, 24)}`)).body.jobs;
  const upcoming = listed.find((j: any) => j.importedFrom === 'hcp:1001');
  assert.equal(upcoming.status, 'scheduled');
  assert.equal(upcoming.history, false);
  assert.equal(upcoming.service, 'imported');
  assert.deepEqual(upcoming.quote.lines, [{ label: 'Full detail', amount: 22500 }]);
  assert.ok(upcoming.manageToken, 'imported bookings get a customer link too');

  const old = listed.find((j: any) => j.importedFrom === 'hcp:0998');
  assert.equal(old.status, 'done', 'past work is done, whatever HCP last called it');
  assert.equal(old.history, true);
  assert.equal(old.finalPrice, 15000);
  assert.equal(listed.find((j: any) => j.importedFrom === 'hcp:0997').status, 'cancelled');

  const kit = (await call('GET', '/customers?q=5550804')).body.customers;
  assert.equal(kit.length, 1, 'one customer for both of their jobs');

  const inbox = (await call('GET', '/books/inbox')).body;
  assert.ok(!inbox.unpaidJobs.some((j: any) => j.jobId === old.id), 'history never asks for payment');
  assert.ok(!inbox.tripsToLog.some((j: any) => j.jobId === old.id), 'or for mileage');

  assert.equal((await call('POST', '/import/jobs', { jobs: [{ ...jobs[0], ref: '' }] })).status, 422);
  assert.equal((await call('POST', '/import/jobs', { jobs: [{ ...jobs[0], ref: '5', total: 1.5 }] })).status, 422);
});

test('entries: mapped QuickBooks transactions post once, with the right kind and vendor', async () => {
  const entries = [
    { ref: 'a1', date: '2037-01-05', memo: 'Invoice 12', payee: 'Some Customer',
      lines: [{ accountId: 'checking', amount: 20000 }, { accountId: 'income-detailing', amount: -20000 }] },
    { ref: 'a2', date: '2037-01-06', memo: 'Chemicals', payee: 'Chemical Guys',
      lines: [{ accountId: 'supplies', amount: 4500 }, { accountId: 'credit-card', amount: -4500 }] },
    { ref: 'a3', date: '2037-01-07', lines: [{ accountId: 'credit-card', amount: 4500 }, { accountId: 'checking', amount: -4500 }] },
  ];
  const first = await call('POST', '/import/entries', { entries });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.deepEqual(first.body, { added: 3, skipped: 0 });
  assert.deepEqual((await call('POST', '/import/entries', { entries })).body, { added: 0, skipped: 3 });

  const posted = (await call('GET', '/books/entries?from=2037-01-01&to=2037-01-31')).body.entries;
  assert.deepEqual(posted.map((e: any) => e.kind), ['transfer', 'expense', 'income']);
  assert.equal(posted[1].payee.name, 'Chemical Guys');
  assert.equal(posted[2].payee, null, "customers don't become vendors");
  assert.deepEqual(posted[2].lines, [{ accountId: 'checking', amount: 20000 }, { accountId: 'income-detailing', amount: -20000 }]);

  const pl = (await call('GET', '/books/reports/profit-loss?from=2037-01-01&to=2037-12-31')).body;
  assert.equal(pl.totalIncome, 20000);
  assert.equal(pl.net, 20000 - 4500);

  const unbalanced = await call('POST', '/import/entries', {
    entries: [{ ref: 'bad', date: '2037-02-01', lines: [{ accountId: 'checking', amount: 100 }, { accountId: 'supplies', amount: -90 }] }],
  });
  assert.equal(unbalanced.status, 422);
  assert.match(unbalanced.body.error.message, /bad/);
  const unknown = await call('POST', '/import/entries', {
    entries: [{ ref: 'bad2', date: '2037-02-01', lines: [{ accountId: 'checking', amount: 100 }, { accountId: 'nope', amount: -100 }] }],
  });
  assert.equal(unknown.status, 422);
});
