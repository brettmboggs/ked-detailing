import {
  checkLines,
  defaultBooksSettings,
  expenseLines,
  incomeLines,
  LedgerError,
  reverseLines,
  transferLines,
  validateBooksSettings,
  type Account,
  type AccountType,
  type BooksSettings,
  type Line,
} from '@ked/books';
import { ApiError, now, text, ulid } from './lib.ts';

/* ------------------------------------------------------------ helpers */

export function day(value: unknown, field = 'date'): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new ApiError(422, 'invalid', `${field} must be a date like 2026-09-24.`);
  }
  return value;
}

export function cents(value: unknown, field = 'amount'): number {
  if (!(typeof value === 'number' && Number.isInteger(value) && value > 0)) {
    throw new ApiError(422, 'invalid', `${field} must be whole cents above zero.`);
  }
  return value;
}

/** Ledger rules throw LedgerError; the API reports them as 422s. */
function ledger<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof LedgerError) throw new ApiError(422, 'invalid_entry', err.message);
    throw err;
  }
}

/* ----------------------------------------------------------- accounts */

interface AccountRow {
  id: string;
  name: string;
  type: AccountType;
  schedule_c: string | null;
  money_account: number;
  hint: string | null;
  archived: number;
}

const toAccount = (r: AccountRow): Account & { archived: boolean } => ({
  id: r.id,
  name: r.name,
  type: r.type,
  scheduleC: r.schedule_c,
  moneyAccount: r.money_account === 1,
  ...(r.hint ? { hint: r.hint } : {}),
  archived: r.archived === 1,
});

export async function listAccounts(db: D1Database, includeArchived = false) {
  const { results } = await db
    .prepare(`SELECT * FROM accounts ${includeArchived ? '' : 'WHERE archived = 0'} ORDER BY sort, name`)
    .all<AccountRow>();
  return results.map(toAccount);
}

const TYPES: AccountType[] = ['asset', 'liability', 'equity', 'income', 'expense'];

/** A new category or money account, e.g. a second bank account or "Detailing classes". */
export async function addAccount(db: D1Database, body: Record<string, unknown>) {
  const name = text(body.name, 'Name', 60);
  if (!name) throw new ApiError(422, 'invalid', 'Give the account a name.');
  const type = body.type as AccountType;
  if (!TYPES.includes(type)) throw new ApiError(422, 'invalid', `type must be one of ${TYPES.join(', ')}.`);
  const pl = type === 'income' || type === 'expense';
  const scheduleC = pl ? text(body.scheduleC, 'Schedule C line', 4) ?? (type === 'income' ? '1' : '27a') : null;
  const moneyAccount = !pl && type !== 'equity' && body.moneyAccount === true;

  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'account';
  let id = base;
  for (let n = 2; await db.prepare('SELECT 1 FROM accounts WHERE id = ?').bind(id).first(); n++) id = `${base}-${n}`;

  const { next } = (await db.prepare('SELECT COALESCE(MAX(sort), 0) + 10 AS next FROM accounts').first<{ next: number }>())!;
  await db
    .prepare('INSERT INTO accounts (id, name, type, schedule_c, money_account, hint, sort, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, name, type, scheduleC, moneyAccount ? 1 : 0, text(body.hint, 'Hint', 120) ?? null, next, now())
    .run();
  return toAccount((await db.prepare('SELECT * FROM accounts WHERE id = ?').bind(id).first<AccountRow>())!);
}

/** Rename, re-hint or archive. Type never changes: old entries depend on it. */
export async function updateAccount(db: D1Database, id: string, body: Record<string, unknown>) {
  const fields: [string, unknown][] = [];
  if ('name' in body) {
    const name = text(body.name, 'Name', 60);
    if (!name) throw new ApiError(422, 'invalid', "Name can't be empty.");
    fields.push(['name', name]);
  }
  if ('hint' in body) fields.push(['hint', text(body.hint, 'Hint', 120) ?? null]);
  if ('archived' in body) fields.push(['archived', body.archived === true ? 1 : 0]);
  if ('scheduleC' in body) fields.push(['schedule_c', text(body.scheduleC, 'Schedule C line', 4) ?? null]);
  if (fields.length) {
    await db
      .prepare(`UPDATE accounts SET ${fields.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`)
      .bind(...fields.map(([, v]) => v), id)
      .run();
  }
  const row = await db.prepare('SELECT * FROM accounts WHERE id = ?').bind(id).first<AccountRow>();
  if (!row) throw new ApiError(404, 'not_found', 'No account with that ID.');
  return toAccount(row);
}

/* ------------------------------------------------------------- payees */

interface PayeeRow {
  id: string;
  name: string;
  kind: 'vendor' | 'contractor';
  tax_form_on_file: number;
  email: string | null;
  phone: string | null;
  notes: string | null;
}

const toPayee = (r: PayeeRow) => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  taxFormOnFile: r.tax_form_on_file === 1,
  email: r.email,
  phone: r.phone,
  notes: r.notes,
});

export async function listPayees(db: D1Database, q?: string) {
  const query = (q ?? '').trim().toLowerCase().replace(/[%_]/g, '');
  const { results } = query
    ? await db.prepare('SELECT * FROM payees WHERE lower(name) LIKE ? ORDER BY name LIMIT 100').bind(`%${query}%`).all<PayeeRow>()
    : await db.prepare('SELECT * FROM payees ORDER BY name LIMIT 500').all<PayeeRow>();
  return results.map(toPayee);
}

export async function savePayee(db: D1Database, id: string | null, body: Record<string, unknown>) {
  const at = now();
  if (id === null) {
    const name = text(body.name, 'Name', 100);
    if (!name) throw new ApiError(422, 'invalid', 'Give the payee a name.');
    const kind = body.kind === 'contractor' ? 'contractor' : 'vendor';
    id = ulid();
    await db
      .prepare(
        'INSERT INTO payees (id, name, kind, tax_form_on_file, email, phone, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(id, name, kind, body.taxFormOnFile === true ? 1 : 0, text(body.email, 'Email', 200) ?? null,
        text(body.phone, 'Phone', 30) ?? null, text(body.notes, 'Notes', 2000) ?? null, at, at)
      .run();
  } else {
    const fields: [string, unknown][] = [];
    if ('name' in body) {
      const name = text(body.name, 'Name', 100);
      if (!name) throw new ApiError(422, 'invalid', "Name can't be empty.");
      fields.push(['name', name]);
    }
    if ('kind' in body) fields.push(['kind', body.kind === 'contractor' ? 'contractor' : 'vendor']);
    if ('taxFormOnFile' in body) fields.push(['tax_form_on_file', body.taxFormOnFile === true ? 1 : 0]);
    if ('email' in body) fields.push(['email', text(body.email, 'Email', 200) ?? null]);
    if ('phone' in body) fields.push(['phone', text(body.phone, 'Phone', 30) ?? null]);
    if ('notes' in body) fields.push(['notes', text(body.notes, 'Notes', 2000) ?? null]);
    if (fields.length) {
      await db
        .prepare(`UPDATE payees SET ${fields.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
        .bind(...fields.map(([, v]) => v), at, id)
        .run();
    }
  }
  const row = await db.prepare('SELECT * FROM payees WHERE id = ?').bind(id).first<PayeeRow>();
  if (!row) throw new ApiError(404, 'not_found', 'No payee with that ID.');
  return toPayee(row);
}

/** `{ payeeId }` or `{ payee: { name, kind? } }`; a name matches an existing payee case-insensitively. */
export async function resolvePayee(db: D1Database, body: Record<string, unknown>): Promise<string | null> {
  if (typeof body.payeeId === 'string') {
    if (!(await db.prepare('SELECT 1 FROM payees WHERE id = ?').bind(body.payeeId).first())) {
      throw new ApiError(422, 'invalid', 'No payee with that ID.');
    }
    return body.payeeId;
  }
  const p = body.payee as Record<string, unknown> | undefined;
  const name = p ? text(p.name, 'Payee', 100) : undefined;
  if (!name) return null;
  const existing = await db.prepare('SELECT id FROM payees WHERE lower(name) = lower(?)').bind(name).first<{ id: string }>();
  if (existing) return existing.id;
  return (await savePayee(db, null, { name, kind: p!.kind })).id;
}

/* ------------------------------------------------------------ entries */

interface NewEntry {
  date: string;
  kind: 'expense' | 'income' | 'transfer' | 'reversal';
  memo?: string | null;
  payeeId?: string | null;
  jobId?: string | null;
  method?: string | null;
  receiptKey?: string | null;
  reverses?: string | null;
  lines: Line[];
  by: string;
}

/**
 * Entry and lines in one batch, so a half-written entry can't exist. `also`
 * adds statements that must commit with it, such as marking a bank line matched.
 */
export async function postEntry(db: D1Database, e: NewEntry, also: (id: string) => D1PreparedStatement[] = () => []) {
  const accounts = await listAccounts(db);
  ledger(() => checkLines(e.lines, accounts));
  const id = ulid();
  await db.batch([
    db
      .prepare(
        `INSERT INTO entries (id, date, kind, memo, payee_id, job_id, method, receipt_key, reverses, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, e.date, e.kind, e.memo ?? null, e.payeeId ?? null, e.jobId ?? null, e.method ?? null,
        e.receiptKey ?? null, e.reverses ?? null, now(), e.by),
    ...e.lines.map((l, i) =>
      db.prepare('INSERT INTO entry_lines (entry_id, line, account_id, amount) VALUES (?, ?, ?, ?)').bind(id, i + 1, l.accountId, l.amount),
    ),
    ...also(id),
  ]);
  return id;
}

async function jobExists(db: D1Database, jobId: unknown): Promise<string | null> {
  if (jobId === undefined || jobId === null) return null;
  if (typeof jobId !== 'string' || !(await db.prepare('SELECT 1 FROM jobs WHERE id = ?').bind(jobId).first())) {
    throw new ApiError(422, 'invalid', 'No job with that ID.');
  }
  return jobId;
}

/** Money spent. `{ date, amount, categoryId, paidFromId, payeeId | payee, jobId?, memo?, receiptKey? }` */
export async function createExpense(db: D1Database, body: Record<string, unknown>, by: string) {
  const accounts = await listAccounts(db);
  const lines = ledger(() => expenseLines(accounts, cents(body.amount), String(body.categoryId ?? ''), String(body.paidFromId ?? '')));
  const id = await postEntry(db, {
    date: day(body.date),
    kind: 'expense',
    memo: text(body.memo, 'Memo', 500),
    payeeId: await resolvePayee(db, body),
    jobId: await jobExists(db, body.jobId),
    receiptKey: text(body.receiptKey, 'Receipt', 200),
    lines,
    by,
  });
  return getEntry(db, id);
}

/**
 * Money received. For a job, the category defaults to Detailing or Marine
 * detailing by the job's service. `{ date, amount, depositToId, categoryId?, jobId?, method?, payee?, memo? }`
 */
export async function createIncome(db: D1Database, body: Record<string, unknown>, by: string) {
  const accounts = await listAccounts(db);
  const jobId = await jobExists(db, body.jobId);
  let categoryId = typeof body.categoryId === 'string' ? body.categoryId : undefined;
  if (!categoryId) {
    const job = jobId ? await db.prepare('SELECT service FROM jobs WHERE id = ?').bind(jobId).first<{ service: string }>() : null;
    categoryId = job?.service === 'marine' ? 'income-marine' : 'income-detailing';
  }
  const lines = ledger(() => incomeLines(accounts, cents(body.amount), categoryId!, String(body.depositToId ?? '')));
  const id = await postEntry(db, {
    date: day(body.date),
    kind: 'income',
    memo: text(body.memo, 'Memo', 500),
    payeeId: await resolvePayee(db, body),
    jobId,
    method: text(body.method, 'Method', 30),
    lines,
    by,
  });
  return getEntry(db, id);
}

/** Between his own accounts, or an owner draw/contribution. `{ date, amount, fromId, toId, memo? }` */
export async function createTransfer(db: D1Database, body: Record<string, unknown>, by: string) {
  const accounts = await listAccounts(db);
  const lines = ledger(() => transferLines(accounts, cents(body.amount), String(body.fromId ?? ''), String(body.toId ?? '')));
  const id = await postEntry(db, { date: day(body.date), kind: 'transfer', memo: text(body.memo, 'Memo', 500), lines, by });
  return getEntry(db, id);
}

interface EntryRow {
  id: string;
  date: string;
  kind: string;
  memo: string | null;
  payee_id: string | null;
  payee_name: string | null;
  job_id: string | null;
  method: string | null;
  receipt_key: string | null;
  reverses: string | null;
  voided_by: string | null;
  created_at: string;
  created_by: string;
}

async function withLines(db: D1Database, rows: EntryRow[]) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const lines = new Map<string, Line[]>();
  // D1 caps bound parameters per statement, so fetch lines in chunks.
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const { results } = await db
      .prepare(`SELECT entry_id, account_id, amount FROM entry_lines WHERE entry_id IN (${chunk.map(() => '?').join(',')}) ORDER BY entry_id, line`)
      .bind(...chunk)
      .all<{ entry_id: string; account_id: string; amount: number }>();
    for (const l of results) {
      const list = lines.get(l.entry_id) ?? [];
      list.push({ accountId: l.account_id, amount: l.amount });
      lines.set(l.entry_id, list);
    }
  }
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    kind: r.kind,
    memo: r.memo,
    payee: r.payee_id ? { id: r.payee_id, name: r.payee_name } : null,
    jobId: r.job_id,
    method: r.method,
    receiptKey: r.receipt_key,
    reverses: r.reverses,
    voidedBy: r.voided_by,
    lines: lines.get(r.id) ?? [],
    createdAt: r.created_at,
  }));
}

const ENTRY_SELECT = 'SELECT e.*, p.name AS payee_name FROM entries e LEFT JOIN payees p ON p.id = e.payee_id';

export async function getEntry(db: D1Database, id: string) {
  const row = await db.prepare(`${ENTRY_SELECT} WHERE e.id = ?`).bind(id).first<EntryRow>();
  if (!row) throw new ApiError(404, 'not_found', 'No entry with that ID.');
  return (await withLines(db, [row]))[0]!;
}

/** Entries in a date range, newest first; optionally only those touching one account, or one job. */
export async function listEntries(db: D1Database, q: { from?: string; to?: string; accountId?: string; jobId?: string }) {
  const where: string[] = [];
  const args: unknown[] = [];
  if (q.from) (where.push('e.date >= ?'), args.push(day(q.from, 'from')));
  if (q.to) (where.push('e.date <= ?'), args.push(day(q.to, 'to')));
  if (q.accountId) (where.push('e.id IN (SELECT entry_id FROM entry_lines WHERE account_id = ?)'), args.push(q.accountId));
  if (q.jobId) (where.push('e.job_id = ?'), args.push(q.jobId));
  const { results } = await db
    .prepare(`${ENTRY_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY e.date DESC, e.id DESC LIMIT 1000`)
    .bind(...args)
    .all<EntryRow>();
  return withLines(db, results);
}

/**
 * Void: post the exact opposite, dated today unless told otherwise, and free
 * any bank line that was matched to it so it can be matched again.
 */
export async function voidEntry(db: D1Database, id: string, body: Record<string, unknown>, by: string) {
  const entry = await getEntry(db, id);
  if (entry.kind === 'reversal') throw new ApiError(409, 'not_voidable', "A void can't itself be voided. Record the entry again instead.");
  if (entry.voidedBy) throw new ApiError(409, 'already_void', 'That entry is already void.');
  const reversalId = await postEntry(db, {
    date: body.date ? day(body.date) : entry.date,
    kind: 'reversal',
    memo: `Void: ${entry.memo ?? entry.kind}`.slice(0, 500),
    payeeId: entry.payee?.id ?? null,
    jobId: entry.jobId,
    reverses: id,
    lines: reverseLines(entry.lines),
    by,
  });
  await db.batch([
    db.prepare('UPDATE entries SET voided_by = ? WHERE id = ? AND voided_by IS NULL').bind(reversalId, id),
    db.prepare("UPDATE bank_lines SET status = 'unmatched', entry_id = NULL WHERE entry_id = ?").bind(id),
  ]);
  return getEntry(db, reversalId);
}

/* ----------------------------------------------------------- settings */

export async function currentBooksSettings(db: D1Database): Promise<{ settings: BooksSettings; updatedAt: string | null }> {
  const row = await db
    .prepare("SELECT value, updated_at FROM settings WHERE key = 'books'")
    .first<{ value: string; updated_at: string }>();
  if (!row) return { settings: defaultBooksSettings, updatedAt: null };
  return { settings: JSON.parse(row.value) as BooksSettings, updatedAt: row.updated_at };
}

export async function saveBooksSettings(db: D1Database, body: unknown, by: string) {
  const s = body as BooksSettings;
  let errors: string[];
  try {
    errors = validateBooksSettings(s);
  } catch {
    throw new ApiError(422, 'invalid_settings', 'Those are not books settings.');
  }
  if (errors.length) throw new ApiError(422, 'invalid_settings', 'Some settings need fixing.', errors);
  const clean: BooksSettings = {
    mileageRates: Object.fromEntries(Object.entries(s.mileageRates).map(([y, r]) => [y, r])),
    salesTax: { enabled: s.salesTax.enabled, rate: s.salesTax.rate },
    contractor1099Threshold: s.contractor1099Threshold,
  };
  const at = now();
  await db
    .prepare(
      `INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('books', ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    )
    .bind(JSON.stringify(clean), at, by)
    .run();
  return { settings: clean, updatedAt: at };
}
