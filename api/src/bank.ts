import {
  expenseLines,
  fingerprints,
  incomeLines,
  LedgerError,
  matchBank,
  merchantKey,
  readBankFile,
  starterTreatment,
  transferLines,
  type Line,
} from '@ked/books';
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
  merchant: string | null;
  suggestion: string | null;
  auto: number;
}

/**
 * A decision about a bank line. Jacob makes one by hand; a rule he taught the
 * books makes one for him; a suggestion is one waiting for his tap.
 */
export type Decision =
  | { action: 'categorize'; categoryId: string; payeeId?: string | null }
  | { action: 'transfer'; otherAccountId: string }
  | { action: 'personal' }
  | { action: 'job'; jobId: string };

type Suggestion = Decision & { source: 'starter' | 'job'; label: string };

const toBankLine = (r: BankLineRow) => ({
  id: r.id,
  importId: r.import_id,
  accountId: r.account_id,
  date: r.date,
  description: r.description,
  merchant: r.merchant,
  amount: r.amount,
  status: r.status,
  entryId: r.entry_id,
  /** What the books think this is; `{ action: 'accept' }` applies it. */
  suggestion: r.suggestion ? (JSON.parse(r.suggestion) as Suggestion) : null,
  /** Filed by one of Jacob's rules without asking. */
  auto: r.auto === 1,
});

async function moneyAccount(db: D1Database, id: unknown) {
  const account = (await listAccounts(db)).find((a) => a.id === id);
  if (!account || !account.moneyAccount) throw new ApiError(422, 'invalid', 'Pick a bank, card or cash account.');
  return account;
}

/**
 * Upload a statement for one account: OFX/QFX/QBO or CSV, detected from the
 * content. Rows already imported are skipped. New rows are matched to entries
 * already in the books, filed by Jacob's rules where one fits, and given a
 * suggestion where one can be made; only the rest need him.
 */
export async function importBank(db: D1Database, body: Record<string, unknown>, by: string) {
  const account = await moneyAccount(db, body.accountId);
  // `file` is the field name now; `csv` still works for older app builds.
  const file = typeof body.file === 'string' ? body.file : body.csv;
  if (typeof file !== 'string' || !file.trim()) throw new ApiError(422, 'invalid', 'Attach the file from the bank.');
  if (file.length > 2_000_000) throw new ApiError(422, 'invalid', 'That file is too big. Export a shorter date range.');

  const { rows, problems } = readBankFile(file, { invert: body.invert === true });
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
            `INSERT OR IGNORE INTO bank_lines (id, import_id, account_id, date, description, merchant, amount, fingerprint, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(ulid(), importId, account.id, r.date, r.description, merchantKey(r.description), r.amount, prints[i + j], at),
      ),
    );
    added += results.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
  }
  await db.prepare('UPDATE bank_imports SET added = ? WHERE id = ?').bind(added, importId).run();

  const matched = await autoMatch(db, account.id);
  const { filed, suggested } = await smartSort(db, account.id, by);
  const { waiting } = (await db
    .prepare("SELECT COUNT(*) AS waiting FROM bank_lines WHERE account_id = ? AND status = 'unmatched'")
    .bind(account.id)
    .first<{ waiting: number }>())!;
  return { importId, rows: rows.length, added, duplicates: rows.length - added, matched, filed, suggested, waiting, problems };
}

/** Match this account's waiting bank lines to unmatched, unvoided entries. Returns how many matched. */
export async function autoMatch(db: D1Database, accountId: string): Promise<number> {
  const { results: waiting } = await db
    .prepare("SELECT id, date, amount FROM bank_lines WHERE account_id = ? AND status = 'unmatched'")
    .bind(accountId)
    .all<{ id: string; date: string; amount: number }>();
  if (!waiting.length) return 0;
  const dates = waiting.map((w) => w.date).sort();

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
      db
        .prepare("UPDATE bank_lines SET status = 'matched', entry_id = ?, suggestion = NULL WHERE id = ? AND status = 'unmatched'")
        .bind(entryId, bankId),
    ),
  );
  return pairs.size;
}

const shift = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

interface RuleRow {
  id: string;
  merchant: string;
  direction: -1 | 1;
  action: 'categorize' | 'transfer' | 'personal';
  category_id: string | null;
  other_account_id: string | null;
  payee_id: string | null;
  hits: number;
}

const ruleDecision = (r: RuleRow): Decision =>
  r.action === 'categorize'
    ? { action: 'categorize', categoryId: r.category_id!, payeeId: r.payee_id }
    : r.action === 'transfer'
      ? { action: 'transfer', otherAccountId: r.other_account_id! }
      : { action: 'personal' };

/**
 * For every waiting line on an account: file it if Jacob has a rule for that
 * merchant, otherwise suggest what it probably is. A deposit that equals an
 * unpaid job's price is suggested as that job's payment; common merchants get
 * their usual category.
 */
export async function smartSort(db: D1Database, accountId: string, by: string) {
  const { results: waiting } = await db
    .prepare("SELECT * FROM bank_lines WHERE account_id = ? AND status = 'unmatched' ORDER BY date")
    .bind(accountId)
    .all<BankLineRow>();
  if (!waiting.length) return { filed: 0, suggested: 0 };

  const { results: rules } = await db.prepare('SELECT * FROM bank_rules').all<RuleRow>();
  const names = new Map((await listAccounts(db)).map((a) => [a.id, a.name]));
  const ruleFor = new Map(rules.map((r) => [`${r.merchant}|${r.direction}`, r]));
  let filed = 0;
  let suggested = 0;

  for (const line of waiting) {
    const merchant = line.merchant ?? merchantKey(line.description);
    const rule = ruleFor.get(`${merchant}|${line.amount < 0 ? -1 : 1}`);
    if (rule) {
      try {
        await applyDecision(db, line, ruleDecision(rule), by, { auto: true });
        await db.prepare('UPDATE bank_rules SET hits = hits + 1 WHERE id = ?').bind(rule.id).run();
        filed++;
        continue;
      } catch (err) {
        // A rule that no longer fits (an archived category, say) just stops
        // auto-filing; the line waits for Jacob like any other.
        if (!(err instanceof ApiError)) throw err;
      }
    }
    const suggestion = (await jobSuggestion(db, line)) ?? starterSuggestion(line, names);
    if (suggestion) suggested++;
    await db.prepare('UPDATE bank_lines SET suggestion = ? WHERE id = ?').bind(suggestion ? JSON.stringify(suggestion) : null, line.id).run();
  }
  return { filed, suggested };
}

/** A deposit the same size as a recent job that has no payment recorded yet. */
async function jobSuggestion(db: D1Database, line: BankLineRow): Promise<Suggestion | null> {
  if (line.amount <= 0) return null;
  const job = await db
    .prepare(
      `SELECT j.id, j.local_date, c.name FROM jobs j JOIN customers c ON c.id = j.customer_id
       WHERE j.status != 'cancelled' AND j.local_date BETWEEN ? AND ?
         AND COALESCE(j.final_price, json_extract(j.quote, '$.total')) = ?
         AND NOT EXISTS (SELECT 1 FROM entries e WHERE e.job_id = j.id AND e.kind = 'income' AND e.voided_by IS NULL)
       ORDER BY abs(julianday(j.local_date) - julianday(?)) LIMIT 1`,
    )
    .bind(shift(line.date, -21), line.date, line.amount, line.date)
    .first<{ id: string; local_date: string; name: string }>();
  if (!job) return null;
  return { action: 'job', jobId: job.id, source: 'job', label: `Payment for ${job.name}'s job on ${job.local_date}` };
}

/** The usual home for a common merchant, labelled in the words Jacob sees. */
function starterSuggestion(line: BankLineRow, names: Map<string, string>): Suggestion | null {
  const t = starterTreatment(line.description, line.amount);
  if (!t) return null;
  // A starter rule pointing at an account he has archived or renamed away is skipped.
  const target = t.action === 'categorize' ? t.categoryId : t.action === 'transfer' ? t.otherAccountId : null;
  if (target && !names.has(target)) return null;
  const label =
    t.action === 'categorize'
      ? `Looks like ${names.get(t.categoryId)}`
      : t.action === 'transfer'
        ? `Looks like a transfer ${line.amount < 0 ? 'to' : 'from'} ${names.get(t.otherAccountId)}`
        : 'Looks personal';
  return { ...t, source: 'starter', label };
}

/** Post the entry a decision describes and mark the line matched to it, in one batch. */
async function applyDecision(db: D1Database, line: BankLineRow, d: Decision, by: string, opts: { memo?: string | null; auto?: boolean } = {}) {
  const accounts = await listAccounts(db);
  const amount = Math.abs(line.amount);
  const out = line.amount < 0;
  const memo = opts.memo ?? line.description;
  const ledger = (fn: () => Line[]) => {
    try {
      return fn();
    } catch (err) {
      if (err instanceof LedgerError) throw new ApiError(422, 'invalid_entry', err.message);
      throw err;
    }
  };

  let entry: Parameters<typeof postEntry>[1];
  if (d.action === 'categorize') {
    const lines = ledger(() =>
      out ? expenseLines(accounts, amount, d.categoryId, line.account_id) : incomeLines(accounts, amount, d.categoryId, line.account_id),
    );
    entry = { date: line.date, kind: out ? 'expense' : 'income', memo, payeeId: d.payeeId ?? null, lines, by };
  } else if (d.action === 'transfer' || d.action === 'personal') {
    // Personal money out is an owner draw; personal money in is a contribution.
    const other = d.action === 'transfer' ? d.otherAccountId : out ? 'owner-draws' : 'owner-contributions';
    const lines = ledger(() => (out ? transferLines(accounts, amount, line.account_id, other) : transferLines(accounts, amount, other, line.account_id)));
    entry = { date: line.date, kind: 'transfer', memo: d.action === 'personal' ? `Personal: ${memo}` : memo, lines, by };
  } else {
    if (out) throw new ApiError(422, 'invalid', 'Only money coming in can be a job payment.');
    const job = await db.prepare('SELECT id, service FROM jobs WHERE id = ?').bind(d.jobId).first<{ id: string; service: string }>();
    if (!job) throw new ApiError(422, 'invalid', 'No job with that ID.');
    const lines = ledger(() => incomeLines(accounts, amount, job.service === 'marine' ? 'income-marine' : 'income-detailing', line.account_id));
    entry = { date: line.date, kind: 'income', memo, jobId: job.id, method: 'bank deposit', lines, by };
  }

  await postEntry(db, entry, (entryId) => [
    db
      .prepare("UPDATE bank_lines SET status = 'matched', entry_id = ?, auto = ?, suggestion = NULL WHERE id = ?")
      .bind(entryId, opts.auto ? 1 : 0, line.id),
  ]);
  if (d.action === 'transfer') await autoMatch(db, d.otherAccountId);
}

/** Remember how Jacob filed this merchant, so the next one files itself. */
async function learn(db: D1Database, line: BankLineRow, d: Decision) {
  if (d.action === 'job') return; // a job payment is one-off, not a merchant habit
  const merchant = line.merchant ?? merchantKey(line.description);
  const at = now();
  await db
    .prepare(
      `INSERT INTO bank_rules (id, merchant, direction, action, category_id, other_account_id, payee_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (merchant, direction) DO UPDATE SET action = excluded.action, category_id = excluded.category_id,
         other_account_id = excluded.other_account_id, payee_id = excluded.payee_id, updated_at = excluded.updated_at`,
    )
    .bind(
      ulid(), merchant, line.amount < 0 ? -1 : 1, d.action,
      d.action === 'categorize' ? d.categoryId : null,
      d.action === 'transfer' ? d.otherAccountId : null,
      d.action === 'categorize' ? d.payeeId ?? null : null,
      at, at,
    )
    .run();
}

export async function listBankLines(db: D1Database, q: { status?: string; accountId?: string; auto?: string }) {
  const where: string[] = [];
  const args: unknown[] = [];
  if (q.status) {
    if (!['unmatched', 'matched', 'ignored'].includes(q.status)) throw new ApiError(422, 'invalid', 'status must be unmatched, matched or ignored.');
    where.push('status = ?');
    args.push(q.status);
  }
  if (q.accountId) (where.push('account_id = ?'), args.push(q.accountId));
  if (q.auto === 'true') where.push('auto = 1');
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

/**
 * Jacob deals with a waiting bank line:
 *   { action: 'accept' } — take the suggestion
 *   { action: 'categorize', categoryId, payeeId? | payee?, memo? }
 *   { action: 'transfer', otherAccountId, memo? }
 *   { action: 'personal' } — not business money: an owner draw or contribution
 *   { action: 'job', jobId } — a customer's payment for a job
 *   { action: 'match', entryId } — an entry already in the books
 *   { action: 'ignore' } / { action: 'unignore' }
 * Categorize, transfer and personal are remembered for that merchant unless
 * `remember: false`, so the next one files itself.
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

  let decision: Decision | null = null;
  if (action === 'accept') {
    if (!line.suggestion) throw new ApiError(409, 'no_suggestion', "There's no suggestion for that line. Pick a category.");
    const { source: _s, label: _l, ...d } = JSON.parse(line.suggestion) as Suggestion;
    decision = d as Decision;
  } else if (action === 'categorize') {
    decision = { action: 'categorize', categoryId: String(body.categoryId ?? ''), payeeId: await resolvePayee(db, body) };
  } else if (action === 'transfer') {
    decision = { action: 'transfer', otherAccountId: String(body.otherAccountId ?? '') };
  } else if (action === 'personal') {
    decision = { action: 'personal' };
  } else if (action === 'job') {
    decision = { action: 'job', jobId: String(body.jobId ?? '') };
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
    await db.prepare("UPDATE bank_lines SET status = 'matched', entry_id = ?, suggestion = NULL WHERE id = ?").bind(entryId, id).run();
    return toBankLine(await getBankLine(db, id));
  } else if (action === 'ignore') {
    await db.prepare("UPDATE bank_lines SET status = 'ignored' WHERE id = ?").bind(id).run();
    return toBankLine(await getBankLine(db, id));
  } else {
    throw new ApiError(422, 'invalid', 'action must be accept, categorize, transfer, personal, job, match, ignore or unignore.');
  }

  await applyDecision(db, line, decision, by, { memo: text(body.memo, 'Memo', 500) });
  if (body.remember !== false) {
    await learn(db, line, decision);
    // Other waiting lines from the same merchant can file themselves now.
    await smartSort(db, line.account_id, by);
  }
  return toBankLine(await getBankLine(db, id));
}

/* -------------------------------------------------------------- rules */

export async function listRules(db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT r.*, a.name AS category_name, o.name AS other_name, p.name AS payee_name FROM bank_rules r
       LEFT JOIN accounts a ON a.id = r.category_id LEFT JOIN accounts o ON o.id = r.other_account_id
       LEFT JOIN payees p ON p.id = r.payee_id ORDER BY r.hits DESC, r.merchant`,
    )
    .all<RuleRow & { category_name: string | null; other_name: string | null; payee_name: string | null }>();
  return results.map((r) => ({
    id: r.id,
    merchant: r.merchant,
    direction: r.direction === -1 ? 'out' : 'in',
    action: r.action,
    categoryId: r.category_id,
    categoryName: r.category_name,
    otherAccountId: r.other_account_id,
    otherAccountName: r.other_name,
    payee: r.payee_id ? { id: r.payee_id, name: r.payee_name } : null,
    hits: r.hits,
  }));
}

/** Forget a rule. Entries it already filed stay; void them to undo. */
export async function deleteRule(db: D1Database, id: string) {
  const { meta } = await db.prepare('DELETE FROM bank_rules WHERE id = ?').bind(id).run();
  if (meta.changes !== 1) throw new ApiError(404, 'not_found', 'No rule with that ID.');
}
