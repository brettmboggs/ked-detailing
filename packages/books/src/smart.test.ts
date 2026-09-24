import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fingerprints, isOfx, merchantKey, readBankFile, starterTreatment, validateBooksSettings, withBooksDefaults, defaultBooksSettings } from './index.ts';

const ofx1 = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>USD
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260912120000.000[-5:CDT]
<TRNAMT>-45.99
<FITID>2026091201
<NAME>AUTOZONE #4412
<MEMO>HIGH RIDGE MO
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260913
<TRNAMT>412.30
<FITID>2026091302
<NAME>STRIPE TRANSFER &amp; PAYOUT
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>2026X913
<TRNAMT>-1.00
<FITID>bad
</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

const ofx2 = `<?xml version="1.0" encoding="UTF-8"?>
<?OFX OFXHEADER="200" VERSION="220"?>
<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260914</DTPOSTED><TRNAMT>-89.10</TRNAMT><FITID>X-77</FITID><NAME>CHEMICAL GUYS</NAME></STMTTRN>
</BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`;

test('OFX 1 (SGML): dates with times and zones, entities, NAME + MEMO, bad rows reported', () => {
  assert.ok(isOfx(ofx1));
  const r = readBankFile(ofx1);
  assert.deepEqual(r.rows, [
    { date: '2026-09-12', description: 'AUTOZONE #4412 HIGH RIDGE MO', amount: -4599, bankId: '2026091201' },
    { date: '2026-09-13', description: 'STRIPE TRANSFER & PAYOUT', amount: 41230, bankId: '2026091302' },
  ]);
  assert.equal(r.problems.length, 1);
});

test('OFX 2 (XML) card statements read the same way, and CSV still works', () => {
  assert.deepEqual(readBankFile(ofx2).rows, [{ date: '2026-09-14', description: 'CHEMICAL GUYS', amount: -8910, bankId: 'X-77' }]);
  assert.equal(readBankFile('Date,Description,Amount\n09/01/2026,X,1.00\n').rows.length, 1);
});

test("the bank's own ID makes re-imports safe even when the description changes", () => {
  const a = fingerprints('checking', [{ date: '2026-09-12', description: 'AUTOZONE', amount: -4599, bankId: 'F1' }]);
  const b = fingerprints('checking', [{ date: '2026-09-12', description: 'AUTOZONE #4412 HIGH RIDGE', amount: -4599, bankId: 'F1' }]);
  assert.deepEqual(a, b);
});

test('merchant keys: the same merchant from different descriptions', () => {
  const same = (xs: string[], key: string) => xs.forEach((x) => assert.equal(merchantKey(x), key, x));
  same(['POS DEBIT 09/12 AUTOZONE #4412 HIGH RIDGE MO', 'AUTOZONE 1187 ST LOUIS MO', 'autozone #22'], 'AUTOZONE');
  same(['SQ *JOES DETAIL SUPPLY', 'SQ*JOES DETAIL SUPPLY FENTON MO'], 'JOES DETAIL');
  same(['CHECKCARD 0912 SHELL OIL 57442 FENTON MO', 'SHELL OIL 12345678'], 'SHELL OIL');
  same(['FACEBK *ADS 8Q2X', 'FACEBK ADS'], 'FACEBK ADS');
  assert.equal(merchantKey('CHEMICAL GUYS'), 'CHEMICAL GUYS');
});

test('starter suggestions for common merchants, respecting direction', () => {
  assert.deepEqual(starterTreatment('CHECKCARD 0912 SHELL OIL 57442 FENTON MO', -6140), { action: 'categorize', categoryId: 'fuel' });
  assert.deepEqual(starterTreatment('POS AUTOZONE #4412', -4599), { action: 'categorize', categoryId: 'supplies' });
  assert.deepEqual(starterTreatment('STRIPE TRANSFER ST-X1Y2', 41230), { action: 'transfer', otherAccountId: 'stripe' });
  assert.deepEqual(starterTreatment('STRIPE BILLING', -1500), { action: 'categorize', categoryId: 'fees' });
  assert.equal(starterTreatment('SOME DINER', -1200), null);
  assert.equal(starterTreatment('SHELL OIL', 500), null, 'a refund from a gas station is not fuel spend');
});

test('settings saved before a field existed pick up its default', () => {
  const old = { mileageRates: { '2025': 70 }, salesTax: { enabled: false, rate: 0 }, contractor1099Threshold: 60000 };
  const s = withBooksDefaults(old);
  assert.equal(s.receiptPromptOver, defaultBooksSettings.receiptPromptOver);
  assert.deepEqual(validateBooksSettings(s), []);
});
