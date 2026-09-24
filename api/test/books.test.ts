import { test } from 'node:test';
import assert from 'node:assert/strict';

// Run through `npm test`, which starts a local Worker with an empty D1.
const API = process.env.API!;
const admin = { Authorization: `Bearer ${process.env.ADMIN_TOKEN}` };

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = admin) {
  const res = await fetch(`${API}/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await res.text();
  const isJson = res.headers.get('content-type')?.includes('json');
  return { status: res.status, headers: res.headers, raw, body: (isJson && raw ? JSON.parse(raw) : null) as any };
}

// The whole suite works in one fictional year so it can't collide with the
// booking tests' jobs.
const Y = '2031';

test('the chart of accounts is seeded, and new accounts get sensible ids', async () => {
  const { body } = await call('GET', '/books/accounts');
  const ids = body.accounts.map((a: any) => a.id);
  assert.ok(ids.includes('checking') && ids.includes('supplies') && ids.includes('income-detailing'));

  const savings = await call('POST', '/books/accounts', { name: 'Business Savings', type: 'asset', moneyAccount: true });
  assert.equal(savings.status, 201);
  assert.equal(savings.body.id, 'business-savings');
  const again = await call('POST', '/books/accounts', { name: 'Business Savings', type: 'asset', moneyAccount: true });
  assert.equal(again.body.id, 'business-savings-2');
  const archived = await call('PATCH', '/books/accounts/business-savings-2', { archived: true });
  assert.equal(archived.body.archived, true);
  assert.ok(!(await call('GET', '/books/accounts')).body.accounts.some((a: any) => a.id === 'business-savings-2'));
});

test('getting paid, buying supplies, paying a helper, taking a draw', async () => {
  const paid = await call('POST', '/books/income', { date: `${Y}-03-02`, amount: 27500, depositToId: 'checking', method: 'zelle', memo: 'Level II, Tahoe' });
  assert.equal(paid.status, 201);
  assert.deepEqual(paid.body.lines, [
    { accountId: 'checking', amount: 27500 },
    { accountId: 'income-detailing', amount: -27500 },
  ]);

  const supplies = await call('POST', '/books/expenses', {
    date: `${Y}-03-03`, amount: 8910, categoryId: 'supplies', paidFromId: 'credit-card', payee: { name: 'Chemical Guys' },
  });
  assert.equal(supplies.status, 201);
  assert.equal(supplies.body.payee.name, 'Chemical Guys');
  // Same payee name, any case: reused, not duplicated.
  const more = await call('POST', '/books/expenses', {
    date: `${Y}-03-10`, amount: 2500, categoryId: 'supplies', paidFromId: 'checking', payee: { name: 'chemical guys' },
  });
  assert.equal(more.body.payee.id, supplies.body.payee.id);

  const helper = await call('POST', '/books/payees', { name: 'Tyler Helper', kind: 'contractor' });
  for (const [date, amount] of [[`${Y}-04-01`, 40000], [`${Y}-05-01`, 30000]] as const) {
    assert.equal((await call('POST', '/books/expenses', { date, amount, categoryId: 'contract-labor', paidFromId: 'checking', payeeId: helper.body.id })).status, 201);
  }
  assert.equal((await call('POST', '/books/transfers', { date: `${Y}-03-31`, amount: 10000, fromId: 'checking', toId: 'owner-draws' })).status, 201);
});

test('bad entries are refused with a reason', async () => {
  const cases = [
    { amount: 12.5, categoryId: 'supplies', paidFromId: 'checking' },
    { amount: 100, categoryId: 'income-detailing', paidFromId: 'checking' },
    { amount: 100, categoryId: 'supplies', paidFromId: 'owner-draws' },
    { amount: 100, categoryId: 'nope', paidFromId: 'checking' },
  ];
  for (const c of cases) {
    const r = await call('POST', '/books/expenses', { date: `${Y}-03-01`, ...c });
    assert.equal(r.status, 422, JSON.stringify(c));
  }
  assert.equal((await call('POST', '/books/expenses', { date: '03/01/2031', amount: 100, categoryId: 'supplies', paidFromId: 'checking' })).status, 422);
});

test('profit and loss and balances add up', async () => {
  const pl = (await call('GET', `/books/reports/profit-loss?from=${Y}-01-01&to=${Y}-12-31`)).body;
  assert.equal(pl.totalIncome, 27500);
  assert.equal(pl.totalExpenses, 8910 + 2500 + 70000);
  assert.equal(pl.net, 27500 - 81410);
  assert.deepEqual(pl.scheduleC.map((r: any) => r.line), ['1', '11', '22']);

  const bal = (await call('GET', `/books/reports/balances?asOf=${Y}-12-31`)).body.accounts;
  const of = (id: string) => bal.find((a: any) => a.accountId === id).balance;
  assert.equal(of('checking'), 27500 - 2500 - 70000 - 10000);
  assert.equal(of('credit-card'), 8910);
});

test('voiding posts a reversal, keeps history, and cannot happen twice', async () => {
  const e = await call('POST', '/books/expenses', { date: `${Y}-06-01`, amount: 1234, categoryId: 'meals', paidFromId: 'cash' });
  const v = await call('POST', `/books/entries/${e.body.id}/void`, {});
  assert.equal(v.status, 201);
  assert.equal(v.body.kind, 'reversal');
  assert.equal(v.body.reverses, e.body.id);
  assert.equal((await call('GET', `/books/entries/${e.body.id}`)).body.voidedBy, v.body.id);
  assert.equal((await call('POST', `/books/entries/${e.body.id}/void`, {})).status, 409);
  assert.equal((await call('POST', `/books/entries/${v.body.id}/void`, {})).status, 409);
  const june = (await call('GET', `/books/reports/profit-loss?from=${Y}-06-01&to=${Y}-06-30`)).body;
  assert.equal(june.totalExpenses, 0);
});

test('bank import: reads the file, matches what is already booked, skips duplicates on re-import', async () => {
  const csv = [
    'Date,Description,Amount',
    `03/03/${Y},ZELLE FROM T. OWNER,275.00`, // the Level II payment, a day late
    `03/10/${Y},CHEMICAL GUYS ONLINE,-25.00`, // the second supplies purchase
    `03/12/${Y},SHELL OIL 1234,-61.40`, // new: fuel
    `03/15/${Y},PAYMENT TO CREDIT CARD,-89.10`, // new: a transfer
    `03/20/${Y},MYSTERY FEE,-3.00`, // new: to ignore
  ].join('\n');
  const first = await call('POST', '/books/bank-imports', { accountId: 'checking', csv, filename: 'march.csv' });
  assert.equal(first.status, 201, first.raw);
  assert.equal(first.body.added, 5);
  assert.equal(first.body.matched, 2);
  assert.equal(first.body.waiting, 3);

  const again = await call('POST', '/books/bank-imports', { accountId: 'checking', csv });
  assert.equal(again.body.added, 0);
  assert.equal(again.body.duplicates, 5);

  assert.equal((await call('POST', '/books/bank-imports', { accountId: 'supplies', csv })).status, 422);
  assert.equal((await call('POST', '/books/bank-imports', { accountId: 'checking', csv: 'hello,world\n1,2' })).status, 422);
});

test('waiting bank lines: categorize, transfer, ignore', async () => {
  const waiting = (await call('GET', '/books/bank-lines?status=unmatched&accountId=checking')).body.lines;
  const by = (desc: string) => waiting.find((l: any) => l.description.includes(desc));

  const fuel = await call('POST', `/books/bank-lines/${by('SHELL').id}`, { action: 'categorize', categoryId: 'fuel', payee: { name: 'Shell' } });
  assert.equal(fuel.status, 200, fuel.raw);
  assert.equal(fuel.body.status, 'matched');
  const entry = (await call('GET', `/books/entries/${fuel.body.entryId}`)).body;
  assert.deepEqual(entry.lines, [
    { accountId: 'fuel', amount: 6140 },
    { accountId: 'checking', amount: -6140 },
  ]);
  assert.equal(entry.date, `${Y}-03-12`);

  const card = await call('POST', `/books/bank-lines/${by('CREDIT CARD').id}`, { action: 'transfer', otherAccountId: 'credit-card' });
  assert.equal(card.body.status, 'matched');

  const fee = await call('POST', `/books/bank-lines/${by('MYSTERY').id}`, { action: 'ignore' });
  assert.equal(fee.body.status, 'ignored');
  assert.equal((await call('POST', `/books/bank-lines/${by('MYSTERY').id}`, { action: 'ignore' })).status, 409);
  assert.equal((await call('POST', `/books/bank-lines/${by('MYSTERY').id}`, { action: 'unignore' })).body.status, 'unmatched');

  // Paying the card also cleared its balance.
  const bal = (await call('GET', `/books/reports/balances?asOf=${Y}-12-31`)).body.accounts;
  assert.equal(bal.find((a: any) => a.accountId === 'credit-card').balance, 0);
});

test('voiding a matched entry frees its bank line to be matched again', async () => {
  const line = (await call('GET', '/books/bank-lines?status=matched&accountId=checking')).body.lines.find((l: any) => l.description.includes('SHELL'));
  await call('POST', `/books/entries/${line.entryId}/void`, {});
  const after = (await call('GET', '/books/bank-lines?status=unmatched&accountId=checking')).body.lines;
  assert.ok(after.some((l: any) => l.id === line.id));
});

test('mileage: trips, the deduction at the year rate, and settings', async () => {
  await call('POST', '/books/trips', { date: `${Y}-03-02`, miles: 18.4, purpose: 'Level II in Fenton', from: 'High Ridge', to: 'Fenton' });
  await call('POST', '/books/trips', { date: `${Y}-03-05`, miles: 32, purpose: 'Supply run' });
  assert.equal((await call('POST', '/books/trips', { date: `${Y}-03-05`, miles: 5 })).status, 422, 'purpose required');

  let m = (await call('GET', `/books/reports/mileage?year=${Y}`)).body;
  assert.equal(m.miles, 50.4);
  assert.equal(m.deduction, null, 'no rate for this year yet');

  const s = (await call('GET', '/settings/books')).body.settings;
  assert.equal((await call('PUT', '/settings/books', { ...s, mileageRates: { ...s.mileageRates, [Y]: 80 } })).status, 200);
  m = (await call('GET', `/books/reports/mileage?year=${Y}`)).body;
  assert.equal(m.deduction, 4032);
  assert.equal((await call('PUT', '/settings/books', { ...s, salesTax: { enabled: true, rate: 99 } })).status, 422);
});

test('contractors over the threshold are flagged for a 1099', async () => {
  const r = (await call('GET', `/books/reports/contractors?year=${Y}`)).body;
  assert.equal(r.contractors.length, 1);
  assert.equal(r.contractors[0].name, 'Tyler Helper');
  assert.equal(r.contractors[0].total, 70000);
  assert.equal(r.contractors[0].needs1099, true);
});

test('year-end exports download as CSV', async () => {
  const ledger = await call('GET', `/books/export/ledger?from=${Y}-01-01&to=${Y}-12-31`);
  assert.equal(ledger.status, 200);
  assert.match(ledger.headers.get('content-type')!, /text\/csv/);
  assert.match(ledger.headers.get('content-disposition')!, new RegExp(`ked-general-ledger-${Y}-01-01`));
  assert.match(ledger.raw, /^Date,Entry,Type,Memo/);
  assert.match(ledger.raw, /Chemical Guys/);

  const pl = await call('GET', `/books/export/profit-loss?from=${Y}-01-01&to=${Y}-12-31`);
  assert.match(pl.raw, /Net profit/);
  assert.match((await call('GET', `/books/export/mileage?year=${Y}`)).raw, /Total miles,50\.4/);
  assert.match((await call('GET', `/books/export/contractors?year=${Y}`)).raw, /Tyler Helper,700\.00,No,Yes/);
  assert.equal((await call('GET', '/books/export/nope')).status, 404);
});

test('the books are owner-only', async () => {
  for (const path of ['/books/accounts', '/books/entries', '/books/reports/profit-loss', '/books/export/ledger', '/settings/books']) {
    assert.equal((await call('GET', path, undefined, {})).status, 401, path);
  }
});
