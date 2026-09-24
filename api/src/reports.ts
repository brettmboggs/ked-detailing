import { balances, mileageDeduction, profitLoss, toCsv, type PostedLine } from '@ked/books';
import { currentBooksSettings, day, listAccounts } from './books.ts';
import { ApiError, now, text, ulid } from './lib.ts';

const dollars = (c: number) => (c / 100).toFixed(2);

function year(value: unknown): string {
  const y = String(value ?? new Date().getUTCFullYear());
  if (!/^\d{4}$/.test(y)) throw new ApiError(422, 'invalid', 'year must be like 2026.');
  return y;
}

/** from/to default to the current calendar year. */
function period(from?: string, to?: string) {
  const y = new Date().getUTCFullYear();
  return { from: from ? day(from, 'from') : `${y}-01-01`, to: to ? day(to, 'to') : `${y}-12-31` };
}

async function linesBetween(db: D1Database, from: string | null, to: string): Promise<PostedLine[]> {
  const { results } = await db
    .prepare(
      `SELECT l.account_id AS accountId, l.amount FROM entry_lines l JOIN entries e ON e.id = l.entry_id
       WHERE e.date <= ? ${from ? 'AND e.date >= ?' : ''}`,
    )
    .bind(...(from ? [to, from] : [to]))
    .all<PostedLine>();
  return results;
}

export async function profitLossReport(db: D1Database, from?: string, to?: string) {
  const p = period(from, to);
  const accounts = await listAccounts(db, true);
  return { ...p, ...profitLoss(accounts, await linesBetween(db, p.from, p.to)) };
}

export async function balancesReport(db: D1Database, asOf?: string) {
  const date = asOf ? day(asOf, 'asOf') : new Date().toISOString().slice(0, 10);
  const accounts = await listAccounts(db, true);
  return { asOf: date, accounts: balances(accounts, await linesBetween(db, null, date)) };
}

/** What each contractor was paid in a year, flagged when it reaches the 1099 threshold. */
export async function contractorsReport(db: D1Database, y?: string) {
  const yr = year(y);
  const { settings } = await currentBooksSettings(db);
  const { results } = await db
    .prepare(
      `SELECT p.id, p.name, p.tax_form_on_file AS taxFormOnFile, SUM(l.amount) AS total
       FROM entries e JOIN payees p ON p.id = e.payee_id
       JOIN entry_lines l ON l.entry_id = e.id JOIN accounts a ON a.id = l.account_id
       WHERE p.kind = 'contractor' AND a.type = 'expense' AND e.date BETWEEN ? AND ?
       GROUP BY p.id ORDER BY total DESC`,
    )
    .bind(`${yr}-01-01`, `${yr}-12-31`)
    .all<{ id: string; name: string; taxFormOnFile: number; total: number }>();
  return {
    year: yr,
    threshold: settings.contractor1099Threshold,
    contractors: results
      .filter((r) => r.total !== 0)
      .map((r) => ({
        payeeId: r.id,
        name: r.name,
        taxFormOnFile: r.taxFormOnFile === 1,
        total: r.total,
        needs1099: r.total >= settings.contractor1099Threshold,
      })),
  };
}

/* ------------------------------------------------------------ mileage */

interface TripRow {
  id: string;
  date: string;
  miles: number;
  purpose: string;
  from_place: string | null;
  to_place: string | null;
  job_id: string | null;
}

const toTrip = (r: TripRow) => ({
  id: r.id,
  date: r.date,
  miles: r.miles,
  purpose: r.purpose,
  from: r.from_place,
  to: r.to_place,
  jobId: r.job_id,
});

export async function listTrips(db: D1Database, y?: string) {
  const yr = year(y);
  const { results } = await db
    .prepare('SELECT * FROM trips WHERE date BETWEEN ? AND ? ORDER BY date DESC, id DESC')
    .bind(`${yr}-01-01`, `${yr}-12-31`)
    .all<TripRow>();
  return results.map(toTrip);
}

export async function addTrip(db: D1Database, body: Record<string, unknown>) {
  const miles = body.miles;
  if (!(typeof miles === 'number' && miles > 0 && miles < 2000)) throw new ApiError(422, 'invalid', 'miles must be a number above zero.');
  const purpose = text(body.purpose, 'Purpose', 200);
  if (!purpose) throw new ApiError(422, 'invalid', 'Say what the trip was for; the IRS asks.');
  let jobId: string | null = null;
  if (typeof body.jobId === 'string') {
    if (!(await db.prepare('SELECT 1 FROM jobs WHERE id = ?').bind(body.jobId).first())) throw new ApiError(422, 'invalid', 'No job with that ID.');
    jobId = body.jobId;
  }
  const id = ulid();
  await db
    .prepare('INSERT INTO trips (id, date, miles, purpose, from_place, to_place, job_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, day(body.date), Math.round(miles * 10) / 10, purpose, text(body.from, 'From', 200) ?? null,
      text(body.to, 'To', 200) ?? null, jobId, now())
    .run();
  return toTrip((await db.prepare('SELECT * FROM trips WHERE id = ?').bind(id).first<TripRow>())!);
}

export async function removeTrip(db: D1Database, id: string) {
  const { meta } = await db.prepare('DELETE FROM trips WHERE id = ?').bind(id).run();
  if (meta.changes !== 1) throw new ApiError(404, 'not_found', 'No trip with that ID.');
}

export async function mileageReport(db: D1Database, y?: string) {
  const yr = year(y);
  const trips = await listTrips(db, yr);
  const { settings } = await currentBooksSettings(db);
  const miles = Math.round(trips.reduce((s, t) => s + t.miles, 0) * 10) / 10;
  const rate = settings.mileageRates[yr];
  return { year: yr, miles, trips: trips.length, centsPerMile: rate ?? null, deduction: mileageDeduction(miles, rate) };
}

/* ------------------------------------------------------------ exports */

/**
 * Year-end files for an accountant, as CSV. Each opens in Excel or Numbers and
 * imports into any accounting package.
 */
export async function exportCsv(db: D1Database, report: string, q: Record<string, string | undefined>) {
  switch (report) {
    case 'ledger': {
      const p = period(q.from, q.to);
      const accounts = new Map((await listAccounts(db, true)).map((a) => [a.id, a]));
      const { results } = await db
        .prepare(
          `SELECT e.date, e.id, e.kind, e.memo, p.name AS payee, e.job_id, e.reverses, l.account_id, l.amount
           FROM entries e JOIN entry_lines l ON l.entry_id = e.id LEFT JOIN payees p ON p.id = e.payee_id
           WHERE e.date BETWEEN ? AND ? ORDER BY e.date, e.id, l.line`,
        )
        .bind(p.from, p.to)
        .all<{ date: string; id: string; kind: string; memo: string | null; payee: string | null; job_id: string | null; reverses: string | null; account_id: string; amount: number }>();
      return {
        filename: `ked-general-ledger-${p.from}-to-${p.to}.csv`,
        csv: toCsv([
          ['Date', 'Entry', 'Type', 'Memo', 'Payee', 'Account', 'Account type', 'Schedule C line', 'Debit', 'Credit', 'Job', 'Voids entry'],
          ...results.map((r) => {
            const a = accounts.get(r.account_id);
            return [r.date, r.id, r.kind, r.memo, r.payee, a?.name ?? r.account_id, a?.type, a?.scheduleC,
              r.amount > 0 ? dollars(r.amount) : '', r.amount < 0 ? dollars(-r.amount) : '', r.job_id, r.reverses];
          }),
        ]),
      };
    }
    case 'profit-loss': {
      const pl = await profitLossReport(db, q.from, q.to);
      return {
        filename: `ked-profit-and-loss-${pl.from}-to-${pl.to}.csv`,
        csv: toCsv([
          ['Section', 'Account', 'Schedule C line', 'Amount'],
          ...pl.income.map((r) => ['Income', r.name, r.scheduleC, dollars(r.total)]),
          ['Income', 'Total income', '', dollars(pl.totalIncome)],
          ...(pl.costOfGoods ? [['Cost of goods sold', 'Total cost of goods sold', '4', dollars(pl.costOfGoods)]] : []),
          ...pl.expenses.filter((r) => r.scheduleC !== '4').map((r) => ['Expenses', r.name, r.scheduleC, dollars(r.total)]),
          ['Expenses', 'Total expenses', '', dollars(pl.totalExpenses)],
          ['Net', 'Net profit', '', dollars(pl.net)],
          [],
          ['Schedule C line', 'Label', '', 'Total'],
          ...pl.scheduleC.map((r) => [r.line, r.label, '', dollars(r.total)]),
        ]),
      };
    }
    case 'mileage': {
      const yr = year(q.year);
      const trips = await listTrips(db, yr);
      const summary = await mileageReport(db, yr);
      return {
        filename: `ked-mileage-log-${yr}.csv`,
        csv: toCsv([
          ['Date', 'Miles', 'Purpose', 'From', 'To', 'Job'],
          ...[...trips].reverse().map((t) => [t.date, t.miles, t.purpose, t.from, t.to, t.jobId]),
          [],
          ['Total miles', summary.miles],
          ['Rate (cents per mile)', summary.centsPerMile ?? 'not set'],
          ['Deduction', summary.deduction === null ? 'set the rate for this year' : dollars(summary.deduction)],
        ]),
      };
    }
    case 'contractors': {
      const r = await contractorsReport(db, q.year);
      return {
        filename: `ked-contractor-payments-${r.year}.csv`,
        csv: toCsv([
          ['Contractor', 'Paid in year', 'W-9 on file', `1099-NEC needed (paid ${dollars(r.threshold)} or more)`],
          ...r.contractors.map((c) => [c.name, dollars(c.total), c.taxFormOnFile ? 'Yes' : 'No', c.needs1099 ? 'Yes' : 'No']),
        ]),
      };
    }
    default:
      throw new ApiError(404, 'not_found', 'Exports: ledger, profit-loss, mileage, contractors.');
  }
}
