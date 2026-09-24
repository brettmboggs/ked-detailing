import type { Account } from './accounts.ts';

/**
 * One side of an entry. `amount` is signed integer cents: positive is a debit,
 * negative a credit. An entry's lines always sum to zero.
 */
export interface Line {
  accountId: string;
  amount: number;
}

export class LedgerError extends Error {}

/** Throws if the lines can't form a valid entry against these accounts. */
export function checkLines(lines: Line[], accounts: Account[]): void {
  if (lines.length < 2) throw new LedgerError('An entry needs at least two lines.');
  const known = new Set(accounts.map((a) => a.id));
  let sum = 0;
  for (const l of lines) {
    if (!known.has(l.accountId)) throw new LedgerError(`Unknown account "${l.accountId}".`);
    if (!Number.isInteger(l.amount) || l.amount === 0) {
      throw new LedgerError('Every line needs a whole, non-zero number of cents.');
    }
    sum += l.amount;
  }
  if (sum !== 0) throw new LedgerError(`The entry is out of balance by ${sum} cents.`);
}

function account(accounts: Account[], id: string, what: string): Account {
  const found = accounts.find((a) => a.id === id);
  if (!found) throw new LedgerError(`Unknown ${what} "${id}".`);
  return found;
}

function positive(amount: number) {
  if (!Number.isInteger(amount) || amount <= 0) throw new LedgerError('Amount must be whole cents above zero.');
}

/** Money spent: the category goes up, the account it came out of goes down. */
export function expenseLines(accounts: Account[], amount: number, categoryId: string, paidFromId: string): Line[] {
  positive(amount);
  const category = account(accounts, categoryId, 'category');
  if (category.type !== 'expense') throw new LedgerError(`"${category.name}" isn't an expense category.`);
  const from = account(accounts, paidFromId, 'account');
  if (!from.moneyAccount) throw new LedgerError(`"${from.name}" can't pay for things.`);
  return [
    { accountId: category.id, amount },
    { accountId: from.id, amount: -amount },
  ];
}

/** Money received: the account it went into goes up, the income category too. */
export function incomeLines(accounts: Account[], amount: number, categoryId: string, depositToId: string): Line[] {
  positive(amount);
  const category = account(accounts, categoryId, 'category');
  if (category.type !== 'income') throw new LedgerError(`"${category.name}" isn't an income category.`);
  const to = account(accounts, depositToId, 'account');
  if (!to.moneyAccount) throw new LedgerError(`"${to.name}" can't receive money.`);
  return [
    { accountId: to.id, amount },
    { accountId: category.id, amount: -amount },
  ];
}

/**
 * Money moving between two of his own places: checking to savings, paying the
 * credit card, Stripe paying out, or an owner draw or contribution.
 */
export function transferLines(accounts: Account[], amount: number, fromId: string, toId: string): Line[] {
  positive(amount);
  if (fromId === toId) throw new LedgerError('Pick two different accounts.');
  const from = account(accounts, fromId, 'account');
  const to = account(accounts, toId, 'account');
  const ok = (x: Account) => x.moneyAccount || x.type === 'equity';
  if (!ok(from) || !ok(to)) throw new LedgerError('Transfers move money between accounts, not categories.');
  return [
    { accountId: to.id, amount },
    { accountId: from.id, amount: -amount },
  ];
}

/** The exact opposite, used to void an entry without deleting history. */
export function reverseLines(lines: Line[]): Line[] {
  return lines.map((l) => ({ accountId: l.accountId, amount: -l.amount }));
}
