import { defaultConfig, validateConfig, type PricingConfig } from '@ked/pricing';
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
