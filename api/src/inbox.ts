import { currentBooksSettings } from './books.ts';

/**
 * Everything the books need from Jacob, in one call, for the weekly check-in
 * and the Money tab badge. Each list is short by design: the aim is a few taps
 * a week, not a to-do list he dreads.
 */
export async function booksInbox(db: D1Database) {
  const { settings } = await currentBooksSettings(db);
  const today = new Date().toISOString().slice(0, 10);
  const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

  const [toSort, autoFiled, receipts, trips, unpaid] = await db.batch([
    db.prepare(
      `SELECT COUNT(*) AS n, SUM(CASE WHEN suggestion IS NOT NULL THEN 1 ELSE 0 END) AS suggested
       FROM bank_lines WHERE status = 'unmatched'`,
    ),
    // Filed by his rules in the last week, so he can glance and void a wrong one.
    db
      .prepare(
        `SELECT b.id, b.date, b.description, b.amount, b.entry_id AS entryId FROM bank_lines b
         WHERE b.auto = 1 AND b.created_at >= ? ORDER BY b.date DESC LIMIT 50`,
      )
      .bind(`${daysAgo(7)}T00:00:00Z`),
    // Big expenses in the last 60 days with no receipt yet.
    db
      .prepare(
        `SELECT e.id AS entryId, e.date, e.memo, p.name AS payee, l.amount FROM entries e
         JOIN entry_lines l ON l.entry_id = e.id JOIN accounts a ON a.id = l.account_id
         LEFT JOIN payees p ON p.id = e.payee_id
         WHERE e.kind = 'expense' AND e.voided_by IS NULL AND e.receipt_key IS NULL
           AND a.type = 'expense' AND l.amount >= ? AND e.date >= ?
         ORDER BY e.date DESC LIMIT 20`,
      )
      .bind(settings.receiptPromptOver, daysAgo(60)),
    // Finished jobs in the last two weeks with no drive logged.
    db
      .prepare(
        `SELECT j.id AS jobId, j.local_date AS date, j.address, c.name AS customer FROM jobs j JOIN customers c ON c.id = j.customer_id
         WHERE j.status = 'done' AND j.history = 0 AND j.local_date >= ? AND NOT EXISTS (SELECT 1 FROM trips t WHERE t.job_id = j.id)
         ORDER BY j.local_date DESC LIMIT 20`,
      )
      .bind(daysAgo(14)),
    // Finished jobs with no payment recorded.
    db
      .prepare(
        `SELECT j.id AS jobId, j.local_date AS date, c.name AS customer,
                COALESCE(j.final_price, json_extract(j.quote, '$.total')) AS amount
         FROM jobs j JOIN customers c ON c.id = j.customer_id
         WHERE j.status = 'done' AND j.history = 0 AND j.local_date >= ? AND j.local_date <= ?
           AND NOT EXISTS (SELECT 1 FROM entries e WHERE e.job_id = j.id AND e.kind = 'income' AND e.voided_by IS NULL)
         ORDER BY j.local_date LIMIT 20`,
      )
      .bind(daysAgo(60), today),
  ]);

  const sort = toSort!.results[0] as { n: number; suggested: number | null };
  return {
    bankLines: { waiting: sort.n, withSuggestion: sort.suggested ?? 0 },
    autoFiled: autoFiled!.results,
    receiptsMissing: receipts!.results,
    tripsToLog: trips!.results,
    unpaidJobs: unpaid!.results,
    /** One number for the tab badge. Auto-filed lines don't count: they're done. */
    total: sort.n + receipts!.results.length + trips!.results.length + unpaid!.results.length,
  };
}
