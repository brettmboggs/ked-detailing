import { defaultConfig, quote, QuoteError, validateConfig, type PricingConfig, type QuoteInput } from '@ked/pricing';
import { ApiError, now } from './lib.ts';

export interface StoredPricing {
  config: PricingConfig;
  version: number;
  updatedAt: string | null;
}

/** The live config: the newest saved one, or the built-in defaults if none yet. */
export async function currentPricing(db: D1Database): Promise<StoredPricing> {
  const row = await db
    .prepare('SELECT version, config, created_at FROM pricing_configs ORDER BY version DESC LIMIT 1')
    .first<{ version: number; config: string; created_at: string }>();
  if (!row) return { config: defaultConfig, version: defaultConfig.version, updatedAt: null };
  return { config: JSON.parse(row.config) as PricingConfig, version: row.version, updatedAt: row.created_at };
}

/**
 * Save a new version. The server assigns the version number, so two saves can
 * never share one, and runs the same validation the app ran before sending.
 */
export async function savePricing(db: D1Database, body: unknown, by: string): Promise<StoredPricing> {
  const config = body as PricingConfig;
  let errors: string[];
  try {
    errors = validateConfig(config);
  } catch {
    // validateConfig assumes the right shape; anything else is not a config.
    throw new ApiError(422, 'invalid_pricing', 'That is not a pricing config.');
  }
  if (errors.length) throw new ApiError(422, 'invalid_pricing', 'Some prices need fixing.', errors);

  const current = await currentPricing(db);
  const version = current.version + 1;
  const saved: PricingConfig = { ...config, version };
  const updatedAt = now();
  await db
    .prepare('INSERT INTO pricing_configs (version, config, created_at, created_by) VALUES (?, ?, ?, ?)')
    .bind(version, JSON.stringify(saved), updatedAt, by)
    .run();
  return { config: saved, version, updatedAt };
}

/** What gets stored with a lead or job: the quote without the full service object. */
export interface QuoteSummary {
  service: string;
  lines: { label: string; amount: number }[];
  total: number;
  range: [number, number] | null;
  hours: [number, number];
  inspection: boolean;
  notes: string[];
}

/**
 * Price a customer's answers with the live config. Anything the browser says
 * the price is gets ignored; only the answers are read.
 */
export async function priceRequest(db: D1Database, raw: unknown, zip: string | undefined) {
  const input = readQuoteInput(raw, zip);
  const { config, version } = await currentPricing(db);
  let priced;
  try {
    priced = quote(config, input);
  } catch (err) {
    if (err instanceof QuoteError) throw new ApiError(422, 'invalid_quote', err.message);
    throw err;
  }
  const summary: QuoteSummary = {
    service: priced.service.id,
    lines: priced.lines,
    total: priced.total,
    range: priced.range,
    hours: priced.hours,
    inspection: priced.inspection,
    notes: priced.notes,
  };
  return { input, summary, version };
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
