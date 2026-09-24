import { naturalBalance, SCHEDULE_C_LINES, type Account } from './accounts.ts';

export interface PostedLine {
  accountId: string;
  /** Signed cents, + debit / − credit. */
  amount: number;
}

export interface ProfitLoss {
  income: { accountId: string; name: string; scheduleC: string | null; total: number }[];
  expenses: { accountId: string; name: string; scheduleC: string | null; total: number }[];
  totalIncome: number;
  /** Cost of goods sold (Schedule C line 4), kept apart from other expenses. */
  costOfGoods: number;
  totalExpenses: number;
  net: number;
  /** Totals per Schedule C line, in form order. */
  scheduleC: { line: string; label: string; total: number }[];
}

/** Profit and loss from the lines posted in a period. */
export function profitLoss(accounts: Account[], lines: PostedLine[]): ProfitLoss {
  const sums = new Map<string, number>();
  for (const l of lines) sums.set(l.accountId, (sums.get(l.accountId) ?? 0) + l.amount);

  const rows = (type: 'income' | 'expense') =>
    accounts
      .filter((a) => a.type === type)
      .map((a) => ({ accountId: a.id, name: a.name, scheduleC: a.scheduleC, total: naturalBalance(a.type, sums.get(a.id) ?? 0) }))
      .filter((r) => r.total !== 0);

  const income = rows('income');
  const expenses = rows('expense');
  const totalIncome = income.reduce((s, r) => s + r.total, 0);
  const costOfGoods = expenses.filter((r) => r.scheduleC === '4').reduce((s, r) => s + r.total, 0);
  const totalExpenses = expenses.reduce((s, r) => s + r.total, 0) - costOfGoods;

  const byLine = new Map<string, number>();
  for (const r of [...income, ...expenses]) {
    if (r.scheduleC) byLine.set(r.scheduleC, (byLine.get(r.scheduleC) ?? 0) + r.total);
  }
  const order = Object.keys(SCHEDULE_C_LINES);
  const scheduleC = [...byLine]
    .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
    .map(([line, total]) => ({ line, label: SCHEDULE_C_LINES[line] ?? `Line ${line}`, total }));

  return { income, expenses, totalIncome, costOfGoods, totalExpenses, net: totalIncome - costOfGoods - totalExpenses, scheduleC };
}

/** What each account holds or owes, from every line up to a date. */
export function balances(accounts: Account[], lines: PostedLine[]) {
  const sums = new Map<string, number>();
  for (const l of lines) sums.set(l.accountId, (sums.get(l.accountId) ?? 0) + l.amount);
  return accounts
    .filter((a) => a.type !== 'income' && a.type !== 'expense')
    .map((a) => ({ accountId: a.id, name: a.name, type: a.type, balance: naturalBalance(a.type, sums.get(a.id) ?? 0) }));
}

/**
 * Standard mileage deduction. Rates are per year and set by the IRS each
 * December, so they live in settings rather than code.
 */
export function mileageDeduction(miles: number, centsPerMile: number | undefined): number | null {
  if (centsPerMile === undefined) return null;
  return Math.round(miles * centsPerMile);
}
