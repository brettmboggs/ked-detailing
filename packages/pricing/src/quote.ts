import type {
  AddOn,
  Condition,
  PricingConfig,
  Quote,
  QuoteInput,
  QuoteLine,
  Service,
  TravelZone,
} from './types.ts';

export class QuoteError extends Error {}

/**
 * Price a job. Pure and synchronous: the same config and input always give the
 * same quote, on the website and in the app alike.
 */
export function quote(config: PricingConfig, input: QuoteInput): Quote {
  const service = config.services.find((s) => s.id === input.service);
  if (!service) throw new QuoteError(`Unknown service "${input.service}"`);

  const lines: QuoteLine[] = [];
  const notes: string[] = [];
  let inspection = false;
  let hoursLow = 0;
  let hoursHigh = 0;

  // Size factor: the class multiplier for cars, length in feet for boats. So a
  // size-scaled boat condition or add-on is priced per foot.
  let size: number;
  if (service.craft === 'vehicle') {
    const cls = config.vehicleClasses.find((c) => c.id === input.vehicleClass);
    if (!cls) throw new QuoteError(`Unknown vehicle class "${input.vehicleClass ?? ''}"`);
    size = cls.multiplier;
    lines.push({ label: `${service.name} — ${cls.label}`, amount: Math.round(service.base * size) });
  } else {
    const feet = input.boatFeet;
    if (feet === undefined || !Number.isFinite(feet) || feet <= 0) {
      throw new QuoteError('Boat length is required');
    }
    size = feet;
    const [min, max] = config.boatFeet;
    if (feet < min || feet > max) {
      inspection = true;
      notes.push(`Boats outside ${min}–${max} ft are priced after Jacob sees them.`);
    }
    lines.push({ label: `${service.name} — ${feet} ft`, amount: Math.round(service.base * feet) });
  }
  hoursLow += service.hours[0] * size;
  hoursHigh += service.hours[1] * size;

  for (const condition of applicableConditions(config, service)) {
    const optionId = input.conditions?.[condition.id];
    const option = condition.options.find((o) => o.id === optionId) ?? condition.options[0];
    if (!option) continue;
    const factor = option.scalesWithSize ? size : 1;
    if (option.add > 0) {
      lines.push({ label: option.label, amount: Math.round(option.add * factor) });
    }
    hoursLow += option.hours * factor;
    hoursHigh += option.hours * factor;
    if (option.flagsInspection) {
      inspection = true;
      notes.push(`"${option.label}" is confirmed on inspection.`);
    }
  }

  const available = new Set(applicableAddOns(config, service).map((a) => a.id));
  for (const id of new Set(input.addOns ?? [])) {
    const addOn = config.addOns.find((a) => a.id === id);
    if (!addOn) throw new QuoteError(`Unknown add-on "${id}"`);
    // Dropped rather than rejected: switching to a higher level can make a
    // ticked add-on redundant, and the customer shouldn't be charged for it.
    if (!available.has(id)) continue;
    const factor = addOn.scalesWithSize ? size : 1;
    lines.push({ label: addOn.label, amount: Math.round(addOn.price * factor) });
    hoursLow += addOn.hours * factor;
    hoursHigh += addOn.hours * factor;
  }

  const zip = normaliseZip(input.zip);
  let travelZone: TravelZone | null = null;
  if (zip) {
    travelZone = findZone(config, zip);
    if (travelZone) {
      if (travelZone.fee > 0) lines.push({ label: `Travel — ${travelZone.label}`, amount: travelZone.fee });
    } else if (config.travel.outsideFee === null) {
      inspection = true;
      notes.push(`${zip} is outside the usual service area. Jacob will confirm travel.`);
    } else if (config.travel.outsideFee > 0) {
      lines.push({ label: 'Travel — outside the usual area', amount: config.travel.outsideFee });
    }
  } else {
    notes.push('Travel is added once we have your ZIP code.');
  }

  let total = lines.reduce((sum, l) => sum + l.amount, 0);
  // An inspection-only job has no price yet, so there is nothing to top up.
  if (!service.inspectionOnly && total < config.minimum) {
    lines.push({ label: 'Minimum job', amount: config.minimum - total });
    total = config.minimum;
  }

  let range: [number, number] | null = null;
  if (service.inspectionOnly) {
    inspection = true;
    notes.unshift(`${service.name} is priced after Jacob sees the vehicle.`);
  } else {
    range = [
      roundDown(total * (1 - service.spread), config.roundTo),
      roundUp(total * (1 + service.spread), config.roundTo),
    ];
  }

  return {
    service,
    lines,
    total,
    range,
    hours: [roundHalf(hoursLow), roundHalf(hoursHigh)],
    inspection,
    notes,
    travelZone,
    configVersion: config.version,
  };
}

/**
 * The lowest honest "from" price for a service: smallest vehicle (or boat),
 * best condition, no add-ons, no travel. Null for inspection-only services.
 */
export function fromPrice(config: PricingConfig, serviceId: string): number | null {
  const service = config.services.find((s) => s.id === serviceId);
  if (!service || service.inspectionOnly) return null;
  const input: QuoteInput =
    service.craft === 'vehicle'
      ? {
          service: serviceId,
          vehicleClass: [...config.vehicleClasses].sort((a, b) => a.multiplier - b.multiplier)[0]?.id,
        }
      : { service: serviceId, boatFeet: config.boatFeet[0] };
  // A ZIP inside a free zone would be tidier, but not every config has one.
  const q = quote(config, input);
  return q.range ? q.range[0] : null;
}

export function applicableConditions(config: PricingConfig, service: Service): Condition[] {
  return config.conditions.filter(
    (c) => c.craft === service.craft && !service.ignoresConditions?.includes(c.id),
  );
}

export function applicableAddOns(config: PricingConfig, service: Service): AddOn[] {
  return config.addOns.filter((a) => a.craft === service.craft && !a.includedIn?.includes(service.id));
}

/** Exact 5-digit matches win over prefixes; longer prefixes win over shorter. */
export function findZone(config: PricingConfig, zip: string): TravelZone | null {
  let best: TravelZone | null = null;
  let bestLength = 0;
  for (const zone of config.travel.zones) {
    for (const z of zone.zips) {
      if (zip.startsWith(z) && z.length > bestLength) {
        best = zone;
        bestLength = z.length;
      }
    }
  }
  return best;
}

function normaliseZip(zip: string | undefined): string | null {
  const digits = (zip ?? '').replace(/\D/g, '').slice(0, 5);
  return digits.length === 5 ? digits : null;
}

const roundDown = (cents: number, step: number) => Math.floor(cents / step) * step;
const roundUp = (cents: number, step: number) => Math.ceil(cents / step) * step;
const roundHalf = (hours: number) => Math.round(hours * 2) / 2;

/** "$1,240" — whole dollars; quotes never show cents. */
export function formatMoney(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString('en-US')}`;
}

export function formatRange(range: [number, number]): string {
  return range[0] === range[1]
    ? formatMoney(range[0])
    : `${formatMoney(range[0])}–${formatMoney(range[1])}`;
}

export function formatHours([low, high]: [number, number]): string {
  const f = (h: number) => (h === 1 ? '1 hr' : `${h} hrs`);
  return low === high ? f(low) : `${low}–${f(high)}`;
}
