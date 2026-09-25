import { touchJson, type Touch } from './attribution.ts';
import { ApiError, now, randomToken, text, ulid } from './lib.ts';

interface CustomerRow {
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
  if (!fields.length) return getCustomer(db, id);

  const row = await db
    .prepare(`UPDATE customers SET ${fields.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ? RETURNING *`)
    .bind(...fields.map(([, v]) => v), now(), id)
    .first<CustomerRow>();
  if (!row) throw new ApiError(404, 'not_found', 'No customer with that ID.');
  return toCustomer(row);
}
