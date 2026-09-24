import { checkLines, LedgerError, type Account, type Line } from '@ked/books';
import { localDate } from '@ked/scheduling';
import { listAccounts, day } from './books.ts';
import { currentRules } from './booking.ts';
import { phoneKey } from './customers.ts';
import { ApiError, now, randomToken, text, ulid } from './lib.ts';

/**
 * Cutover imports. tools/import reads the Housecall Pro and QuickBooks files
 * on Brett's machine, shows what it understood, and posts the rows here in
 * small chunks.
 *
 * Chunks stay small because the free Workers plan caps each request at 50
 * database queries, and every statement in a batch counts. Each endpoint
 * spends one or two queries looking things up for the whole chunk, then one
 * statement per row. Everything is keyed to where it came from, so running an
 * import again skips what's already here.
 */

const LIMITS = { customers: 20, jobs: 15, entries: 10 };

function rows(body: Record<string, unknown>, key: keyof typeof LIMITS): Record<string, unknown>[] {
  const list = body[key];
  if (!Array.isArray(list) || !list.length) throw new ApiError(422, 'invalid', `Send ${key} as a list.`);
  if (list.length > LIMITS[key]) throw new ApiError(422, 'invalid', `Send at most ${LIMITS[key]} ${key} at a time.`);
  return list.map((r) => (r && typeof r === 'object' ? (r as Record<string, unknown>) : {}));
}

interface Person {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
}

function person(r: Record<string, unknown>, where: string): Person {
  const name = text(r.name, `${where} name`, 100);
  if (!name) throw new ApiError(422, 'invalid', `${where} has no name.`);
  const email = text(r.email, `${where} email`, 200)?.toLowerCase();
  return {
    name,
    phone: text(r.phone, `${where} phone`, 30),
    email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined,
    address: text(r.address, `${where} address`, 200),
    notes: text(r.notes, `${where} notes`, 5000),
  };
}

/**
 * Find or make customers for a whole chunk: one lookup, then one statement
 * per new or updated customer. Matches by phone (last 10 digits), then email,
 * like online bookings do, including people repeated within the chunk.
 */
async function resolveCustomers(db: D1Database, people: Person[]) {
  const keys = [...new Set(people.map((p) => phoneKey(p.phone)).filter(Boolean))] as string[];
  const emails = [...new Set(people.map((p) => p.email).filter(Boolean))] as string[];
  const found = new Map<string, string>(); // 'p:<key>' / 'e:<email>' → id
  if (keys.length || emails.length) {
    const { results } = await db
      .prepare(
        `SELECT id, phone_key, email FROM customers
         WHERE phone_key IN (${keys.map(() => '?').join(',') || "''"}) OR email IN (${emails.map(() => '?').join(',') || "''"})
         ORDER BY id`,
      )
      .bind(...keys, ...emails)
      .all<{ id: string; phone_key: string | null; email: string | null }>();
    for (const r of results) {
      if (r.phone_key && !found.has(`p:${r.phone_key}`)) found.set(`p:${r.phone_key}`, r.id);
      if (r.email && !found.has(`e:${r.email}`)) found.set(`e:${r.email}`, r.id);
    }
  }

  const at = now();
  const stmts: D1PreparedStatement[] = [];
  let added = 0;
  const ids = people.map((p) => {
    const key = phoneKey(p.phone);
    const existing = (key && found.get(`p:${key}`)) || (p.email && found.get(`e:${p.email}`));
    if (existing) {
      // Fill gaps only; never overwrite what's already here.
      stmts.push(
        db
          .prepare(
            `UPDATE customers SET phone = COALESCE(phone, ?), phone_key = COALESCE(phone_key, ?), email = COALESCE(email, ?),
               address = COALESCE(address, ?), notes = COALESCE(notes, ?), updated_at = ? WHERE id = ?`,
          )
          .bind(p.phone ?? null, key ?? null, p.email ?? null, p.address ?? null, p.notes ?? null, at, existing),
      );
      return existing;
    }
    const id = ulid();
    added++;
    stmts.push(
      db
        .prepare('INSERT INTO customers (id, name, phone, phone_key, email, address, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, p.name, p.phone ?? null, key ?? null, p.email ?? null, p.address ?? null, p.notes ?? null, at, at),
    );
    if (key) found.set(`p:${key}`, id);
    if (p.email) found.set(`e:${p.email}`, id);
    return id;
  });
  return { ids, stmts, added };
}

/** `{ customers: [{ name, phone?, email?, address?, notes? }] }`, up to 20. */
export async function importCustomers(db: D1Database, body: Record<string, unknown>) {
  const people = rows(body, 'customers').map((r, i) => person(r, `Customer ${i + 1}`));
  const { stmts, added } = await resolveCustomers(db, people);
  await db.batch(stmts);
  return { added, matched: people.length - added };
}

function instant(value: unknown, field: string): Date {
  const d = typeof value === 'string' ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) throw new ApiError(422, 'invalid', `${field} must be a date and time.`);
  return d;
}

/**
 * `{ jobs: [{ ref, customer: { name, phone?, email?, address? }, start, end?,
 * address?, status, total?, description?, vehicle?, notes? }] }`, up to 15.
 *
 * Upcoming jobs land on the calendar as usual. Past ones come in as history:
 * done, with their price, and never flagged as unpaid or needing mileage (the
 * money is already in QuickBooks). Their service is 'imported' and the quote
 * is a single line with Housecall Pro's description and total.
 */
export async function importJobs(db: D1Database, body: Record<string, unknown>) {
  const list = rows(body, 'jobs');
  const { rules } = await currentRules(db);
  const at = new Date();

  const parsed = list.map((r, i) => {
    const where = `Job ${i + 1}`;
    const ref = text(r.ref, `${where} ref`, 60);
    if (!ref) throw new ApiError(422, 'invalid', `${where} has no Housecall Pro job number.`);
    const start = instant(r.start, `${where} start`);
    const end = r.end ? instant(r.end, `${where} end`) : new Date(start.getTime() + 3 * 36e5);
    if (end <= start) throw new ApiError(422, 'invalid', `${where} ends before it starts.`);
    const total = r.total === undefined || r.total === null ? null : r.total;
    if (total !== null && !(typeof total === 'number' && Number.isInteger(total) && total >= 0)) {
      throw new ApiError(422, 'invalid', `${where} total must be whole cents.`);
    }
    const customer = person((r.customer ?? {}) as Record<string, unknown>, `${where} customer`);
    const address = text(r.address, `${where} address`, 200) ?? customer.address;
    if (!address) throw new ApiError(422, 'invalid', `${where} has no address.`);
    const cancelled = r.status === 'cancelled';
    const past = end < at;
    return {
      ref: `hcp:${ref}`,
      customer,
      start,
      end,
      address,
      total,
      // Anything already over is history, whatever HCP last called it.
      status: cancelled ? 'cancelled' : past ? 'done' : 'scheduled',
      history: past ? 1 : 0,
      description: text(r.description, `${where} description`, 200) ?? 'Detail',
      vehicle: text(r.vehicle, `${where} vehicle`, 120) ?? null,
      notes: text(r.notes, `${where} notes`, 5000) ?? null,
    };
  });

  const { ids, stmts } = await resolveCustomers(db, parsed.map((p) => p.customer));
  const stamp = now();
  const jobStmts = parsed.map((p, i) => {
    const hours = Math.round(((p.end.getTime() - p.start.getTime()) / 36e5) * 100) / 100;
    const quote = {
      service: 'imported',
      lines: [{ label: p.description, amount: p.total ?? 0 }],
      total: p.total ?? 0,
      range: p.total ? [p.total, p.total] : null,
      hours: [hours, hours],
      inspection: false,
      notes: ['Brought over from Housecall Pro.'],
      travelZone: null,
      configVersion: 0,
    };
    return db
      .prepare(
        `INSERT OR IGNORE INTO jobs (id, customer_id, status, source, service, vehicle, address, zip, notes, input, quote,
                           config_version, final_price, start_at, end_at, local_date, created_at, updated_at,
                           manage_token, imported_from, history)
         VALUES (?, ?, ?, 'app', 'imported', ?, ?, NULL, ?, '{}', ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        ulid(), ids[i], p.status, p.vehicle, p.address, p.notes, JSON.stringify(quote), p.total,
        p.start.toISOString(), p.end.toISOString(), localDate(p.start, rules.timezone), stamp, stamp,
        randomToken(), p.ref, p.history,
      );
  });
  const results = await db.batch([...stmts, ...jobStmts]);
  const added = results.slice(stmts.length).filter((r) => r.meta.changes === 1).length;
  return { added, skipped: parsed.length - added };
}

/**
 * `{ entries: [{ ref, date, memo?, payee?, lines: [{ accountId, amount }] }] }`,
 * up to 10. Lines are already mapped to this chart and must balance. The kind
 * follows the lines: income if any hits an income account, expense if any
 * hits an expense account, otherwise a transfer.
 */
export async function importEntries(db: D1Database, body: Record<string, unknown>, by: string) {
  const list = rows(body, 'entries');
  const accounts = await listAccounts(db, true);
  const byId = new Map<string, Account>(accounts.map((a) => [a.id, a]));

  const parsed = list.map((r, i) => {
    const where = `Entry ${i + 1}`;
    const ref = text(r.ref, `${where} ref`, 80);
    if (!ref) throw new ApiError(422, 'invalid', `${where} has no ref.`);
    if (!Array.isArray(r.lines) || r.lines.length < 2 || r.lines.length > 24) {
      throw new ApiError(422, 'invalid', `${where} needs 2 to 24 lines.`);
    }
    const lines: Line[] = r.lines.map((l: Record<string, unknown>) => ({ accountId: String(l?.accountId ?? ''), amount: l?.amount as number }));
    try {
      checkLines(lines, accounts);
    } catch (err) {
      if (err instanceof LedgerError) throw new ApiError(422, 'invalid', `${where} (${ref}): ${err.message}`);
      throw err;
    }
    const types = new Set(lines.map((l) => byId.get(l.accountId)!.type));
    return {
      ref: `qb:${ref}`,
      date: day(r.date, `${where} date`),
      kind: types.has('income') ? 'income' : types.has('expense') ? 'expense' : 'transfer',
      memo: text(r.memo, `${where} memo`, 500) ?? null,
      payee: text(r.payee, `${where} payee`, 100),
      lines,
    };
  });

  // Payees only for spending: customers' names on income stay off the vendor list.
  const names = [...new Set(parsed.filter((p) => p.kind === 'expense' && p.payee).map((p) => p.payee!))];
  const payees = new Map<string, string>();
  const stmts: D1PreparedStatement[] = [];
  const at = now();
  if (names.length) {
    const { results } = await db
      .prepare(`SELECT id, lower(name) AS name FROM payees WHERE lower(name) IN (${names.map(() => '?').join(',')})`)
      .bind(...names.map((n) => n.toLowerCase()))
      .all<{ id: string; name: string }>();
    for (const r of results) payees.set(r.name, r.id);
    for (const n of names) {
      if (payees.has(n.toLowerCase())) continue;
      const id = ulid();
      payees.set(n.toLowerCase(), id);
      stmts.push(db.prepare("INSERT INTO payees (id, name, kind, created_at, updated_at) VALUES (?, ?, 'vendor', ?, ?)").bind(id, n, at, at));
    }
  }

  const entryStmts: D1PreparedStatement[] = [];
  for (const p of parsed) {
    const id = ulid();
    const payeeId = p.kind === 'expense' && p.payee ? payees.get(p.payee.toLowerCase())! : null;
    entryStmts.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO entries (id, date, kind, memo, payee_id, created_at, created_by, import_ref)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, p.date, p.kind, p.memo, payeeId, at, by, p.ref),
      // All lines in one statement, and only if the entry went in (not a repeat).
      db
        .prepare(
          `INSERT INTO entry_lines (entry_id, line, account_id, amount)
           SELECT column1, column2, column3, column4 FROM (VALUES ${p.lines.map(() => '(?, ?, ?, ?)').join(', ')})
           WHERE EXISTS (SELECT 1 FROM entries WHERE id = ?)`,
        )
        .bind(...p.lines.flatMap((l, i) => [id, i + 1, l.accountId, l.amount]), id),
    );
  }
  const results = await db.batch([...stmts, ...entryStmts]);
  const added = results.slice(stmts.length).filter((_, i) => i % 2 === 0).filter((r) => r.meta.changes === 1).length;
  return { added, skipped: parsed.length - added };
}
