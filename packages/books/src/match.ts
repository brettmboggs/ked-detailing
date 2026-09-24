/**
 * Pair bank statement rows with entries already in the books, so a payment
 * Jacob logged on a job and the deposit that shows up on his statement
 * become one thing, not two.
 *
 * Amounts use the same sign on both sides: a bank row's +/− is money in/out of
 * that account, which is exactly the ledger line's debit/credit on it.
 */

export interface BankSide {
  id: string;
  date: string;
  amount: number;
}

export interface LedgerSide {
  entryId: string;
  date: string;
  /** The entry's line on the same account. */
  amount: number;
}

const days = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 864e5;

/**
 * Exact amount, within `windowDays` (deposits and card charges post a few days
 * late). Closest dates are paired first, and each entry is used once.
 */
export function matchBank(bank: BankSide[], ledger: LedgerSide[], windowDays = 5): Map<string, string> {
  const pairs: { bankId: string; entryId: string; gap: number }[] = [];
  for (const b of bank) {
    for (const l of ledger) {
      if (l.amount !== b.amount) continue;
      const gap = days(b.date, l.date);
      if (gap <= windowDays) pairs.push({ bankId: b.id, entryId: l.entryId, gap });
    }
  }
  pairs.sort((x, y) => x.gap - y.gap || x.bankId.localeCompare(y.bankId) || x.entryId.localeCompare(y.entryId));
  const matched = new Map<string, string>();
  const used = new Set<string>();
  for (const p of pairs) {
    if (matched.has(p.bankId) || used.has(p.entryId)) continue;
    matched.set(p.bankId, p.entryId);
    used.add(p.entryId);
  }
  return matched;
}
