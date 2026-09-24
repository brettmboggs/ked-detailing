import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  balances,
  checkLines,
  defaultAccounts as accounts,
  defaultBooksSettings,
  expenseLines,
  fingerprints,
  incomeLines,
  LedgerError,
  matchBank,
  mileageDeduction,
  parseCsv,
  parseDate,
  parseMoney,
  profitLoss,
  readBankCsv,
  reverseLines,
  toCsv,
  transferLines,
  validateBooksSettings,
} from './index.ts';

test('the default chart is sane: unique ids, every expense and income on a Schedule C line', () => {
  assert.equal(new Set(accounts.map((a) => a.id)).size, accounts.length);
  for (const a of accounts) {
    if (a.type === 'income' || a.type === 'expense') assert.ok(a.scheduleC, a.id);
    else assert.equal(a.scheduleC, null, a.id);
  }
  assert.deepEqual(validateBooksSettings(defaultBooksSettings), []);
});

test('entries built from plain choices always balance', () => {
  const e = expenseLines(accounts, 4599, 'supplies', 'credit-card');
  const i = incomeLines(accounts, 27500, 'income-detailing', 'cash');
  const t = transferLines(accounts, 50000, 'checking', 'owner-draws');
  for (const lines of [e, i, t, reverseLines(e)]) checkLines(lines, accounts);
  assert.deepEqual(e, [
    { accountId: 'supplies', amount: 4599 },
    { accountId: 'credit-card', amount: -4599 },
  ]);
});

test('nonsense is refused with a reason', () => {
  assert.throws(() => expenseLines(accounts, 100, 'income-detailing', 'checking'), LedgerError);
  assert.throws(() => expenseLines(accounts, 100, 'supplies', 'owner-draws'), LedgerError);
  assert.throws(() => incomeLines(accounts, 0, 'income-detailing', 'checking'), LedgerError);
  assert.throws(() => incomeLines(accounts, 10.5, 'income-detailing', 'checking'), LedgerError);
  assert.throws(() => transferLines(accounts, 100, 'checking', 'checking'), LedgerError);
  assert.throws(() => transferLines(accounts, 100, 'checking', 'supplies'), LedgerError);
  assert.throws(() => checkLines([{ accountId: 'supplies', amount: 5 }, { accountId: 'checking', amount: -4 }], accounts), /out of balance/);
});

test('profit and loss, with cost of goods kept apart and Schedule C totals', () => {
  const lines = [
    ...incomeLines(accounts, 100000, 'income-detailing', 'checking'),
    ...incomeLines(accounts, 20000, 'income-merch', 'stripe'),
    ...expenseLines(accounts, 15000, 'supplies', 'credit-card'),
    ...expenseLines(accounts, 5000, 'equipment-small', 'checking'),
    ...expenseLines(accounts, 8000, 'merch-cost', 'checking'),
    ...transferLines(accounts, 30000, 'checking', 'owner-draws'), // not an expense
  ];
  const pl = profitLoss(accounts, lines);
  assert.equal(pl.totalIncome, 120000);
  assert.equal(pl.costOfGoods, 8000);
  assert.equal(pl.totalExpenses, 20000);
  assert.equal(pl.net, 92000);
  assert.deepEqual(
    pl.scheduleC.map((r) => [r.line, r.total]),
    [['1', 120000], ['4', 8000], ['22', 20000]],
  );

  const b = Object.fromEntries(balances(accounts, lines).map((r) => [r.accountId, r.balance]));
  assert.equal(b['checking'], 100000 - 5000 - 8000 - 30000);
  assert.equal(b['credit-card'], 15000, 'card balance owed shows as positive');
  assert.equal(b['owner-draws'], -30000);
});

test('a voided entry nets to nothing', () => {
  const e = expenseLines(accounts, 999, 'meals', 'cash');
  assert.equal(profitLoss(accounts, [...e, ...reverseLines(e)]).totalExpenses, 0);
});

test('CSV parsing handles quotes, embedded commas and newlines, and a BOM', () => {
  assert.deepEqual(parseCsv('﻿a,"b,c","d ""q"""\r\n1,"two\nlines",3\n'), [
    ['a', 'b,c', 'd "q"'],
    ['1', 'two\nlines', '3'],
  ]);
  assert.equal(toCsv([['x', 'a,b', '=SUM(A1)', -12.5]]), 'x,"a,b",\'=SUM(A1),-12.5\r\n');
});

test('money and dates in the formats banks actually use', () => {
  assert.equal(parseMoney('$1,234.56'), 123456);
  assert.equal(parseMoney('(12.00)'), -1200);
  assert.equal(parseMoney('-7.5'), -750);
  assert.equal(parseMoney('40.00-'), -4000);
  assert.equal(parseMoney('abc'), null);
  assert.equal(parseDate('03/05/2026'), '2026-03-05');
  assert.equal(parseDate('3/5/26'), '2026-03-05');
  assert.equal(parseDate('2026-03-05'), '2026-03-05');
  assert.equal(parseDate('02/30/2026'), null);
});

test('a checking export with a signed Amount column and junk above the header', () => {
  const csv = [
    'Account: Business Checking ****1234',
    '',
    'Date,Description,Amount,Balance',
    '09/01/2026,"DEPOSIT - STRIPE TRANSFER",412.30,5000.00',
    '09/02/2026,AUTOZONE #123,-45.99,4954.01',
    '09/03/2026,Broken row,,',
    'not a date,Oops,1.00,',
  ].join('\n');
  const r = readBankCsv(csv);
  assert.deepEqual(r.rows, [
    { date: '2026-09-01', description: 'DEPOSIT - STRIPE TRANSFER', amount: 41230 },
    { date: '2026-09-02', description: 'AUTOZONE #123', amount: -4599 },
  ]);
  assert.equal(r.problems.length, 2);
});

test('a card export with Debit/Credit columns, and one with purchases as positives', () => {
  const split = 'Transaction Date,Description,Debit,Credit\n09/04/2026,CHEMICAL GUYS,89.10,\n09/05/2026,PAYMENT THANK YOU,,500.00\n';
  assert.deepEqual(
    readBankCsv(split).rows.map((r) => r.amount),
    [-8910, 50000],
  );
  const positive = 'Posted Date,Payee,Amount\n09/04/2026,CHEMICAL GUYS,89.10\n';
  assert.equal(readBankCsv(positive, { invert: true }).rows[0]!.amount, -8910);
  assert.match(readBankCsv('Foo,Bar\n1,2\n').problems[0]!, /Date and Amount/);
});

test('fingerprints tell identical same-day rows apart and are stable across imports', () => {
  const rows = [
    { date: '2026-09-01', description: 'Car Wash', amount: -500 },
    { date: '2026-09-01', description: 'Car Wash', amount: -500 },
  ];
  const a = fingerprints('checking', rows);
  assert.notEqual(a[0], a[1]);
  assert.deepEqual(fingerprints('checking', rows), a);
});

test('bank matching: exact amount, closest date first, each entry used once', () => {
  const m = matchBank(
    [
      { id: 'b1', date: '2026-09-03', amount: 27500 },
      { id: 'b2', date: '2026-09-04', amount: 27500 },
      { id: 'b3', date: '2026-09-04', amount: -4599 },
      { id: 'b4', date: '2026-09-30', amount: 10000 },
    ],
    [
      { entryId: 'e1', date: '2026-09-01', amount: 27500 },
      { entryId: 'e2', date: '2026-09-04', amount: 27500 },
      { entryId: 'e3', date: '2026-09-02', amount: -4599 },
      { entryId: 'e4', date: '2026-09-01', amount: 10000 },
    ],
  );
  assert.equal(m.get('b2'), 'e2');
  assert.equal(m.get('b1'), 'e1');
  assert.equal(m.get('b3'), 'e3');
  assert.equal(m.has('b4'), false, 'too far apart');
});

test('mileage deduction needs a rate for the year', () => {
  assert.equal(mileageDeduction(123.4, 70), 8638);
  assert.equal(mileageDeduction(10, undefined), null);
});
