import { getJob } from './jobs.ts';
import { ApiError, now, text, ulid } from './lib.ts';
import { currentPricing } from './pricing.ts';

/**
 * Inventory: what's in the van, what's running low, and what each job used.
 *
 * Counts only change through movements (restock, used, adjust), each kept
 * with the count it left behind, so a wrong number can always be traced.
 * The count itself is updated in the same batch, in SQL, so two quick taps on
 * + can't lose one.
 */

export const REASONS = ['restock', 'used', 'adjust'] as const;
type Reason = (typeof REASONS)[number];

interface ItemRow {
  id: string;
  name: string;
  barcode: string | null;
  unit: string;
  on_hand: number;
  reorder_at: number | null;
  reorder_url: string | null;
  cost: number | null;
  notes: string | null;
  archived: number;
  created_at: string;
  updated_at: string;
}

const toItem = (r: ItemRow) => ({
  id: r.id,
  name: r.name,
  barcode: r.barcode,
  unit: r.unit,
  onHand: r.on_hand,
  reorderAt: r.reorder_at,
  reorderUrl: r.reorder_url,
  cost: r.cost,
  notes: r.notes,
  archived: r.archived === 1,
  /** At or below the reorder point. Items with no reorder point are never low. */
  low: r.reorder_at !== null && r.on_hand <= r.reorder_at,
  updatedAt: r.updated_at,
});

/** Counts are kept to 3 places, so 0.1 + 0.2 stays 0.3. */
const round = (n: number) => Math.round(n * 1000) / 1000;

function quantity(value: unknown, field: string, { positive = false, allowNull = false } = {}): number | null {
  if (value === null && allowNull) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1_000_000) {
    throw new ApiError(422, 'invalid', `${field} must be a number.`);
  }
  if (positive && value <= 0) throw new ApiError(422, 'invalid', `${field} must be above zero.`);
  return round(value);
}

/**
 * Scanners disagree on UPC-A: some read 12 digits, iOS reads the same code as
 * 13 with a leading zero. Store the 13-digit form so either finds the item.
 */
export function normalizeBarcode(code: string): string {
  const c = code.trim().replace(/\s+/g, '');
  return /^\d{12}$/.test(c) ? `0${c}` : c;
}

function barcode(value: unknown): string | null {
  const t = text(value, 'Barcode', 64);
  return t ? normalizeBarcode(t) : null;
}

function url(value: unknown): string | null {
  const t = text(value, 'Reorder link', 1000);
  if (!t) return null;
  if (!/^https?:\/\/\S+$/i.test(t)) throw new ApiError(422, 'invalid', 'The reorder link must start with https://.');
  return t;
}

function money(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (!(typeof value === 'number' && Number.isInteger(value) && value >= 0)) {
    throw new ApiError(422, 'invalid', 'Cost must be whole cents.');
  }
  return value;
}

export async function getItem(db: D1Database, id: string) {
  const row = await db.prepare('SELECT * FROM inventory_items WHERE id = ?').bind(id).first<ItemRow>();
  if (!row) throw new ApiError(404, 'not_found', 'No item with that ID.');
  return toItem(row);
}

/**
 * The list, lowest first: low items by how far under they are, then the rest
 * by name. `low=true` is just the shopping list.
 */
export async function listItems(db: D1Database, q: { low?: string; archived?: string; q?: string }) {
  const where = [q.archived === 'true' ? '1 = 1' : 'archived = 0'];
  const binds: unknown[] = [];
  if (q.low === 'true') where.push('reorder_at IS NOT NULL AND on_hand <= reorder_at');
  if (q.q) {
    where.push('(name LIKE ? OR barcode = ?)');
    binds.push(`%${q.q.trim()}%`, normalizeBarcode(q.q));
  }
  const { results } = await db
    .prepare(
      `SELECT * FROM inventory_items WHERE ${where.join(' AND ')}
       ORDER BY CASE WHEN reorder_at IS NOT NULL AND on_hand <= reorder_at THEN 0 ELSE 1 END,
                on_hand - COALESCE(reorder_at, 0), name COLLATE NOCASE
       LIMIT 500`,
    )
    .bind(...binds)
    .all<ItemRow>();
  const items = results.map(toItem);
  return { items, lowCount: items.filter((i) => i.low).length };
}

export async function itemByBarcode(db: D1Database, code: string) {
  const row = await db.prepare('SELECT * FROM inventory_items WHERE barcode = ?').bind(normalizeBarcode(code)).first<ItemRow>();
  if (!row) throw new ApiError(404, 'not_found', "That code isn't known yet. Name it once and it'll be remembered.");
  return toItem(row);
}

async function barcodeFree(db: D1Database, code: string | null, exceptId?: string) {
  if (!code) return;
  const other = await db.prepare('SELECT id, name FROM inventory_items WHERE barcode = ?').bind(code).first<{ id: string; name: string }>();
  if (other && other.id !== exceptId) {
    throw new ApiError(409, 'barcode_taken', `That barcode is already on "${other.name}".`);
  }
}

/** `{ name, unit, barcode?, onHand?, reorderAt?, reorderUrl?, cost?, notes? }`. A starting count is logged as an adjust. */
export async function createItem(db: D1Database, body: Record<string, unknown>, by: string) {
  const name = text(body.name, 'Name', 120);
  if (!name) throw new ApiError(422, 'invalid', 'Give the item a name.');
  const unit = text(body.unit, 'Unit', 30) ?? 'each';
  const code = barcode(body.barcode);
  await barcodeFree(db, code);
  const onHand = body.onHand === undefined ? 0 : quantity(body.onHand, 'On hand')!;
  const id = ulid();
  const at = now();
  const stmts = [
    db
      .prepare(
        `INSERT INTO inventory_items (id, name, barcode, unit, on_hand, reorder_at, reorder_url, cost, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id, name, code, unit, onHand,
        body.reorderAt === undefined ? null : quantity(body.reorderAt, 'Reorder at', { allowNull: true }),
        url(body.reorderUrl), money(body.cost), text(body.notes, 'Notes', 1000) ?? null, at, at,
      ),
  ];
  if (onHand) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO stock_movements (id, item_id, delta, reason, on_hand, note, created_at, created_by)
           VALUES (?, ?, ?, 'adjust', ?, 'Starting count', ?, ?)`,
        )
        .bind(ulid(), id, onHand, onHand, at, by),
    );
  }
  await db.batch(stmts);
  return getItem(db, id);
}

/**
 * Anything but the count, which only moves through movements so the history
 * stays true. `archived: true` hides it (history and barcode are kept).
 */
export async function updateItem(db: D1Database, id: string, body: Record<string, unknown>) {
  const item = await getItem(db, id);
  if ('onHand' in body) throw new ApiError(422, 'invalid', 'Change the count with a movement (restock, used or adjust).');
  const fields: [string, unknown][] = [];
  if ('name' in body) {
    const name = text(body.name, 'Name', 120);
    if (!name) throw new ApiError(422, 'invalid', "Name can't be empty.");
    fields.push(['name', name]);
  }
  if ('unit' in body) fields.push(['unit', text(body.unit, 'Unit', 30) ?? 'each']);
  if ('barcode' in body) {
    const code = barcode(body.barcode);
    await barcodeFree(db, code, item.id);
    fields.push(['barcode', code]);
  }
  if ('reorderAt' in body) fields.push(['reorder_at', quantity(body.reorderAt, 'Reorder at', { allowNull: true })]);
  if ('reorderUrl' in body) fields.push(['reorder_url', url(body.reorderUrl)]);
  if ('cost' in body) fields.push(['cost', money(body.cost)]);
  if ('notes' in body) fields.push(['notes', text(body.notes, 'Notes', 1000) ?? null]);
  if ('archived' in body) fields.push(['archived', body.archived ? 1 : 0]);
  if (!fields.length) return item;
  await db
    .prepare(`UPDATE inventory_items SET ${fields.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .bind(...fields.map(([, v]) => v), now(), id)
    .run();
  return getItem(db, id);
}

/** The count change plus its log line, as one batch; the log reads the count after. */
function move(db: D1Database, itemId: string, delta: number, reason: Reason, by: string, extra: { jobId?: string | null; note?: string | null } = {}) {
  const at = now();
  return [
    db.prepare('UPDATE inventory_items SET on_hand = ROUND(on_hand + ?, 3), updated_at = ? WHERE id = ?').bind(delta, at, itemId),
    db
      .prepare(
        `INSERT INTO stock_movements (id, item_id, delta, reason, job_id, on_hand, note, created_at, created_by)
         SELECT ?, ?, ?, ?, ?, on_hand, ?, ?, ? FROM inventory_items WHERE id = ?`,
      )
      .bind(ulid(), itemId, delta, reason, extra.jobId ?? null, extra.note ?? null, at, by, itemId),
  ];
}

/**
 * `{ delta, reason, jobId?, note?, unitCost? }`, or `{ count, reason: 'adjust' }`
 * to set the count after counting the shelf. A restock's `unitCost` becomes
 * the item's cost.
 */
export async function addMovement(db: D1Database, id: string, body: Record<string, unknown>, by: string) {
  const item = await getItem(db, id);
  const reason = body.reason as Reason;
  if (!(REASONS as readonly string[]).includes(reason)) throw new ApiError(422, 'invalid', `reason must be one of ${REASONS.join(', ')}.`);

  let delta: number;
  if (body.count !== undefined) {
    if (reason !== 'adjust') throw new ApiError(422, 'invalid', 'Setting a count is an adjust.');
    const count = quantity(body.count, 'Count')!;
    if (count < 0) throw new ApiError(422, 'invalid', "Count can't be below zero.");
    delta = round(count - item.onHand);
  } else {
    delta = quantity(body.delta, 'Change')!;
    if (!delta) throw new ApiError(422, 'invalid', 'The change must not be zero.');
    // Signs follow the reason, so the app can always send a positive number.
    if (reason === 'restock') delta = Math.abs(delta);
    if (reason === 'used') delta = -Math.abs(delta);
  }
  let jobId: string | null = null;
  if (body.jobId !== undefined && body.jobId !== null) jobId = (await getJob(db, String(body.jobId))).id;

  const stmts = delta ? move(db, id, delta, reason, by, { jobId, note: text(body.note, 'Note', 300) }) : [];
  if (reason === 'restock' && body.unitCost !== undefined) {
    stmts.push(db.prepare('UPDATE inventory_items SET cost = ? WHERE id = ?').bind(money(body.unitCost), id));
  }
  if (stmts.length) await db.batch(stmts);
  return getItem(db, id);
}

export async function listMovements(db: D1Database, id: string) {
  await getItem(db, id);
  const { results } = await db
    .prepare('SELECT * FROM stock_movements WHERE item_id = ? ORDER BY created_at DESC, id DESC LIMIT 200')
    .bind(id)
    .all<{ id: string; delta: number; reason: Reason; job_id: string | null; on_hand: number; note: string | null; created_at: string; created_by: string }>();
  return results.map((m) => ({
    id: m.id, delta: m.delta, reason: m.reason, jobId: m.job_id, onHand: m.on_hand, note: m.note, createdAt: m.created_at,
  }));
}

/* ----------------------------------------------------- per job, per package */

function readAmounts(value: unknown): { itemId: string; amount: number }[] {
  if (!Array.isArray(value)) throw new ApiError(422, 'invalid', 'items must be a list.');
  // Two statements per changed item, under the free plan's 50-query cap.
  if (value.length > 20) throw new ApiError(422, 'invalid', 'Up to 20 items at a time.');
  const seen = new Set<string>();
  return value.map((v: unknown, i) => {
    const o = (v ?? {}) as Record<string, unknown>;
    if (typeof o.itemId !== 'string') throw new ApiError(422, 'invalid', `Item ${i + 1} needs an itemId.`);
    if (seen.has(o.itemId)) throw new ApiError(422, 'invalid', 'Each item can only be listed once.');
    seen.add(o.itemId);
    const amount = quantity(o.amount, `Item ${i + 1} amount`)!;
    if (amount < 0) throw new ApiError(422, 'invalid', `Item ${i + 1} amount can't be below zero.`);
    return { itemId: o.itemId, amount };
  });
}

async function itemsExist(db: D1Database, ids: string[]) {
  if (!ids.length) return;
  const { results } = await db
    .prepare(`SELECT id FROM inventory_items WHERE id IN (${ids.map(() => '?').join(',')})`)
    .bind(...ids)
    .all<{ id: string }>();
  const found = new Set(results.map((r) => r.id));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) throw new ApiError(422, 'invalid', 'Some of those items no longer exist.', missing);
}

/** Each package's usual amounts: `{ usage: { [service]: [{ itemId, name, unit, amount }] } }`. */
export async function listUsage(db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT u.service, u.item_id, u.amount, i.name, i.unit FROM service_usage u
       JOIN inventory_items i ON i.id = u.item_id WHERE i.archived = 0 ORDER BY u.service, i.name COLLATE NOCASE`,
    )
    .all<{ service: string; item_id: string; amount: number; name: string; unit: string }>();
  const usage: Record<string, { itemId: string; name: string; unit: string; amount: number }[]> = {};
  for (const r of results) (usage[r.service] ??= []).push({ itemId: r.item_id, name: r.name, unit: r.unit, amount: r.amount });
  return { usage };
}

/** Replace one package's usual amounts. `{ items: [{ itemId, amount }] }`; an empty list clears it. */
export async function saveUsage(db: D1Database, service: string, body: Record<string, unknown>) {
  const { config } = await currentPricing(db);
  if (!config.services.some((s) => s.id === service)) throw new ApiError(404, 'not_found', 'No package with that ID.');
  const items = readAmounts(body.items).filter((i) => i.amount > 0);
  await itemsExist(db, items.map((i) => i.itemId));
  await db.batch([
    db.prepare('DELETE FROM service_usage WHERE service = ?').bind(service),
    ...items.map((i) => db.prepare('INSERT INTO service_usage (service, item_id, amount) VALUES (?, ?, ?)').bind(service, i.itemId, i.amount)),
  ]);
  return { service, items: (await listUsage(db)).usage[service] ?? [] };
}

/** What the job used so far, per item, from its movements. */
async function usedOnJob(db: D1Database, jobId: string) {
  const { results } = await db
    .prepare(
      `SELECT m.item_id, -SUM(m.delta) AS amount, i.name, i.unit, i.cost FROM stock_movements m
       JOIN inventory_items i ON i.id = m.item_id
       WHERE m.job_id = ? AND m.reason = 'used' GROUP BY m.item_id HAVING ROUND(SUM(m.delta), 3) != 0
       ORDER BY i.name COLLATE NOCASE`,
    )
    .bind(jobId)
    .all<{ item_id: string; amount: number; name: string; unit: string; cost: number | null }>();
  return results.map((r) => ({ itemId: r.item_id, name: r.name, unit: r.unit, amount: round(r.amount), cost: r.cost }));
}

/**
 * For "what did you use?" on a finished job: what's recorded, and, until
 * something is, the package's usual amounts to pre-fill. `productCost` is the
 * recorded use at each item's current cost, for what the job really made.
 */
export async function jobUsage(db: D1Database, jobId: string) {
  const job = await getJob(db, jobId);
  const used = await usedOnJob(db, jobId);
  const suggested = used.length ? [] : ((await listUsage(db)).usage[job.service] ?? []);
  const productCost = Math.round(used.reduce((s, u) => s + (u.cost ?? 0) * u.amount, 0));
  return { used, suggested, productCost };
}

/**
 * Set what the job used: `{ items: [{ itemId, amount }] }`. Only the
 * differences from what's already recorded are posted, so saving the same
 * list twice changes nothing, and an item left out is put back.
 */
export async function saveJobUsage(db: D1Database, jobId: string, body: Record<string, unknown>, by: string) {
  await getJob(db, jobId);
  const wanted = readAmounts(body.items);
  await itemsExist(db, wanted.map((i) => i.itemId));
  const current = new Map((await usedOnJob(db, jobId)).map((u) => [u.itemId, u.amount]));
  const target = new Map(wanted.map((w) => [w.itemId, w.amount]));
  const stmts: D1PreparedStatement[] = [];
  for (const itemId of new Set([...current.keys(), ...target.keys()])) {
    const diff = round((target.get(itemId) ?? 0) - (current.get(itemId) ?? 0));
    if (diff) stmts.push(...move(db, itemId, -diff, 'used', by, { jobId }));
  }
  if (stmts.length) await db.batch(stmts);
  return jobUsage(db, jobId);
}
