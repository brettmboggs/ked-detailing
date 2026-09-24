import { expenseLines, fingerprints, incomeLines, LedgerError, matchBank, readBankCsv, transferLines } from '@ked/books';
import { listAccounts, postEntry, resolvePayee } from './books.ts';
import { ApiError, now, text, ulid } from './lib.ts';

interface BankLineRow {
  id: string;
  import_id: string;
  account_id: string;
  date: string;
  description: string;
  amount: number;
  status: 'unmatched' | 'matched' | 'ignored';
  entry_id: string | null;
}

const toBankLine = (r: BankLineRow) => ({
  id: r.id,
  importId: r.import_id,
  accountId: r.account_id,
  date: r.date,
  description: r.description,
  amount: r.amount,
  status: r.status,
  entryId: r.entry_id,
});

async function moneyAccount(db: D1Database, id: unknown) {
  const account = (await listAccounts(db)).find((a) => a.id === id);
  if (!account || !account.moneyAccount) throw new ApiError(422, 'invalid', 'Pick a bank, card or cash account.');
  return account;
}

/**
 * Upload a statement CSV for one account. Rows already imported are skipped by
 * fingerprint, so overlapping statements are safe. New rows are matched to
 * entries already in the books; the rest wait for Jacob.
 */
export async function importBank(db: D1Database, body: Record<string, unknown>) {
  const account = await moneyAccount(db, body.accountId);
  if (typeof body.csv !== 'string' || !body.csv.trim()) throw new ApiError(422, 'invalid', 'Attach the CSV file from the bank.');
  if (body.csv.length > 2_000_000) throw new ApiError(422, 'invalid', 'That file is too big. Export a shorter date range.');

  const { rows, problems } = readBankCsv(body.csv, { invert: body.invert === true });
  if (!rows.length) throw new ApiError(422, 'unreadable', "Couldn't read any transactions from that file.", problems);

  const importId = ulid();
  const at = now();
  // The import row first: every bank line points at it.
  await db
    .prepare('INSERT INTO bank_imports (id, account_id, filename, rows, added, created_at) VALUES (?, ?, ?, ?, 0, ?)')
    .bind(importId, account.id, text(body.filename, 'File name', 200) ?? null, rows.length, at)
    .run();
  const prints = fingerprints(account.id, rows);
  let added = 0;
  // D1 batches are transactions; keep them modest in size.
  for (let i = 0; i < rows.length; i += 50) {
    const results = await db.batch(
      rows.slice(i, i + 50).map((r, j) =>
        db
          .prepare(
            `INSERT OR IGNORE INTO bank_lines (id, import_id, account_id, date, description, amount, fingerprint, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(ulid(), importId, account.id, r.date, r.description, r.amount, prints[i + j], at),
      ),
    );
    added += results.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
  }
  await db.prepare('UPDATE bank_imports SET added = ? WHERE id = ?').bind(added, importId).run();

  const matched = await autoMatch(db, account.id);
  const { waiting } = (await db
    .prepare("SELECT COUNT(*) AS waiting FROM bank_lines WHERE account_id = ? AND status = 'unmatched'")
    .bind(account.id)
    .first<{ waiting: number }>())!;
  return { importId, rows: rows.length, added, duplicates: rows.length - added, matched, waiting, problems };
}

/** Match this account's waiting bank lines to unmatched, unvoided entries. Returns how many matched. */
export async function autoMatch(db: D1Database, accountId: string): Promise<number> {
  const { results: waiting } = await db
    .prepare("SELECT id, date, amount FROM bank_lines WHERE account_id = ? AND status = 'unmatched'")
    .bind(accountId)
    .all<{ id: string; date: string; amount: number }>();
  if (!waiting.length) return 0;
  const dates = waiting.map((w) => w.date).sort();
  const shift = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

  const { results: candidates } = await db
    .prepare(
      `SELECT e.id AS entryId, e.date, l.amount FROM entry_lines l JOIN entries e ON e.id = l.entry_id
       WHERE l.account_id = ? AND e.voided_by IS NULL AND e.kind != 'reversal' AND e.date BETWEEN ? AND ?
         AND NOT EXISTS (SELECT 1 FROM bank_lines b WHERE b.entry_id = e.id)`,
    )
    .bind(accountId, shift(dates[0]!, -7), shift(dates.at(-1)!, 7))
    .all<{ entryId: string; date: string; amount: number }>();

  const pairs = matchBank(waiting, candidates);
  if (!pairs.size) return 0;
  await db.batch(
    [...pairs].map(([bankId, entryId]) =>
      db.prepare("UPDATE bank_lines SET status = 'matched', entry_id = ? WHERE id = ? AND status = 'unmatched'").bind(entryId, bankId),
    ),
  );
  return pairs.size;
}

export async function listBankLines(db: D1Database, q: { status?: string; accountId?: string }) {
  const where: string[] = [];
  const args: unknown[] = [];
  if (q.status) {
    if (!['unmatched', 'matched', 'ignored'].includes(q.status)) throw new ApiError(422, 'invalid', 'status must be unmatched, matched or ignored.');
    where.push('status = ?');
    args.push(q.status);
  }
  if (q.accountId) (where.push('account_id = ?'), args.push(q.accountId));
  const { results } = await db
    .prepare(`SELECT * FROM bank_lines ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY date DESC, id DESC LIMIT 1000`)
    .bind(...args)
    .all<BankLineRow>();
  return results.map(toBankLine);
}

async function getBankLine(db: D1Database, id: string) {
  const row = await db.prepare('SELECT * FROM bank_lines WHERE id = ?').bind(id).first<BankLineRow>();
  if (!row) throw new ApiError(404, 'not_found', 'No bank line with that ID.');
  return row;
}

const markMatched = (db: D1Database, lineId: string) => (entryId: string) => [
  db.prepare("UPDATE bank_lines SET status = 'matched', entry_id = ? WHERE id = ?").bind(entryId, lineId),
];

/**
 * Jacob deals with a waiting bank line in one of four ways:
 *   { action: 'categorize', categoryId, payeeId? | payee?, memo?, jobId? } — record it as an expense or income
 *   { action: 'transfer', otherAccountId, memo? } — money moving between his own accounts, or an owner draw
 *   { action: 'match', entryId } — it's an entry already in the books that auto-matching missed
 *   { action: 'ignore' } / { action: 'unignore' }
 */
export async function resolveBankLine(db: D1Database, id: string, body: Record<string, unknown>, by: string) {
  const line = await getBankLine(db, id);
  const action = body.action;
  if (action === 'unignore') {
    if (line.status !== 'ignored') throw new ApiError(409, 'not_ignored', "That line isn't ignored.");
    await db.prepare("UPDATE bank_lines SET status = 'unmatched' WHERE id = ?").bind(id).run();
    return toBankLine(await getBankLine(db, id));
  }
  if (line.status !== 'unmatched') throw new ApiError(409, 'already_resolved', 'That line has already been dealt with.');

  const accounts = await listAccounts(db);
  const amount = Math.abs(line.amount);
  const memo = text(body.memo, 'Memo', 500) ?? line.description;
  const wrap = <T>(fn: () => T) => {
    try {
      return fn();
    } catch (err) {
      if (err instanceof LedgerError) throw new ApiError(422, 'invalid_entry', err.message);
      throw err;
    }
  };

  if (action === 'categorize') {
    const categoryId = String(body.categoryId ?? '');
    const lines = wrap(() =>
      line.amount < 0
        ? expenseLines(accounts, amount, categoryId, line.account_id)
        : incomeLines(accounts, amount, categoryId, line.account_id),
    );
    await postEntry(
      db,
      {
        date: line.date,
        kind: line.amount < 0 ? 'expense' : 'income',
        memo,
        payeeId: await resolvePayee(db, body),
        jobId: typeof body.jobId === 'string' ? body.jobId : null,
        lines,
        by,
      },
      markMatched(db, id),
    );
  } else if (action === 'transfer') {
    const other = String(body.otherAccountId ?? '');
    const lines = wrap(() =>
      line.amount < 0 ? transferLines(accounts, amount, line.account_id, other) : transferLines(accounts, amount, other, line.account_id),
    );
    await postEntry(db, { date: line.date, kind: 'transfer', memo, lines, by }, markMatched(db, id));
    // The other side may already be imported (paying the card from checking).
    await autoMatch(db, other);
  } else if (action === 'match') {
    const entryId = String(body.entryId ?? '');
    const fits = await db
      .prepare(
        `SELECT 1 FROM entry_lines l JOIN entries e ON e.id = l.entry_id
         WHERE e.id = ? AND l.account_id = ? AND l.amount = ? AND e.voided_by IS NULL AND e.kind != 'reversal'
           AND NOT EXISTS (SELECT 1 FROM bank_lines b WHERE b.entry_id = e.id)`,
      )
      .bind(entryId, line.account_id, line.amount)
      .first();
    if (!fits) throw new ApiError(422, 'no_match', "That entry doesn't have this amount on this account, or it's already matched.");
    await db.batch(markMatched(db, id)(entryId));
  } else if (action === 'ignore') {
    await db.prepare("UPDATE bank_lines SET status = 'ignored' WHERE id = ?").bind(id).run();
  } else {
    throw new ApiError(422, 'invalid', 'action must be categorize, transfer, match, ignore or unignore.');
  }
  return toBankLine(await getBankLine(db, id));
}

