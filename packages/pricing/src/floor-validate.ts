import type { FloorPricingConfig } from './floor-types.ts';

/**
 * Problems that would make the floor formula misbehave, in words the owner
 * can act on. Empty means the config is safe to save. The app runs this
 * before every save and the API runs it again before storing.
 */
export function validateFloorConfig(config: FloorPricingConfig): string[] {
  const errors: string[] = [];
  const money = (n: number) => Number.isInteger(n) && n >= 0;
  const range = (r: [number, number]) => Array.isArray(r) && r[0] >= 0 && r[1] >= r[0];

  if (!money(config.rate) || config.rate === 0) errors.push('The price per sq ft must be a whole amount above zero.');
  if (!money(config.minimum)) errors.push('The minimum job must be a whole, non-negative amount.');
  for (const key of ['cracks', 'removal', 'stemWall', 'steps', 'spalling', 'moisturePrimer'] as const) {
    const r = config[key];
    if (!money(r.rate)) errors.push(`${r.label}: the price must be a whole, non-negative amount.`);
  }
  if (!(config.cracks.freeFeet >= 0)) errors.push('Included crack feet can’t be negative.');
  if (!(Number.isInteger(config.roundTo) && config.roundTo > 0)) errors.push('Rounding must be above zero.');

  const { quick } = config;
  if (quick.sizes.length === 0) errors.push('At least one garage size is needed.');
  const seen = new Set<string>();
  for (const s of quick.sizes) {
    if (seen.has(s.id)) errors.push(`Two garage sizes share the id "${s.id}".`);
    seen.add(s.id);
    if (!(s.width > 0 && s.depth > 0)) errors.push(`${s.label}: width and depth must be above zero.`);
  }
  if (!(range(quick.sqft) && quick.sqft[0] > 0)) errors.push('The sq ft range for typed sizes is backwards or empty.');
  if (!(quick.spread >= 0 && quick.spread < 1)) errors.push('The extra range width must be between 0% and 99%.');
  if (!range(quick.crackFeet)) errors.push('The crack guess (low, high) is backwards.');
  if (!(range(quick.stemWallShare) && quick.stemWallShare[1] <= 1)) {
    errors.push('The stem wall guess must be between 0% and 100%, low before high.');
  }
  return errors;
}
