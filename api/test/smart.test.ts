import { test } from 'node:test';
import assert from 'node:assert/strict';

// Run through `npm test`, which starts a local Worker with an empty D1.
const API = process.env.API!;
const auth = { Authorization: `Bearer ${process.env.ADMIN_TOKEN}` };

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...auth },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await res.text();
  return { status: res.status, raw, body: raw ? JSON.parse(raw) : null };
}

/** A Commerce-style QFX statement for the smart tests' own year. */
const qfx = (txns: [string, string, string, string][]) => `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
${txns.map(([id, date, amount, name]) => `<STMTTRN>\n<TRNTYPE>OTHER\n<DTPOSTED>${date}\n<TRNAMT>${amount}\n<FITID>${id}\n<NAME>${name}\n</STMTTRN>`).join('\n')}
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

const lines = async () => (await call('GET', `/books/bank-lines?accountId=${ACCT}`)).body.lines as any[];
const byId = async (fitDesc: string) => (await lines()).find((l) => l.description === fitDesc);

let jobId = '';
/** Its own bank account, so lines left waiting by other suites don't count here. */
let ACCT = '';

test('setup: no learned rules yet, and a finished job that has not been paid', async () => {
  // Earlier suites file bank lines too, which teaches rules; start clean.
  for (const r of (await call('GET', '/books/rules')).body.rules) await call('DELETE', `/books/rules/${r.id}`);
  assert.equal((await call('GET', '/books/rules')).body.rules.length, 0);
  ACCT = (await call('POST', '/books/accounts', { name: 'Smart Test Checking', type: 'asset', moneyAccount: true })).body.id;

  const job = await call('POST', '/jobs', {
    customer: { name: 'Dana Deposit', phone: '314-555-0610' },
    address: '8 Birch Ct',
    input: { service: 'level-1', vehicleClass: 'sedan' },
    start: '2033-05-01T14:00:00.000Z',
  });
  assert.equal(job.status, 201, job.raw);
  jobId = job.body.job.id;
  await call('PATCH', `/jobs/${jobId}`, { status: 'done', finalPrice: 16500 });
});

test('first statement: common merchants and a job payment come with suggestions', async () => {
  const r = await call('POST', '/books/bank-imports', {
    accountId: ACCT,
    filename: 'may.qfx',
    file: qfx([
      ['S1', '20330502', '-61.40', 'CHECKCARD 0502 SHELL OIL 57442 FENTON MO'],
      ['S2', '20330503', '165.00', 'MOBILE DEPOSIT'],
      ['S3', '20330504', '-45.99', 'POS DEBIT AUTOZONE #4412 HIGH RIDGE MO'],
      ['S4', '20330505', '-18.20', 'RUBYS DINER FENTON MO'],
      ['S5', '20330512', '-22.75', 'RUBYS DINER ARNOLD MO'],
      ['S6', '20330506', '-120.00', 'VENMO PAYMENT'],
    ]),
  });
  assert.equal(r.status, 201, r.raw);
  assert.equal(r.body.added, 6);
  assert.equal(r.body.filed, 0, 'nothing learned yet');
  assert.equal(r.body.suggested, 3);

  const shell = await byId('CHECKCARD 0502 SHELL OIL 57442 FENTON MO');
  assert.equal(shell.merchant, 'SHELL OIL');
  assert.equal(shell.suggestion.categoryId, 'fuel');
  assert.equal(shell.suggestion.label, 'Looks like Fuel and vehicle costs');
  const deposit = await byId('MOBILE DEPOSIT');
  assert.equal(deposit.suggestion.action, 'job');
  assert.equal(deposit.suggestion.jobId, jobId);
  assert.match(deposit.suggestion.label, /Dana Deposit/);
  assert.equal((await byId('RUBYS DINER FENTON MO')).suggestion, null);

  const again = await call('POST', '/books/bank-imports', { accountId: ACCT, file: qfx([['S1', '20330502', '-61.40', 'SHELL OIL']]) });
  assert.equal(again.body.added, 0, "the bank's IDs stop duplicates even if the text changes");
});

test('accepting a job suggestion records the payment against that job', async () => {
  const deposit = await byId('MOBILE DEPOSIT');
  const r = await call('POST', `/books/bank-lines/${deposit.id}`, { action: 'accept' });
  assert.equal(r.status, 200, r.raw);
  const entry = (await call('GET', `/books/entries/${r.body.entryId}`)).body;
  assert.equal(entry.jobId, jobId);
  assert.deepEqual(entry.lines, [
    { accountId: ACCT, amount: 16500 },
    { accountId: 'income-detailing', amount: -16500 },
  ]);
  const inbox = (await call('GET', '/books/inbox')).body;
  assert.ok(!inbox.unpaidJobs.some((j: any) => j.jobId === jobId), 'no longer unpaid');
});

test('filing one line teaches the books: the next one from that merchant files itself', async () => {
  const fenton = await byId('RUBYS DINER FENTON MO');
  const r = await call('POST', `/books/bank-lines/${fenton.id}`, { action: 'categorize', categoryId: 'meals', payee: { name: "Ruby's Diner" } });
  assert.equal(r.status, 200, r.raw);
  // The Arnold visit was waiting in the same statement and filed itself straight away.
  const arnold = await byId('RUBYS DINER ARNOLD MO');
  assert.equal(arnold.status, 'matched');
  assert.equal(arnold.auto, true);

  // Accepting a starter suggestion teaches too.
  const shell = await byId('CHECKCARD 0502 SHELL OIL 57442 FENTON MO');
  assert.equal((await call('POST', `/books/bank-lines/${shell.id}`, { action: 'accept' })).body.status, 'matched');

  const june = await call('POST', '/books/bank-imports', {
    accountId: ACCT,
    file: qfx([
      ['J1', '20330602', '-55.10', 'SHELL OIL 99812 ARNOLD MO'],
      ['J2', '20330603', '-31.00', 'RUBYS DINER FENTON MO'],
      ['J3', '20330604', '-9.99', 'NEW PLACE'],
    ]),
  });
  assert.equal(june.body.filed, 2);
  assert.equal(june.body.waiting, 3, 'AutoZone and Venmo from May, plus the new place');
  const rules = (await call('GET', '/books/rules')).body.rules;
  const shellRule = rules.find((r: any) => r.merchant === 'SHELL OIL');
  assert.equal(shellRule.categoryId, 'fuel');
  assert.equal(shellRule.hits, 1);
  assert.equal(rules.find((r: any) => r.merchant === 'RUBYS DINER').payee.name, "Ruby's Diner");
});

test('"that was personal" is an owner draw, not an expense, and is remembered too', async () => {
  const venmo = await byId('VENMO PAYMENT');
  const r = await call('POST', `/books/bank-lines/${venmo.id}`, { action: 'personal' });
  const entry = (await call('GET', `/books/entries/${r.body.entryId}`)).body;
  assert.equal(entry.kind, 'transfer');
  assert.deepEqual(entry.lines, [
    { accountId: 'owner-draws', amount: 12000 },
    { accountId: ACCT, amount: -12000 },
  ]);
  const pl = (await call('GET', '/books/reports/profit-loss?from=2033-01-01&to=2033-12-31')).body;
  assert.ok(!pl.expenses.some((e: any) => e.accountId === 'owner-draws'));
});

test('remember: false files once without teaching; forgetting a rule stops auto-filing', async () => {
  const az = await byId('POS DEBIT AUTOZONE #4412 HIGH RIDGE MO');
  await call('POST', `/books/bank-lines/${az.id}`, { action: 'categorize', categoryId: 'supplies', remember: false });
  assert.ok(!(await call('GET', '/books/rules')).body.rules.some((r: any) => r.merchant === 'AUTOZONE'));

  const rule = (await call('GET', '/books/rules')).body.rules.find((r: any) => r.merchant === 'RUBYS DINER');
  assert.equal((await call('DELETE', `/books/rules/${rule.id}`)).status, 204);
  const july = await call('POST', '/books/bank-imports', { accountId: ACCT, file: qfx([['K1', '20330701', '-12.00', 'RUBYS DINER FENTON MO']]) });
  assert.equal(july.body.filed, 0);
});

test('the inbox gathers what needs Jacob: lines, receipts, drives, unpaid jobs', async () => {
  await call('POST', '/books/expenses', { date: new Date().toISOString().slice(0, 10), amount: 25000, categoryId: 'equipment-small', paidFromId: ACCT, memo: 'Extractor' });
  const recent = await call('POST', '/jobs', {
    customer: { name: 'Recent Ron', phone: '314-555-0620' },
    address: '3 Oak St',
    input: { service: 'level-1', vehicleClass: 'sedan' },
    start: new Date(Date.now() - 2 * 864e5).toISOString(),
  });
  await call('PATCH', `/jobs/${recent.body.job.id}`, { status: 'done' });

  const inbox = (await call('GET', '/books/inbox')).body;
  assert.ok(inbox.bankLines.waiting >= 2);
  assert.ok(inbox.receiptsMissing.some((r: any) => r.memo === 'Extractor'));
  assert.ok(inbox.tripsToLog.some((t: any) => t.jobId === recent.body.job.id));
  assert.ok(inbox.unpaidJobs.some((j: any) => j.jobId === recent.body.job.id));
  assert.ok(inbox.total >= 5);

  // Logging the drive takes it off the list.
  await call('POST', '/books/trips', { date: new Date().toISOString().slice(0, 10), miles: 12, purpose: 'Level I', jobId: recent.body.job.id });
  assert.ok(!(await call('GET', '/books/inbox')).body.tripsToLog.some((t: any) => t.jobId === recent.body.job.id));
});
