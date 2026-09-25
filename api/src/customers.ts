import { SOURCES, touchJson, type Touch } from './attribution.ts';
import { ApiError, now, randomToken, text, ulid } from './lib.ts';

export interface CustomerRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  source: string | null;
  source_detail: string | null;
  attribution: string | null;
  tags: string;
  referred_by: string | null;
  referral_code: string | null;
  email_ok: number;
  text_ok: number;
}

/**
 * A customer's code to share (kedservice.com/?ref=CODE). No 0/O or 1/I, so it
 * reads out loud. Older customers get one lazily (see crm-customers.ts).
 */
export function referralCode(): string {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => abc[b % abc.length]).join('');
}

/** Last ten digits, so "(314) 555-0100" and "+1 314 555 0100" are the same person. */
export const phoneKey = (phone: string | undefined) => {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
};

/**
 * Match a returning customer by phone, then email; otherwise create one. A
 * match keeps its stored name and fills in only what was missing, so a typo in
 * a booking form can't overwrite what Jacob has on file.
 */
export async function findOrCreateCustomer(
  db: D1Database,
  c: { name: string; phone?: string; email?: string; address?: string },
  touch?: Touch,
) {
  const key = phoneKey(c.phone);
  const email = c.email?.toLowerCase();
  const existing =
    (key && (await db.prepare('SELECT * FROM customers WHERE phone_key = ? ORDER BY id LIMIT 1').bind(key).first<CustomerRow>())) ||
    (email && (await db.prepare('SELECT * FROM customers WHERE email = ? ORDER BY id LIMIT 1').bind(email).first<CustomerRow>())) ||
    null;
  const at = now();
  if (existing) {
    await db
      .prepare(
        `UPDATE customers SET phone = COALESCE(phone, ?), phone_key = COALESCE(phone_key, ?),
           email = COALESCE(email, ?), address = COALESCE(address, ?),
           source = COALESCE(source, ?), source_detail = COALESCE(source_detail, ?),
           attribution = COALESCE(attribution, ?), updated_at = ? WHERE id = ?`,
      )
      .bind(c.phone ?? null, key, email ?? null, c.address ?? null,
        touch?.source ?? null, touch?.sourceDetail ?? null, touchJson(touch?.attribution ?? null), at, existing.id)
      .run();
    return { id: existing.id, isNew: false };
  }
  const id = ulid();
  // A referral code from ?ref= links them to whoever shared it (first touch only).
  const ref = touch?.attribution?.ref;
  await db
    .prepare(
      `INSERT INTO customers (id, name, phone, phone_key, email, address, source, source_detail, attribution,
                              referred_by, referral_code, unsubscribe_token, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?,
               (SELECT id FROM customers WHERE referral_code = ?), ?, ?, ?, ?)`,
    )
    .bind(id, c.name, c.phone ?? null, key, email ?? null, c.address ?? null,
      touch?.source ?? null, touch?.sourceDetail ?? null, touchJson(touch?.attribution ?? null),
      ref ?? null, referralCode(), randomToken(), at, at)
    .run();
  return { id, isNew: true };
}

export function toCustomer(row: CustomerRow) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    source: row.source,
    sourceDetail: row.source_detail,
    /** What the browser saw on their first visit (attribution.ts), when they came through the website. */
    attribution: row.attribution ? (JSON.parse(row.attribution) as Record<string, string>) : null,
    tags: JSON.parse(row.tags || '[]') as string[],
    referredBy: row.referred_by,
    referralCode: row.referral_code,
    emailOk: row.email_ok !== 0,
    textOk: row.text_ok !== 0,
  };
}

/** Search by name, phone digits or email. Empty query lists the newest. */
export async function listCustomers(db: D1Database, q: string | undefined) {
  const query = (q ?? '').trim().slice(0, 100);
  if (!query) {
    const { results } = await db.prepare('SELECT * FROM customers ORDER BY id DESC LIMIT 100').all<CustomerRow>();
    return results.map(toCustomer);
  }
  const digits = query.replace(/\D/g, '');
  const like = `%${query.toLowerCase().replace(/[%_]/g, '')}%`;
  const { results } = await db
    .prepare(
      `SELECT * FROM customers
       WHERE lower(name) LIKE ? OR email LIKE ? OR (? != '' AND phone_key LIKE ?)
       ORDER BY name LIMIT 100`,
    )
    .bind(like, like, digits, `%${digits}%`)
    .all<CustomerRow>();
  return results.map(toCustomer);
}

export async function getCustomer(db: D1Database, id: string) {
  const row = await db.prepare('SELECT * FROM customers WHERE id = ?').bind(id).first<CustomerRow>();
  if (!row) throw new ApiError(404, 'not_found', 'No customer with that ID.');
  return toCustomer(row);
}

export async function updateCustomer(db: D1Database, id: string, body: Record<string, unknown>) {
  const fields: [string, unknown][] = [];
  if ('name' in body) {
    const name = text(body.name, 'Name', 100);
    if (!name) throw new ApiError(422, 'invalid', "Name can't be empty.");
    fields.push(['name', name]);
  }
  if ('phone' in body) {
    const phone = text(body.phone, 'Phone', 30);
    fields.push(['phone', phone ?? null], ['phone_key', phoneKey(phone)]);
  }
  if ('email' in body) fields.push(['email', text(body.email, 'Email', 200)?.toLowerCase() ?? null]);
  if ('address' in body) fields.push(['address', text(body.address, 'Address', 200) ?? null]);
  if ('notes' in body) fields.push(['notes', text(body.notes, 'Notes', 5000) ?? null]);

  // CRM fields (docs/crm.md): tags, where they came from, consent, who sent them.
  if ('tags' in body) fields.push(['tags', JSON.stringify(readTags(body.tags))]);
  if ('source' in body) {
    const source = body.source === null || body.source === '' ? null : body.source;
    if (source !== null && !(SOURCES as readonly unknown[]).includes(source)) {
      throw new ApiError(422, 'invalid', `Where they heard about us must be one of ${SOURCES.join(', ')}.`);
    }
    fields.push(['source', source]);
  }
  if ('sourceDetail' in body) fields.push(['source_detail', text(body.sourceDetail, 'Where they heard about us', 120) ?? null]);
  for (const [key, col, label] of [['emailOk', 'email_ok', 'Email OK'], ['textOk', 'text_ok', 'Text OK']] as const) {
    if (!(key in body)) continue;
    if (typeof body[key] !== 'boolean') throw new ApiError(422, 'invalid', `${label} must be true or false.`);
    fields.push([col, body[key] ? 1 : 0]);
  }
  if ('referredBy' in body) fields.push(['referred_by', await readReferrer(db, id, body.referredBy)]);
  if (!fields.length) return getCustomer(db, id);

  const row = await db
    .prepare(`UPDATE customers SET ${fields.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ? RETURNING *`)
    .bind(...fields.map(([, v]) => v), now(), id)
    .first<CustomerRow>();
  if (!row) throw new ApiError(404, 'not_found', 'No customer with that ID.');
  return toCustomer(row);
}

export const MAX_TAGS = 12;

/**
 * Tags: a short list of short words. Lower-cased, spaces squeezed, duplicates
 * dropped, so "VIP", " vip " and "Vip" are one tag.
 */
export function readTags(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new ApiError(422, 'invalid', 'Tags must be a list.');
  const tags: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') throw new ApiError(422, 'invalid', 'Each tag must be a word or two.');
    const tag = raw.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!tag) continue;
    if (tag.length > 24) throw new ApiError(422, 'invalid', `"${raw.trim().slice(0, 30)}" is too long for a tag. Keep tags under 25 letters.`);
    if (!/^[\p{L}\p{N}][\p{L}\p{N} &'+./-]*$/u.test(tag)) throw new ApiError(422, 'invalid', `"${raw.trim()}" has characters a tag can't use.`);
    if (!tags.includes(tag)) tags.push(tag);
  }
  if (tags.length > MAX_TAGS) throw new ApiError(422, 'invalid', `Up to ${MAX_TAGS} tags per customer.`);
  return tags;
}

/** Who sent them: another customer, never themselves or anyone they sent (no loops). */
async function readReferrer(db: D1Database, id: string, value: unknown): Promise<string | null> {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 40) throw new ApiError(422, 'invalid', 'Referred by must be a customer.');
  if (value === id) throw new ApiError(422, 'invalid', "A customer can't refer themselves.");
  // Walk up from the chosen referrer; meeting this customer means a loop.
  const row = await db
    .prepare(
      `WITH RECURSIVE up(id, depth) AS (
         SELECT id, 0 FROM customers WHERE id = ?1
         UNION SELECT c.referred_by, up.depth + 1 FROM customers c JOIN up ON c.id = up.id
         WHERE c.referred_by IS NOT NULL AND up.depth < 50
       )
       SELECT (SELECT COUNT(*) FROM customers WHERE id = ?1) AS found, EXISTS (SELECT 1 FROM up WHERE id = ?2) AS loop`,
    )
    .bind(value, id)
    .first<{ found: number; loop: number }>();
  if (!row?.found) throw new ApiError(422, 'invalid', 'Referred by must be a customer.');
  if (row.loop) throw new ApiError(422, 'invalid', 'That would make them referred by someone they referred.');
  return value;
}
