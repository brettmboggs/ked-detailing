/**
 * Turning bank descriptions into something that can be remembered.
 *
 * "POS DEBIT 09/12 AUTOZONE #4412 HIGH RIDGE MO" and
 * "AUTOZONE 1187 ST LOUIS MO" are the same merchant. `merchantKey` reduces
 * both to "AUTOZONE", so filing one teaches the books where the next goes.
 */

/** Bank boilerplate that says how a charge was made, not who it was to. */
const NOISE = [
  'POS DEBIT', 'POS PURCHASE', 'POS', 'DEBIT CARD PURCHASE', 'DEBIT CARD', 'DBT CRD', 'CHECKCARD', 'CHECK CARD',
  'PURCHASE AUTHORIZED ON', 'PURCHASE', 'RECURRING', 'ACH DEBIT', 'ACH CREDIT', 'ACH', 'ONLINE', 'WEB', 'PREAUTHORIZED',
  'VISA', 'MC', 'CARD', 'ELECTRONIC', 'WITHDRAWAL', 'DEPOSIT', 'PAYMENT', 'PMT', 'TRANSFER', 'XFER', 'PPD', 'WEB ID',
];

const STATES = new Set(
  'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' '),
);

/**
 * The stable part of a description. Processor prefixes, dates and bank
 * boilerplate go; the first store number ends the name, because what follows
 * it is the location; a trailing city and state go; then the first two words.
 */
export function merchantKey(description: string): string {
  let s = ` ${description.toUpperCase()} `
    // Processor prefixes glued to the merchant: "SQ *JOES", "TST* CAFE", "PAYPAL *ACME"
    .replace(/\b(SQ|TST|SP|PY|PP|PAYPAL|IN|DD|GOOGLE|APL|AMZN MKTP|AMZN)\s?\*\s?/g, ' ')
    .replace(/\*/g, ' ')
    // Dates like 09/12, 09-12-26
    .replace(/\b\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?\b/g, ' ')
    .replace(/\s+/g, ' ');
  for (const n of NOISE) s = s.replace(new RegExp(` ${n} `, 'g'), ' ');
  // Reference numbers before the name ("CHECKCARD 0912 SHELL") aren't the name.
  s = s.replace(/^( \d+)+ /, ' ');
  // "AUTOZONE #4412 HIGH RIDGE MO", "AUTOZONE 1187 ST LOUIS": cut at the store number.
  s = s.split(/ #\s?\d+| \d{3,}\b/)[0]!;
  const words = s
    .replace(/[^A-Z0-9&' ]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  // No store number: drop a trailing state code and the word before it (the city).
  if (words.length > 2 && STATES.has(words.at(-1)!)) words.splice(-2);
  return words.slice(0, 2).join(' ') || description.trim().toUpperCase().slice(0, 30);
}

/** What to do with a bank line: file it under a category, or treat it as a transfer. */
export type Treatment =
  | { action: 'categorize'; categoryId: string }
  | { action: 'transfer'; otherAccountId: string }
  | { action: 'personal' };

export interface StarterRule {
  /** Matched against merchantKey() output, as whole-word prefixes. */
  starts: string[];
  treat: Treatment;
  /** Only apply to money out (-1) or in (+1). */
  direction?: -1 | 1;
}

/**
 * Where common merchants usually go for a mobile detailer. These only ever
 * *suggest*; Jacob's own choices override them and are what auto-files.
 */
export const starterRules: StarterRule[] = [
  { starts: ['SHELL', 'EXXON', 'EXXONMOBIL', 'MOBIL', 'BP', 'QT', 'QUIKTRIP', 'CASEYS', "CASEY'S", 'PHILLIPS 66', 'CIRCLE K', 'SPEEDWAY', 'MARATHON', 'VALERO', 'CONOCO', 'SINCLAIR', 'CHEVRON', 'MURPHY', 'MOTOMART', 'BUCEES', "BUC EE'S", 'SAMS FUEL', 'COSTCO GAS'], treat: { action: 'categorize', categoryId: 'fuel' }, direction: -1 },
  { starts: ['AUTOZONE', "O'REILLY", 'OREILLY', 'ADVANCE AUTO', 'NAPA', 'CHEMICAL GUYS', 'DETAIL KING', 'ADAMS POLISHES', 'GRIOTS', "GRIOT'S", 'AUTOGEEK', 'DETAILED IMAGE', 'MEGUIARS', 'P&S', 'CARPRO', 'GYEON', 'KOCH CHEMIE', 'RUPES', 'FLEX', 'MAXSHINE', 'THE RAG COMPANY', 'RAG COMPANY', 'DETAILERS WAREHOUSE', 'AUTO PAINT'], treat: { action: 'categorize', categoryId: 'supplies' }, direction: -1 },
  { starts: ['HARBOR FREIGHT', 'HOME DEPOT', 'LOWES', "LOWE'S", 'MENARDS', 'NORTHERN TOOL', 'TRACTOR SUPPLY'], treat: { action: 'categorize', categoryId: 'equipment-small' }, direction: -1 },
  { starts: ['FACEBK', 'META', 'FACEBOOK', 'GOOGLE ADS', 'ADS', 'NEXTDOOR', 'YELP', 'VISTAPRINT', 'STICKER MULE', 'SQUARESPACE'], treat: { action: 'categorize', categoryId: 'advertising' }, direction: -1 },
  { starts: ['VERIZON', 'AT&T', 'ATT', 'T MOBILE', 'TMOBILE', 'SPECTRUM', 'CHARTER', 'XFINITY', 'COMCAST'], treat: { action: 'categorize', categoryId: 'phone' }, direction: -1 },
  { starts: ['INTUIT', 'QUICKBOOKS', 'HOUSECALL', 'HOUSECALL PRO', 'ADOBE', 'CANVA', 'GOOGLE WORKSPACE', 'MICROSOFT', 'DROPBOX', 'USPS', 'UPS', 'FEDEX', 'STAPLES', 'OFFICE DEPOT'], treat: { action: 'categorize', categoryId: 'office' }, direction: -1 },
  { starts: ['STATE FARM', 'PROGRESSIVE', 'GEICO', 'NEXT INSURANCE', 'THE HARTFORD', 'HARTFORD', 'NATIONWIDE', 'ALLSTATE', 'HISCOX'], treat: { action: 'categorize', categoryId: 'insurance' }, direction: -1 },
  { starts: ['MO DEPT', 'MISSOURI DEPT', 'MO SOS', 'MISSOURI SOS', 'SECRETARY OF STATE', 'ST LOUIS COUNTY', 'JEFFERSON COUNTY', 'CITY OF'], treat: { action: 'categorize', categoryId: 'licenses' }, direction: -1 },
  { starts: ['STRIPE'], treat: { action: 'transfer', otherAccountId: 'stripe' }, direction: 1 },
  { starts: ['STRIPE'], treat: { action: 'categorize', categoryId: 'fees' }, direction: -1 },
];

/** The starter rule that fits a bank line, if any. */
export function starterTreatment(description: string, amount: number): Treatment | null {
  const key = merchantKey(description);
  const direction = amount < 0 ? -1 : 1;
  for (const rule of starterRules) {
    if (rule.direction && rule.direction !== direction) continue;
    if (rule.starts.some((s) => key === s || key.startsWith(`${s} `))) return rule.treat;
  }
  return null;
}
