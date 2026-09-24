import type { BankRow, BankCsvResult } from './csv.ts';
import { readBankCsv } from './csv.ts';

/**
 * OFX, and the QFX (Quicken) and QBO (QuickBooks) files built on it: what
 * Commerce Bank and most US banks offer next to CSV. Better than CSV because
 * every transaction carries the bank's own permanent ID (FITID), so
 * re-importing can never double anything.
 *
 * Handles both OFX 1.x (SGML, closing tags optional) and 2.x (XML).
 */

export function isOfx(text: string): boolean {
  return /OFXHEADER|<OFX>/i.test(text.slice(0, 2000));
}

/** A tag's value inside a block: up to the next tag, closing or not. */
function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, 'i'));
  if (!m) return null;
  return decode(m[1]!.trim());
}

const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");

/** OFX dates: YYYYMMDD, optionally followed by a time and zone. */
function ofxDate(raw: string | null): string | null {
  const m = raw?.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const t = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (t.getUTCDate() !== Number(d)) return null;
  return `${y}-${mo}-${d}`;
}

/** OFX amounts are plain signed decimals; some banks use a comma for the point. */
function ofxAmount(raw: string | null): number | null {
  if (!raw) return null;
  const s = raw.replace(',', '.').replace(/\s/g, '');
  if (!/^[+-]?\d+(\.\d{1,4})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

export function readOfx(text: string): BankCsvResult {
  const rows: BankRow[] = [];
  const problems: string[] = [];
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  if (!blocks.length) return { rows, problems: ['No transactions found in that file.'] };

  blocks.forEach((raw, i) => {
    const block = raw.split(/<\/STMTTRN>/i)[0]!;
    const date = ofxDate(tag(block, 'DTPOSTED'));
    const amount = ofxAmount(tag(block, 'TRNAMT'));
    if (!date || amount === null) {
      problems.push(`Transaction ${i + 1}: couldn't read its date or amount.`);
      return;
    }
    if (amount === 0) return;
    const name = tag(block, 'NAME') ?? '';
    const memo = tag(block, 'MEMO') ?? '';
    // Many banks truncate NAME at 32 characters and put the rest in MEMO.
    const description = (memo && !name.includes(memo) ? `${name} ${memo}` : name || memo).replace(/\s+/g, ' ').trim().slice(0, 300);
    const fitid = tag(block, 'FITID');
    rows.push({ date, description, amount, ...(fitid ? { bankId: fitid } : {}) });
  });
  return { rows, problems };
}

/** Any bank export: OFX/QFX/QBO or CSV, detected from the content. */
export function readBankFile(text: string, options: { invert?: boolean } = {}): BankCsvResult {
  if (!isOfx(text)) return readBankCsv(text, options);
  // OFX signs are already from the account's point of view (card purchases are
  // negative), so `invert` is only for CSVs.
  return readOfx(text);
}
