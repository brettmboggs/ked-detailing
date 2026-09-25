import type { QuoteInput } from '@ked/pricing';
import { ApiError, now, text, ulid } from './lib.ts';
import { priceRequest } from './pricing.ts';
import { readTouch, touchJson } from './attribution.ts';
import { findOrCreateCustomer } from './customers.ts';

export const LEAD_STATUSES = ['new', 'contacted', 'booked', 'lost'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

interface LeadRow {
  id: string;
  status: LeadStatus;
  name: string;
  phone: string | null;
  email: string | null;
  vehicle: string | null;
  zip: string | null;
  notes: string | null;
  input: string;
  quote: string;
  config_version: number;
  created_at: string;
  updated_at: string;
  source: string | null;
  source_detail: string | null;
  customer_id: string | null;
}

/**
 * A quote request from the website. The price is recomputed here from the
 * customer's answers and the live config; whatever the browser showed is not
 * trusted.
 */
export async function createLead(db: D1Database, body: Record<string, unknown>) {
  // Honeypot: a field real visitors never see. Pretend it worked.
  if (body.website) return { id: ulid(), quote: null };

  const name = text(body.name, 'Name', 100);
  const phone = text(body.phone, 'Phone', 30);
  const email = text(body.email, 'Email', 200);
  const vehicle = text(body.vehicle, 'Vehicle', 120);
  const zip = text(body.zip, 'ZIP', 10);
  const notes = text(body.notes, 'Notes', 2000);
  if (!name) throw new ApiError(422, 'invalid', 'Add a name so Jacob knows who to ask for.');
  if (!phone && !email) throw new ApiError(422, 'invalid', 'Add a phone number or an email.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError(422, 'invalid', "That email address doesn't look right.");
  }

  const { input, summary, version } = await priceRequest(db, body.input, zip);

  // Every quote request is a person in the CRM, even before they book.
  const touch = readTouch(body);
  const customer = await findOrCreateCustomer(db, { name, phone, email }, touch);
  const id = ulid();
  const at = now();
  await db
    .prepare(
      `INSERT INTO leads (id, status, name, phone, email, vehicle, zip, notes, input, quote, config_version, created_at, updated_at,
                          source, source_detail, attribution, customer_id)
       VALUES (?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, name, phone ?? null, email ?? null, vehicle ?? null, zip ?? null, notes ?? null,
      JSON.stringify(input), JSON.stringify(summary), version, at, at,
      touch.source, touch.sourceDetail, touchJson(touch.attribution), customer.id)
    .run();
  return { id, quote: summary };
}

export async function listLeads(db: D1Database, status: string | undefined) {
  if (status !== undefined && !isStatus(status)) {
    throw new ApiError(422, 'invalid', `status must be one of ${LEAD_STATUSES.join(', ')}.`);
  }
  const { results } = status
    ? await db.prepare('SELECT * FROM leads WHERE status = ? ORDER BY id DESC LIMIT 200').bind(status).all<LeadRow>()
    : await db.prepare('SELECT * FROM leads ORDER BY id DESC LIMIT 200').all<LeadRow>();
  return results.map(toLead);
}

export async function updateLead(db: D1Database, id: string, body: Record<string, unknown>) {
  const status = body.status;
  if (typeof status !== 'string' || !isStatus(status)) {
    throw new ApiError(422, 'invalid', `status must be one of ${LEAD_STATUSES.join(', ')}.`);
  }
  const row = await db
    .prepare('UPDATE leads SET status = ?, updated_at = ? WHERE id = ? RETURNING *')
    .bind(status, now(), id)
    .first<LeadRow>();
  if (!row) throw new ApiError(404, 'not_found', 'No lead with that ID.');
  return toLead(row);
}

const isStatus = (s: string): s is LeadStatus => (LEAD_STATUSES as readonly string[]).includes(s);

function toLead(row: LeadRow) {
  return {
    id: row.id,
    status: row.status,
    name: row.name,
    phone: row.phone,
    email: row.email,
    vehicle: row.vehicle,
    zip: row.zip,
    notes: row.notes,
    input: JSON.parse(row.input) as QuoteInput,
    quote: JSON.parse(row.quote),
    configVersion: row.config_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    source: row.source,
    sourceDetail: row.source_detail,
    customerId: row.customer_id,
  };
}
