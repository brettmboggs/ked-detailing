/**
 * The chart of accounts. Jacob never sees "debits" or "credits": he picks a
 * category like "Supplies" and a "paid from" like "Business checking", and the
 * ledger underneath is ordinary double-entry, so the numbers hold up for an
 * accountant.
 *
 * Expense and income accounts carry the Schedule C line they land on, so the
 * year-end report lines up with the tax form. The mapping follows the 2024–25
 * Schedule C; an accountant should confirm it before filing.
 */

export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  /** Schedule C line, e.g. "22" for Supplies. Null for balance-sheet accounts. */
  scheduleC: string | null;
  /** Can hold money and appear as "paid from" / "deposited to", and take bank CSV imports. */
  moneyAccount: boolean;
  /** Short hint shown under the name when picking a category. */
  hint?: string;
}

export const SCHEDULE_C_LINES: Record<string, string> = {
  '1': 'Gross receipts or sales',
  '4': 'Cost of goods sold',
  '6': 'Other income',
  '8': 'Advertising',
  '9': 'Car and truck expenses',
  '10': 'Commissions and fees',
  '11': 'Contract labor',
  '15': 'Insurance',
  '17': 'Legal and professional services',
  '18': 'Office expense',
  '20b': 'Rent or lease: other business property',
  '21': 'Repairs and maintenance',
  '22': 'Supplies',
  '23': 'Taxes and licenses',
  '24a': 'Travel',
  '24b': 'Meals',
  '25': 'Utilities',
  '27a': 'Other expenses',
};

const a = (
  id: string,
  name: string,
  type: AccountType,
  scheduleC: string | null = null,
  hint?: string,
  moneyAccount = false,
): Account => ({ id, name, type, scheduleC, moneyAccount, ...(hint ? { hint } : {}) });

export const defaultAccounts: Account[] = [
  a('checking', 'Business checking', 'asset', null, undefined, true),
  a('cash', 'Cash on hand', 'asset', null, undefined, true),
  a('stripe', 'Stripe balance', 'asset', null, 'Card payments waiting to pay out', true),
  a('credit-card', 'Business credit card', 'liability', null, undefined, true),
  a('sales-tax', 'Sales tax owed', 'liability'),

  a('owner-contributions', 'Owner contributions', 'equity', null, 'Your own money put into the business'),
  a('owner-draws', 'Owner draws', 'equity', null, 'Money you take out for yourself'),
  a('opening-balance', 'Opening balances', 'equity'),

  a('income-detailing', 'Detailing', 'income', '1'),
  a('income-marine', 'Marine detailing', 'income', '1'),
  a('income-merch', 'Merch sales', 'income', '1'),
  a('income-tips', 'Tips', 'income', '1'),
  a('income-other', 'Other income', 'income', '6'),

  a('supplies', 'Supplies', 'expense', '22', 'Chemicals, towels, pads, brushes'),
  a('equipment-small', 'Tools and small equipment', 'expense', '22', 'Polishers, vacuums, extractors'),
  a('fuel', 'Fuel and vehicle costs', 'expense', '9', 'Only if not claiming mileage'),
  a('advertising', 'Advertising', 'expense', '8', 'Ads, flyers, van wrap, website'),
  a('fees', 'Card and payment fees', 'expense', '10', 'Stripe and other processing fees'),
  a('contract-labor', 'Contract labor', 'expense', '11', 'Paying a helper who is not an employee'),
  a('insurance', 'Insurance', 'expense', '15', 'Business liability, garage keepers'),
  a('professional', 'Legal and accounting', 'expense', '17'),
  a('office', 'Office and software', 'expense', '18', 'Apps, subscriptions, postage'),
  a('equipment-rental', 'Equipment rental', 'expense', '20b'),
  a('repairs', 'Repairs and maintenance', 'expense', '21', 'Fixing equipment'),
  a('licenses', 'Licenses and fees', 'expense', '23', 'Business license, LLC renewal'),
  a('travel', 'Travel', 'expense', '24a', 'Overnight trips for work'),
  a('meals', 'Meals', 'expense', '24b', 'Business meals'),
  a('phone', 'Phone and internet', 'expense', '25'),
  a('uniforms', 'Uniforms and merch for staff', 'expense', '27a'),
  a('other-expense', 'Other expenses', 'expense', '27a'),
  a('merch-cost', 'Merch cost', 'expense', '4', 'What the merch cost you to make'),
];

/** Money in an account from its lines. Lines are signed: + debit, − credit. */
export function naturalBalance(type: AccountType, sumOfLines: number): number {
  // Assets and expenses grow with debits; the rest grow with credits.
  return type === 'asset' || type === 'expense' ? sumOfLines : -sumOfLines;
}
