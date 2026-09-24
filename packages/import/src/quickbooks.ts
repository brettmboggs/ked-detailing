import { createHash } from 'node:crypto';
import { parseMoney } from '@ked/books';
import { norm, readDate, readTable } from './table.ts';

/**
 * QuickBooks' Journal report: every transaction as its debits and credits.
 * Reports → Journal → All dates → Export to Excel, then save as CSV
 * (QuickBooks Online only exports reports to Excel).
 *
 * The layout: a few title lines, a header row (Date, Transaction Type, Num,
 * Name, Memo/Description, Account, Debit, Credit), then each transaction as a
 * first line carrying the date, more lines with only an account and an
 * amount, and a subtotal line with no account. Desktop's export is close
 * enough to read the same way.
 */

export interface QbLine {
  account: string;
  /** Cents, + debit / − credit, the same convention as the books. */
  amount: number;
}

export interface QbTransaction {
  /** Stable across re-exports of the same data, so re-running skips it. */
  ref: string;
  date: string;
  type: string;
  num: string;
  name: string;
  memo: string;
  lines: QbLine[];
}

export interface QbJournal {
  transactions: QbTransaction[];
  /** Every account used, with how many lines and the net amount, busiest first. */
  accounts: { name: string; lines: number; net: number }[];
  problems: string[];
}

export function readQuickBooksJournal(text: string): QbJournal {
  const t = readTable(text, (h) => h.includes('account') && h.includes('debit') && h.includes('credit'));
  if (!t) return { transactions: [], accounts: [], problems: ["Couldn't find the Account / Debit / Credit header. Is this the Journal report?"] };
  const c = {
    date: t.col('date'),
    type: t.col('transaction type', 'type'),
    num: t.col('num', 'no', 'number'),
    name: t.col('name'),
    memo: t.col('memo/description', 'memo', 'description'),
    account: t.col('account', 'account name', 'split account'),
    debit: t.col('debit'),
    credit: t.col('credit'),
    trans: t.col('trans #', 'trans no'),
  };
  const cell = (row: string[], i: number) => (i >= 0 ? (row[i] ?? '').trim() : '');

  const transactions: QbTransaction[] = [];
  const problems: string[] = [];
  const seen = new Map<string, number>();
  let current: Omit<QbTransaction, 'ref'> | null = null;

  const close = () => {
    if (!current) return;
    const txn = current;
    current = null;
    if (!txn.lines.length) return;
    const sum = txn.lines.reduce((s, l) => s + l.amount, 0);
    if (sum !== 0) {
      problems.push(`${txn.type || 'Transaction'} on ${txn.date}${txn.num ? ` #${txn.num}` : ''} doesn't balance (off by ${sum / 100}), skipped.`);
      return;
    }
    // Identical transactions on one day (two $5 coffees) each get their own ref.
    const key = JSON.stringify([txn.date, txn.type, txn.num, txn.name, txn.memo, txn.lines]);
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    const ref = createHash('sha256').update(`${key}#${n}`).digest('hex').slice(0, 24);
    transactions.push({ ref, ...txn });
  };

  t.rows.forEach((row) => {
    const first = norm(row.find((x) => x.trim()) ?? '');
    if (first.startsWith('total')) return close();
    const account = cell(row, c.account);
    const dateText = cell(row, c.date);
    // A new transaction starts wherever a date (or Desktop's Trans #) appears.
    if (dateText || cell(row, c.trans)) {
      close();
      const date = readDate(dateText);
      if (!date) {
        problems.push(`Couldn't read the date "${dateText}", skipped that transaction.`);
        current = null;
        return;
      }
      current = { date, type: cell(row, c.type), num: cell(row, c.num), name: cell(row, c.name), memo: cell(row, c.memo), lines: [] };
    }
    if (!account) return close(); // the subtotal line
    if (!current) return;
    const debit = parseMoney(cell(row, c.debit)) ?? 0;
    const credit = parseMoney(cell(row, c.credit)) ?? 0;
    const amount = debit - credit;
    if (!current.name && cell(row, c.name)) current.name = cell(row, c.name);
    if (!current.memo && cell(row, c.memo)) current.memo = cell(row, c.memo);
    if (amount) current.lines.push({ account, amount });
  });
  close();

  const byAccount = new Map<string, { name: string; lines: number; net: number }>();
  for (const txn of transactions) {
    for (const l of txn.lines) {
      const a = byAccount.get(l.account) ?? { name: l.account, lines: 0, net: 0 };
      a.lines++;
      a.net += l.amount;
      byAccount.set(l.account, a);
    }
  }
  return { transactions, accounts: [...byAccount.values()].sort((a, b) => b.lines - a.lines), problems };
}

/**
 * A first guess at which of our accounts a QuickBooks account belongs in,
 * from its name. QuickBooks' own names are included ("Sales of Product
 * Income", "Undeposited Funds"). Null when there's no sensible guess: those
 * need a person to decide.
 */
const GUESSES: [RegExp, string][] = [
  [/opening balance|retained earnings/i, 'opening-balance'],
  [/owner'?s? (draw|distribution|pay)|draws?$|distributions?/i, 'owner-draws'],
  [/owner'?s? (contribution|investment|equity)|partner contribution|capital/i, 'owner-contributions'],
  [/sales tax/i, 'sales-tax'],
  [/undeposited|petty cash|^cash( on hand)?$/i, 'cash'],
  // Fees before accounts: "Bank Service Charges" and "Stripe Fees" are costs,
  // not the bank or Stripe. Licenses first, for "Licenses and fees".
  [/licen[cs]e|permit|taxes and licenses|registration/i, 'licenses'],
  [/merchant|bank (service )?(fee|charge)|processing|card fee|service charge|\bfees?\b/i, 'fees'],
  [/stripe|square|paypal clearing/i, 'stripe'],
  [/credit card|visa|mastercard|amex|american express|discover/i, 'credit-card'],
  [/checking|bank/i, 'checking'],
  [/\btips?\b|gratuit/i, 'income-tips'],
  [/(marine|boat).*(income|sales|revenue|detailing)|(income|sales).*(marine|boat)/i, 'income-marine'],
  [/cost of goods|cogs|merch(andise)? cost/i, 'merch-cost'],
  [/merch|product sales/i, 'income-merch'],
  [/sales|income|revenue|services|detailing/i, 'income-detailing'],
  [/supplies|materials|chemicals/i, 'supplies'],
  [/tools|equipment(?! rent)|small equipment/i, 'equipment-small'],
  [/fuel|gas|auto|vehicle|car and truck/i, 'fuel'],
  [/advertis|marketing|promotion/i, 'advertising'],
  [/contract/i, 'contract-labor'],
  [/insurance/i, 'insurance'],
  [/legal|accounting|professional|bookkeep/i, 'professional'],
  [/office|software|subscription|dues|postage|computer/i, 'office'],
  [/rent|lease/i, 'equipment-rental'],
  [/repair|maintenance/i, 'repairs'],
  [/travel|lodging|hotel|airfare/i, 'travel'],
  [/meal|entertainment/i, 'meals'],
  [/phone|internet|telephone|utilities/i, 'phone'],
  [/uniform|apparel/i, 'uniforms'],
  [/uncategori[sz]ed income/i, 'income-other'],
  [/uncategori[sz]ed|ask my accountant|miscellaneous|other/i, 'other-expense'],
];

export function guessAccount(qbName: string, ours: { id: string; name: string }[]): string | null {
  // An account with the same name already here wins (e.g. one made for the import).
  const exact = ours.find((a) => norm(a.name) === norm(qbName));
  if (exact) return exact.id;
  // "Expenses:Supplies" style parents: judge the leaf.
  const leaf = qbName.split(':').at(-1)!.trim();
  for (const [pattern, id] of GUESSES) if (pattern.test(leaf) && ours.some((a) => a.id === id)) return id;
  return null;
}

/** Transactions in our shape, once every account they use is mapped. */
export function toEntries(transactions: QbTransaction[], mapping: Record<string, string>) {
  return transactions.map((t) => {
    // Several QuickBooks accounts can map to one of ours: merge those lines.
    const merged = new Map<string, number>();
    for (const l of t.lines) {
      const id = mapping[l.account];
      if (!id) throw new Error(`"${l.account}" isn't mapped.`);
      merged.set(id, (merged.get(id) ?? 0) + l.amount);
    }
    const lines = [...merged].filter(([, amount]) => amount !== 0).map(([accountId, amount]) => ({ accountId, amount }));
    const memo = [t.type, t.num && `#${t.num}`, t.memo].filter(Boolean).join(' ');
    return { ref: t.ref, date: t.date, memo: memo.slice(0, 500), payee: t.name || undefined, lines };
  })
    // A transaction between two accounts that map to the same place nets to nothing here.
    .filter((e) => e.lines.length >= 2);
}
