import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultAccounts } from '@ked/books';
import { readHcpCustomers, readHcpJobs } from './housecall.ts';
import { guessAccount, readQuickBooksJournal, toEntries } from './quickbooks.ts';
import { readInstant } from './table.ts';

const TZ = 'America/Chicago';

test('dates and times in the business zone, however the export writes them', () => {
  assert.equal(readInstant('09/24/2026 10:00 AM', TZ)?.toISOString(), '2026-09-24T15:00:00.000Z'); // CDT
  assert.equal(readInstant('9/4/26 10:00 AM', TZ)?.toISOString(), '2026-09-04T15:00:00.000Z');
  assert.equal(readInstant('Dec 3, 2026 2:30pm', TZ)?.toISOString(), '2026-12-03T20:30:00.000Z'); // CST
  assert.equal(readInstant('2026-12-03', TZ, '12:00 PM')?.toISOString(), '2026-12-03T18:00:00.000Z');
  assert.equal(readInstant('2026-09-24T15:00:00Z', TZ)?.toISOString(), '2026-09-24T15:00:00.000Z');
  assert.equal(readInstant('2026-09-24', TZ), null, 'a date with no time is not a booking');
  assert.equal(readInstant('soon', TZ), null);
});

test('Housecall Pro customers: split names and addresses, missing names reported', () => {
  const csv = [
    'First name,Last name,Company,Mobile number,Home number,Email,Street,City,State,Zip,Customer notes',
    'Dana,Whitfield,,(314) 555-0101,,dana@example.com,9 Oak St,High Ridge,MO,63049,Two dogs',
    ',,Acme Fleet,,314-555-0102,"fleet@acme.com, ops@acme.com",1 Depot Rd,Fenton,MO,63026,',
    ',,,,,,,,,,',
    ',,,314-555-0103,,,,,,,',
  ].join('\n');
  const r = readHcpCustomers(csv);
  assert.deepEqual(r.items, [
    { name: 'Dana Whitfield', phone: '(314) 555-0101', email: 'dana@example.com', address: '9 Oak St, High Ridge, MO 63049', notes: 'Two dogs' },
    { name: 'Acme Fleet', phone: '314-555-0102', email: 'fleet@acme.com', address: '1 Depot Rd, Fenton, MO 63026' },
  ]);
  assert.deepEqual(r.problems, ['Row 5: no name, skipped.'], 'numbered as in the spreadsheet');
  assert.equal(r.columns.phone, 'Mobile number');
});

test('Housecall Pro jobs: local times, money, cancelled, and rows that cannot be used', () => {
  const csv = [
    'Job #,Customer name,Mobile number,Service address,Scheduled start,Scheduled end,Job status,Total amount,Description',
    '#1042,Dana Whitfield,314-555-0101,"9 Oak St, High Ridge, MO 63049",10/02/2026 9:00 AM,10/02/2026 12:00 PM,Scheduled,"$1,225.00",Full detail + ceramic',
    '1040,Kit History,314-555-0104,2 Past Pl,09/01/2026 1:00 PM,,Canceled,$0.00,Wash',
    '1039,No Date,314-555-0105,3 Nowhere,,,Unscheduled,,',
    '1038,Bad Money,314-555-0106,4 Elm,09/02/2026 8:00 AM,,Complete,lots,',
  ].join('\n');
  const r = readHcpJobs(csv, TZ);
  assert.equal(r.items.length, 3);
  assert.deepEqual(r.items[0], {
    ref: '1042',
    customer: { name: 'Dana Whitfield', phone: '314-555-0101', address: '9 Oak St, High Ridge, MO 63049' },
    start: '2026-10-02T14:00:00.000Z',
    end: '2026-10-02T17:00:00.000Z',
    address: '9 Oak St, High Ridge, MO 63049',
    status: 'scheduled',
    total: 122500,
    description: 'Full detail + ceramic',
  });
  assert.equal(r.items[1]!.status, 'cancelled');
  assert.equal(r.items[1]!.total, 0);
  assert.equal(r.items[2]!.total, undefined);
  assert.deepEqual(r.problems, [
    "Row 4 (job 1039): no date and time it's scheduled for, skipped.",
    'Row 5 (job 1038): couldn\'t read the total "lots", left blank.',
  ]);
});

/** Shaped like QuickBooks Online's Journal, exported to Excel and saved as CSV. */
const JOURNAL = [
  "Knock Em Down Auto & Marine Detailing,,,,,,,,",
  'Journal,,,,,,,,',
  'All Dates,,,,,,,,',
  ',,,,,,,,',
  ',Date,Transaction Type,Num,Name,Memo/Description,Account,Debit,Credit',
  ',01/05/2026,Invoice,1001,Dana Whitfield,Full detail,Accounts Receivable (A/R),$225.00,',
  ',,,,,,Sales of Product Income,,$225.00',
  ',,,,,,,$225.00,$225.00',
  ',,,,,,,,',
  ',01/06/2026,Expense,,Chemical Guys,Soap and wax,Supplies & Materials,"$1,045.50",',
  ',,,,,,Expenses:Merchant Fees,$4.50,',
  ',,,,,,Business Visa,,"$1,050.00"',
  ',,,,,,,"$1,050.00","$1,050.00"',
  ',01/07/2026,Expense,,Starbucks,,Meals,$5.00,',
  ',,,,,,Business Visa,,$5.00',
  ',,,,,,,$5.00,$5.00',
  ',01/07/2026,Expense,,Starbucks,,Meals,$5.00,',
  ',,,,,,Business Visa,,$5.00',
  ',,,,,,,$5.00,$5.00',
  ',01/08/2026,Journal Entry,7,,Broken,Checking,$10.00,',
  ',,,,,,Owner Draws,,$9.00',
  ',,,,,,,$10.00,$9.00',
  ',TOTAL,,,,,,"$1,290.00","$1,289.00"',
].join('\n');

test('QuickBooks journal: transactions grouped, balanced, and uniquely referenced', () => {
  const j = readQuickBooksJournal(JOURNAL);
  assert.equal(j.transactions.length, 4);
  const [invoice, expense, coffee1, coffee2] = j.transactions;
  assert.deepEqual(invoice!.lines, [
    { account: 'Accounts Receivable (A/R)', amount: 22500 },
    { account: 'Sales of Product Income', amount: -22500 },
  ]);
  assert.equal(invoice!.name, 'Dana Whitfield');
  assert.equal(expense!.lines.length, 3);
  assert.equal(expense!.memo, 'Soap and wax');
  assert.notEqual(coffee1!.ref, coffee2!.ref, 'two identical coffees are two transactions');
  assert.deepEqual(readQuickBooksJournal(JOURNAL).transactions.map((t) => t.ref), j.transactions.map((t) => t.ref), 'refs are stable');
  assert.equal(j.problems.length, 1);
  assert.match(j.problems[0]!, /2026-01-08 #7 doesn't balance/);
  assert.equal(j.accounts[0]!.name, 'Business Visa');
  assert.equal(j.accounts[0]!.lines, 3);
});

test('QuickBooks accounts: sensible guesses, and a person decides the rest', () => {
  const g = (n: string) => guessAccount(n, defaultAccounts);
  assert.equal(g('Sales of Product Income'), 'income-detailing');
  assert.equal(g('Supplies & Materials'), 'supplies');
  assert.equal(g('Expenses:Merchant Fees'), 'fees');
  assert.equal(g('Bank Service Charges'), 'fees');
  assert.equal(g('Stripe Fees'), 'fees');
  assert.equal(g('Business Visa'), 'credit-card');
  assert.equal(g('Business Checking'), 'checking');
  assert.equal(g('Undeposited Funds'), 'cash');
  assert.equal(g('Owner Draws'), 'owner-draws');
  assert.equal(g('Opening Balance Equity'), 'opening-balance');
  assert.equal(g('Licenses and Fees'), 'licenses');
  assert.equal(g('Marine supplies'), 'supplies');
  assert.equal(g('Tips Income'), 'income-tips');
  assert.equal(g('Accounts Receivable (A/R)'), null, 'no receivables account here: a person decides');
  assert.equal(g('Payroll Expenses'), null);
  assert.equal(guessAccount('Detailing', [{ id: 'x-custom', name: 'Detailing' }, ...defaultAccounts]), 'x-custom', 'same name wins');
});

test('mapped entries merge lines that land in one account, and drop ones that net to nothing', () => {
  const j = readQuickBooksJournal(JOURNAL);
  const mapping = {
    'Accounts Receivable (A/R)': 'checking',
    'Sales of Product Income': 'income-detailing',
    'Supplies & Materials': 'supplies',
    'Expenses:Merchant Fees': 'supplies', // merged with the line above
    'Business Visa': 'credit-card',
    Meals: 'credit-card', // the coffee now nets to nothing and is dropped
  };
  const entries = toEntries(j.transactions, mapping);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[1], {
    ref: j.transactions[1]!.ref,
    date: '2026-01-06',
    memo: 'Expense Soap and wax',
    payee: 'Chemical Guys',
    lines: [{ accountId: 'supplies', amount: 105000 }, { accountId: 'credit-card', amount: -105000 }],
  });
  assert.throws(() => toEntries(j.transactions, {}), /isn't mapped/);
});

test("Housecall Pro's current job list: long column names, split address, arrival window", () => {
  const csv = [
    'Job #,Customer name,Customer mobile number,Customer email,Address,Street,Street 2,City,State,Zip code,Job description,Job status,Job arrival window,Job scheduled start date,Job scheduled end date,Job amount,Job revenue',
    '1042,Dana Whitfield,(314) 555-0101,dana@example.com,9 Oak St,9 Oak St,,High Ridge,MO,63049,Full detail,Scheduled,,10/02/2026 10:00 AM,10/02/2026 1:00 PM,$225.00,$225.00',
    '1043,Kit Moss,314-555-0107,,,1 Elm Ct,,Fenton,MO,63026,Wash,Pro canceled,10:00am - 12:00pm,10/05/2026,,$80.00,$0.00',
  ].join('\n');
  const r = readHcpJobs(csv, TZ);
  assert.deepEqual(r.problems, []);
  assert.equal(r.items[0]!.start, '2026-10-02T15:00:00.000Z');
  assert.equal(r.items[0]!.end, '2026-10-02T18:00:00.000Z');
  assert.equal(r.items[0]!.address, '9 Oak St, High Ridge, MO 63049', 'city and ZIP kept when "Address" is only the street');
  assert.equal(r.items[0]!.customer.phone, '(314) 555-0101');
  assert.equal(r.items[0]!.total, 22500);
  assert.equal(r.items[1]!.start, '2026-10-05T15:00:00.000Z', 'time from the arrival window');
  assert.equal(r.items[1]!.status, 'cancelled');
});

test("Housecall Pro's older export: Date / End Time / Invoice Number, Street Line 2", () => {
  const csv = [
    'Invoice Number,Date,End Time,Customer,Mobile Phone,Home Phone,Street,Street Line 2,City,State,Zip,Description,Amount,Job Status',
    '1042-1,10/02/2026 10:00 AM,10/02/2026 1:00 PM,Dana Whitfield,,(314) 555-0101,9 Oak St,Apt 2,High Ridge,MO,63049,Full detail,$225.00,Done',
  ].join('\n');
  const [job] = readHcpJobs(csv, TZ).items;
  assert.equal(job!.ref, '1042-1');
  assert.equal(job!.end, '2026-10-02T18:00:00.000Z');
  assert.equal(job!.address, '9 Oak St Apt 2, High Ridge, MO 63049');
  assert.equal(job!.customer.phone, '(314) 555-0101', 'home phone when there is no mobile');
});

test("QuickBooks' newer journal layout: renamed columns, and the date on every line", () => {
  const csv = [
    'Journal',
    'Knock Em Down Auto & Marine Detailing',
    'All Dates',
    '',
    'Transaction date,Transaction type,Num,Name,Memo/Description,Account full name,Debit,Credit',
    '01/05/2026,Invoice,1001,Dana Whitfield,Full detail,Accounts Receivable (A/R),$225.00,',
    '01/05/2026,Invoice,1001,Dana Whitfield,Full detail,Sales of Product Income,,$225.00',
    '01/05/2026,Expense,,Chemical Guys,Soap,Supplies & Materials,$40.00,',
    '01/05/2026,Expense,,Chemical Guys,Soap,Merchant Fees,$2.00,',
    '01/05/2026,Expense,,Chemical Guys,Soap,Business Visa,,$42.00',
    '01/05/2026,Expense,,Starbucks,,Meals,$5.00,',
    '01/05/2026,Expense,,Starbucks,,Business Visa,,$5.00',
    'TOTAL,,,,,,$272.00,$272.00',
  ].join('\n');
  const j = readQuickBooksJournal(csv);
  assert.deepEqual(j.problems, []);
  assert.deepEqual(j.transactions.map((t) => [t.name, t.lines.length]), [['Dana Whitfield', 2], ['Chemical Guys', 3], ['Starbucks', 2]]);
});
