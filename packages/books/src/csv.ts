/**
 * Bank statement CSVs. Every bank exports a slightly different file, so this
 * finds the columns by their headers instead of assuming an order, and copes
 * with the usual variations: one signed Amount column or separate
 * Debit/Credit columns, $ signs, thousands commas, (parentheses) for
 * negatives, and US or ISO dates.
 */

/**
 * RFC 4180-ish: quoted fields, doubled quotes, commas and newlines inside
 * quotes. Blank rows are dropped unless `keepBlank`, which keeps row numbers
 * lined up with the spreadsheet for error messages.
 */
export function parseCsv(text: string, { keepBlank = false } = {}): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return keepBlank ? rows : rows.filter((r) => r.some((f) => f.trim() !== ''));
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v);
    // Leading =, +, -, @ would run as a formula in Excel; prefix a quote.
    const safe = /^[=+\-@]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

export interface BankRow {
  /** 'YYYY-MM-DD' */
  date: string;
  description: string;
  /** Signed cents, from the account's point of view: + money in, − money out. */
  amount: number;
  /** The bank's own transaction ID, when the file has one (OFX FITID). */
  bankId?: string;
}

export interface BankCsvResult {
  rows: BankRow[];
  /** Rows that couldn't be read, by line number, so nothing is skipped silently. */
  problems: string[];
}

const DATE_HEADERS = ['date', 'posted date', 'posting date', 'transaction date', 'trans. date', 'trans date'];
const DESC_HEADERS = ['description', 'memo', 'payee', 'name', 'details', 'transaction description', 'merchant'];
const AMOUNT_HEADERS = ['amount', 'transaction amount'];
const DEBIT_HEADERS = ['debit', 'withdrawal', 'withdrawals', 'debit amount', 'money out'];
const CREDIT_HEADERS = ['credit', 'deposit', 'deposits', 'credit amount', 'money in'];

function find(headers: string[], names: string[]): number {
  for (const n of names) {
    const i = headers.indexOf(n);
    if (i !== -1) return i;
  }
  return -1;
}

/** "$1,234.56", "(12.00)", "-12", "12.5-" → signed cents; null if not a number. */
export function parseMoney(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  s = s.replace(/[$,\s]/g, '');
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) s = s.slice(1);
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.') as [string, string?];
  const cents = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  return negative ? -cents : cents;
}

/** "03/05/2026", "3/5/26", "2026-03-05" → "2026-03-05"; null if unreadable. */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  let match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/))) {
    m = Number(match[1]);
    d = Number(match[2]);
    y = Number(match[3]);
    if (y < 100) y += 2000;
  } else return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Read a bank or card statement. `invert` flips signs for card exports that
 * list purchases as positive numbers.
 */
export function readBankCsv(text: string, options: { invert?: boolean } = {}): BankCsvResult {
  const table = parseCsv(text);
  // Some banks put account details above the real header row; take the first
  // row that has both a date and an amount-ish column.
  let headerAt = -1;
  let headers: string[] = [];
  for (let i = 0; i < Math.min(table.length, 15); i++) {
    const h = table[i]!.map((c) => c.trim().toLowerCase());
    const hasMoney = find(h, AMOUNT_HEADERS) !== -1 || (find(h, DEBIT_HEADERS) !== -1 && find(h, CREDIT_HEADERS) !== -1);
    if (find(h, DATE_HEADERS) !== -1 && hasMoney) {
      headerAt = i;
      headers = h;
      break;
    }
  }
  if (headerAt === -1) {
    return { rows: [], problems: ["Couldn't find the Date and Amount columns. Is this the bank's CSV download?"] };
  }

  const col = {
    date: find(headers, DATE_HEADERS),
    desc: find(headers, DESC_HEADERS),
    amount: find(headers, AMOUNT_HEADERS),
    debit: find(headers, DEBIT_HEADERS),
    credit: find(headers, CREDIT_HEADERS),
  };
  const rows: BankRow[] = [];
  const problems: string[] = [];
  for (let i = headerAt + 1; i < table.length; i++) {
    const r = table[i]!;
    const line = i + 1;
    const date = parseDate(r[col.date] ?? '');
    let amount: number | null;
    if (col.amount !== -1) amount = parseMoney(r[col.amount] ?? '');
    else {
      const out = parseMoney(r[col.debit] ?? '');
      const inn = parseMoney(r[col.credit] ?? '');
      amount = out === null && inn === null ? null : (inn ?? 0) - Math.abs(out ?? 0);
    }
    if (!date) {
      problems.push(`Line ${line}: couldn't read the date "${r[col.date] ?? ''}".`);
      continue;
    }
    if (amount === null) {
      problems.push(`Line ${line}: couldn't read the amount.`);
      continue;
    }
    if (amount === 0) continue;
    const description = (col.desc !== -1 ? r[col.desc] : '')?.trim().replace(/\s+/g, ' ').slice(0, 300) ?? '';
    rows.push({ date, description, amount: options.invert ? -amount : amount });
  }
  return { rows, problems };
}

/**
 * A stable key per bank row, so importing an overlapping statement twice
 * doesn't double anything. Identical rows on the same day (two $5 car washes)
 * are told apart by their order within the file.
 */
export function fingerprints(accountId: string, rows: BankRow[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    // The bank's own ID is permanent; prefer it when the file has one.
    if (r.bankId) return `${accountId}|id|${r.bankId}`;
    const base = `${accountId}|${r.date}|${r.amount}|${r.description.toLowerCase()}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `${base}|${n}`;
  });
}
