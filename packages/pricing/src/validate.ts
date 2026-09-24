import type { PricingConfig } from './types.ts';

/**
 * Problems that would make the formula misbehave, in words Jacob can act on.
 * Empty means the config is safe to save. The app runs this before every save
 * and the API runs it again before storing.
 */
export function validateConfig(config: PricingConfig): string[] {
  const errors: string[] = [];
  const money = (n: number) => Number.isInteger(n) && n >= 0;

  const dupes = (kind: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) errors.push(`Two ${kind} share the id "${id}".`);
      seen.add(id);
    }
  };
  dupes('vehicle sizes', config.vehicleClasses.map((c) => c.id));
  dupes('services', config.services.map((s) => s.id));
  dupes('condition questions', config.conditions.map((c) => c.id));
  dupes('add-ons', config.addOns.map((a) => a.id));
  dupes('travel zones', config.travel.zones.map((z) => z.id));

  if (config.vehicleClasses.length === 0) errors.push('At least one vehicle size is needed.');
  for (const c of config.vehicleClasses) {
    if (!(c.multiplier > 0)) errors.push(`${c.label}: the size multiplier must be above zero.`);
  }

  const serviceIds = new Set(config.services.map((s) => s.id));
  const conditionIds = new Set(config.conditions.map((c) => c.id));
  for (const s of config.services) {
    if (!money(s.base)) errors.push(`${s.name}: the base price must be a whole, non-negative amount.`);
    if (!(s.hours[0] >= 0 && s.hours[1] >= s.hours[0])) {
      errors.push(`${s.name}: the high hours can't be below the low hours.`);
    }
    if (!(s.spread >= 0 && s.spread < 1)) errors.push(`${s.name}: the range must be between 0% and 99%.`);
    if (!s.inspectionOnly && s.base === 0) errors.push(`${s.name}: needs a price, or mark it inspection only.`);
    for (const id of s.ignoresConditions ?? []) {
      if (!conditionIds.has(id)) errors.push(`${s.name}: ignores a question that doesn't exist ("${id}").`);
    }
  }

  for (const c of config.conditions) {
    if (c.options.length === 0) errors.push(`"${c.question}" has no answers.`);
    if (c.options[0] && c.options[0].add !== 0) {
      errors.push(`"${c.question}": the first answer is the default and must cost nothing.`);
    }
    dupes(`answers to "${c.question}"`, c.options.map((o) => o.id));
    for (const o of c.options) {
      if (!money(o.add)) errors.push(`"${o.label}": the price must be a whole, non-negative amount.`);
      if (!(o.hours >= 0)) errors.push(`"${o.label}": hours can't be negative.`);
    }
  }

  for (const a of config.addOns) {
    if (!money(a.price)) errors.push(`${a.label}: the price must be a whole, non-negative amount.`);
    if (!(a.hours >= 0)) errors.push(`${a.label}: hours can't be negative.`);
    for (const id of a.includedIn ?? []) {
      if (!serviceIds.has(id)) errors.push(`${a.label}: included in a service that doesn't exist ("${id}").`);
    }
  }

  for (const z of config.travel.zones) {
    if (!money(z.fee)) errors.push(`${z.label}: the travel fee must be a whole, non-negative amount.`);
    for (const zip of z.zips) {
      if (!/^\d{3,5}$/.test(zip)) errors.push(`${z.label}: "${zip}" isn't a ZIP code or ZIP prefix.`);
    }
  }
  if (config.travel.outsideFee !== null && !money(config.travel.outsideFee)) {
    errors.push('The outside-area travel fee must be a whole, non-negative amount.');
  }

  if (!money(config.minimum)) errors.push('The minimum job must be a whole, non-negative amount.');
  if (!(Number.isInteger(config.roundTo) && config.roundTo > 0)) errors.push('Rounding must be above zero.');
  const [min, max] = config.boatFeet;
  if (!(min > 0 && max >= min)) errors.push('The boat length range is backwards or empty.');

  return errors;
}
