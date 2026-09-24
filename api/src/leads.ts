import { quote, QuoteError, type QuoteInput } from '@ked/pricing';
import { ApiError, now, text, ulid } from './lib.ts';
import { currentPricing } from './pricing.ts';

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

  const input = readQuoteInput(body.input, zip);
  const { config, version } = await currentPricing(db);
  let priced;
  try {
    priced = quote(config, input);
  } catch (err) {
    if (err instanceof QuoteError) throw new ApiError(422, 'invalid_quote', err.message);
    throw err;
  }
  const summary = {
    service: priced.service.id,
    lines: priced.lines,
    total: priced.total,
    range: priced.range,
    hours: priced.hours,
    inspection: priced.inspection,
    notes: priced.notes,
  };

  const id = ulid();
  const at = now();
  await db
    .prepare(
      `INSERT INTO leads (id, status, name, phone, email, vehicle, zip, notes, input, quote, config_version, created_at, updated_at)
       VALUES (?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, name, phone ?? null, email ?? null, vehicle ?? null, zip ?? null, notes ?? null,
      JSON.stringify(input), JSON.stringify(summary), version, at, at)
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
  };
}

/** Only the fields the formula reads, with the right types, so nothing else is stored. */
function readQuoteInput(raw: unknown, zip: string | undefined): QuoteInput {
  if (!raw || typeof raw !== 'object') throw new ApiError(422, 'invalid_quote', 'Missing the quote answers.');
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, 50) : undefined);
  const conditions: Record<string, string> = {};
  if (r.conditions && typeof r.conditions === 'object') {
    for (const [k, v] of Object.entries(r.conditions).slice(0, 30)) {
      if (typeof v === 'string') conditions[k.slice(0, 50)] = v.slice(0, 50);
    }
  }
  return {
    service: str(r.service) ?? '',
    vehicleClass: str(r.vehicleClass),
    boatFeet: typeof r.boatFeet === 'number' ? r.boatFeet : undefined,
    conditions,
    addOns: Array.isArray(r.addOns) ? r.addOns.filter((a): a is string => typeof a === 'string').slice(0, 30) : [],
    zip: zip ?? str(r.zip),
  };
}
