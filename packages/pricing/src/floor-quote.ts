import { QuoteError, formatMoney } from './quote.ts';
import type {
  FloorLine,
  FloorMeasurements,
  FloorPricingConfig,
  FloorQuote,
  QuickFloorInput,
  QuickFloorQuote,
} from './floor-types.ts';

/**
 * The firm price for a floor, from what was measured at the visit. Pure and
 * synchronous: the same config and measurements always give the same price,
 * on the website, in the app and on the server.
 */
export function floorQuote(config: FloorPricingConfig, m: FloorMeasurements): FloorQuote {
  if (!(Number.isFinite(m.sqft) && m.sqft > 0)) throw new QuoteError('The floor size is required');
  const lines: FloorLine[] = [];
  const add = (line: FloorLine) => {
    if (line.amount > 0) lines.push({ ...line, amount: Math.round(line.amount) });
  };
  const n = (v: number | undefined) => (Number.isFinite(v) && (v as number) > 0 ? (v as number) : 0);

  const sqft = Math.round(m.sqft);
  add({ id: 'floor', label: `Full-flake floor, ${sqft} sq ft`, amount: sqft * config.rate });

  const crackFeet = Math.max(0, n(m.crackFeet) - config.cracks.freeFeet);
  add({
    id: 'cracks',
    label: `${config.cracks.label}, ${Math.round(crackFeet)} ft past the first ${config.cracks.freeFeet}`,
    amount: crackFeet * config.cracks.rate,
  });
  add({ id: 'removal', label: config.removal.label, amount: n(m.removalSqft) * config.removal.rate });
  add({
    id: 'stem-wall',
    label: `${config.stemWall.label}, ${Math.round(n(m.stemWallFeet))} ft`,
    amount: n(m.stemWallFeet) * config.stemWall.rate,
  });
  const steps = Math.round(n(m.steps));
  add({ id: 'steps', label: steps === 1 ? config.steps.label : `${config.steps.label} × ${steps}`, amount: steps * config.steps.rate });
  add({ id: 'spalling', label: config.spalling.label, amount: n(m.spalledSqft) * config.spalling.rate });
  if (m.moisturePrimer) add({ id: 'primer', label: config.moisturePrimer.label, amount: sqft * config.moisturePrimer.rate });

  let total = lines.reduce((sum, l) => sum + l.amount, 0);
  if (total < config.minimum) {
    lines.push({ id: 'minimum', label: 'Minimum job', amount: config.minimum - total });
    total = config.minimum;
  }
  return { lines, total, configVersion: config.version };
}

/**
 * The website's quick quote: a range from a garage size and three yes/no
 * answers, with no contact details asked. Each unknown measurement is
 * guessed low and high from the config, the firm formula prices both, and
 * the range is widened by `quick.spread` for a size taken by eye.
 */
export function quickFloorQuote(config: FloorPricingConfig, input: QuickFloorInput): QuickFloorQuote {
  let width: number;
  let depth: number;
  let typed = false;
  if ('size' in input.garage) {
    const id = input.garage.size;
    const preset = config.quick.sizes.find((s) => s.id === id);
    if (!preset) throw new QuoteError(`Unknown garage size "${id}"`);
    ({ width, depth } = preset);
  } else {
    ({ width, depth } = input.garage);
    if (!(Number.isFinite(width) && width > 0 && Number.isFinite(depth) && depth > 0)) {
      throw new QuoteError('Garage width and depth are required');
    }
    typed = true;
  }
  const sqft = Math.round(width * depth);
  // Back wall and both sides; the door wall has no curb.
  const walls = 2 * depth + width;
  const { quick } = config;

  const guess = (i: 0 | 1): FloorMeasurements => ({
    sqft,
    crackFeet: input.cracks ? config.cracks.freeFeet + quick.crackFeet[i] : 0,
    removalSqft: input.oldCoating ? sqft : 0,
    stemWallFeet: input.stemWall ? Math.round(walls * quick.stemWallShare[i]) : 0,
  });
  const low = floorQuote(config, guess(0));
  const high = floorQuote(config, guess(1));

  const range: [number, number] = [
    roundDown(low.total * (1 - quick.spread), config.roundTo),
    roundUp(high.total * (1 + quick.spread), config.roundTo),
  ];

  // Each part of the price as its own low–high, labelled without the guessed numbers.
  const short: Record<string, string> = {
    floor: `Full-flake floor, about ${sqft} sq ft`,
    cracks: config.cracks.label,
    removal: config.removal.label,
    'stem-wall': config.stemWall.label,
    minimum: 'Minimum job',
  };
  const amount = (q: FloorQuote, id: string) => q.lines.find((l) => l.id === id)?.amount ?? 0;
  const ids = [...new Set([...low.lines, ...high.lines].map((l) => l.id))];
  const lines = ids.map((id) => ({
    id,
    label: short[id] ?? id,
    range: [amount(low, id), amount(high, id)].sort((a, b) => a - b) as [number, number],
  }));

  const notes: string[] = [];
  let measureFirst = false;
  if (typed && (sqft < quick.sqft[0] || sqft > quick.sqft[1])) {
    measureFirst = true;
    notes.push(`Floors under ${quick.sqft[0]} or over ${quick.sqft[1]} sq ft are priced at the measure visit.`);
  }
  if (input.cracks) notes.push(`The first ${config.cracks.freeFeet} ft of crack repair is included.`);
  if (config.moisturePrimer.rate > 0) {
    notes.push(
      `We test the slab for moisture at the visit. If it's damp, a moisture primer adds about ${formatMoney(sqft * config.moisturePrimer.rate)}.`,
    );
  }
  notes.push('Steps and badly damaged concrete are priced at the visit.');

  return { sqft, range, lines, notes, measureFirst, configVersion: config.version };
}

const roundDown = (cents: number, step: number) => Math.floor(cents / step) * step;
const roundUp = (cents: number, step: number) => Math.ceil(cents / step) * step;
