import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultFloorConfig, floorQuote, quickFloorQuote, QuoteError, validateFloorConfig } from './index.ts';
import type { FloorPricingConfig } from './index.ts';

const config = defaultFloorConfig;
const clone = (): FloorPricingConfig => structuredClone(defaultFloorConfig);

test('the shipped floor defaults are valid', () => {
  assert.deepEqual(validateFloorConfig(config), []);
});

test('firm quote: every measured item is its own line', () => {
  const q = floorQuote(config, {
    sqft: 500,
    crackFeet: 35,
    stemWallFeet: 40,
    steps: 2,
    spalledSqft: 10,
    moisturePrimer: true,
  });
  assert.deepEqual(
    q.lines.map((l) => [l.id, l.amount]),
    [
      ['floor', 350000],
      ['cracks', 9000], // 15 ft past the free 20, at $6
      ['stem-wall', 40000],
      ['steps', 30000],
      ['spalling', 3000],
      ['primer', 75000],
    ],
  );
  assert.equal(q.total, 507000);
  assert.equal(q.lines[1]?.label, 'Crack repair, 15 ft past the first 20');
});

test('firm quote: cracks within the free feet cost nothing', () => {
  const q = floorQuote(config, { sqft: 484, crackFeet: 20 });
  assert.deepEqual(q.lines.map((l) => l.id), ['floor']);
});

test('firm quote: small floors are topped up to the minimum', () => {
  const q = floorQuote(config, { sqft: 120 });
  assert.equal(q.total, 180000);
  assert.deepEqual(q.lines.at(-1), { id: 'minimum', label: 'Minimum job', amount: 96000 });
});

test('firm quote: a floor needs a size', () => {
  assert.throws(() => floorQuote(config, { sqft: 0 }), QuoteError);
  assert.throws(() => floorQuote(config, { sqft: Number.NaN }), QuoteError);
});

test('quick quote: a plain 2-car garage', () => {
  const q = quickFloorQuote(config, { garage: { size: '2-car' } });
  assert.equal(q.sqft, 484);
  // 484 × $7 = $3,388, ±5%, rounded outward to $25
  assert.deepEqual(q.range, [320000, 357500]);
  assert.deepEqual(q.lines, [{ id: 'floor', label: 'Full-flake floor, about 484 sq ft', range: [338800, 338800] }]);
  assert.equal(q.measureFirst, false);
  assert.ok(q.notes.some((n) => n.includes('moisture primer adds about $726')));
});

test('quick quote: every yes widens the range by its guesses', () => {
  const q = quickFloorQuote(config, { garage: { size: '2-car' }, cracks: true, oldCoating: true, stemWall: true });
  // low: floor 3,388 + removal 726 + half the 66 ft of wall 330 = 4,444
  // high: floor 3,388 + 40 ft of cracks 240 + removal 726 + 66 ft of wall 660 = 5,014
  assert.deepEqual(q.range, [420000, 527500]);
  assert.deepEqual(
    q.lines.map((l) => [l.id, l.range]),
    [
      ['floor', [338800, 338800]],
      ['removal', [72600, 72600]],
      ['stem-wall', [33000, 66000]],
      ['cracks', [0, 24000]],
    ],
  );
  assert.ok(q.notes.some((n) => n.includes('first 20 ft of crack repair')));
});

test('quick quote: typed sizes, and odd ones wait for the visit', () => {
  const q = quickFloorQuote(config, { garage: { width: 24, depth: 26 } });
  assert.equal(q.sqft, 624);
  assert.equal(q.measureFirst, false);

  const tiny = quickFloorQuote(config, { garage: { width: 10, depth: 12 } });
  assert.equal(tiny.measureFirst, true);
  assert.deepEqual(tiny.range, [180000, 190000]); // the $1,800 minimum, +5% out to $25, never below it
  assert.throws(() => quickFloorQuote(config, { garage: { width: 0, depth: 20 } }), QuoteError);
  assert.throws(() => quickFloorQuote(config, { garage: { size: '9-car' } }), QuoteError);
});

test('quick quote and firm quote share one set of prices', () => {
  const c = clone();
  c.rate = 800;
  const quick = quickFloorQuote(c, { garage: { size: '2-car' } });
  const firm = floorQuote(c, { sqft: 484 });
  assert.equal(quick.lines[0]?.range[0], firm.total);
  assert.equal(quick.configVersion, c.version);
});

test('validation catches backwards guesses and empty sizes', () => {
  const c = clone();
  c.quick.crackFeet = [40, 0];
  c.quick.stemWallShare = [0.5, 1.5];
  c.quick.sizes = [];
  c.rate = 0;
  const errors = validateFloorConfig(c);
  assert.equal(errors.length, 4);
});
