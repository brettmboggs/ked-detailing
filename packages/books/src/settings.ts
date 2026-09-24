export interface BooksSettings {
  /**
   * IRS standard mileage rate in cents per mile, by tax year. The IRS sets
   * each year's rate in December; add it here when it's announced.
   */
  mileageRates: Record<string, number>;
  salesTax: {
    enabled: boolean;
    /** Percent, e.g. 8.238 for 8.238%. */
    rate: number;
  };
  /**
   * Contractors paid at least this much in a year are flagged for a 1099-NEC.
   * Kept at the long-standing $600: flagging too many is safe, too few isn't.
   * Check the current IRS threshold before filing.
   */
  contractor1099Threshold: number;
}

export const defaultBooksSettings: BooksSettings = {
  mileageRates: { '2025': 70 },
  salesTax: { enabled: false, rate: 0 },
  contractor1099Threshold: 60000,
};

export function validateBooksSettings(s: BooksSettings): string[] {
  const errors: string[] = [];
  if (!s.mileageRates || typeof s.mileageRates !== 'object') errors.push('Mileage rates are missing.');
  else {
    for (const [year, rate] of Object.entries(s.mileageRates)) {
      if (!/^\d{4}$/.test(year)) errors.push(`"${year}" isn't a year.`);
      if (!(typeof rate === 'number' && rate > 0 && rate < 1000)) errors.push(`${year}: the mileage rate must be cents per mile, like 70.`);
    }
  }
  if (!s.salesTax || typeof s.salesTax.enabled !== 'boolean') errors.push('Sales tax must be on or off.');
  else if (!(s.salesTax.rate >= 0 && s.salesTax.rate < 25)) errors.push('The sales tax rate must be a percent between 0 and 25.');
  if (!(Number.isInteger(s.contractor1099Threshold) && s.contractor1099Threshold >= 0)) {
    errors.push('The 1099 threshold must be whole cents.');
  }
  return errors;
}
