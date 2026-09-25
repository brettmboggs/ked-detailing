import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig, formatRange, fromPrice, offerableAddOns, quote, QuoteError, validateConfig } from './index.ts';
import type { PricingConfig } from './index.ts';

const config = defaultConfig;
const clone = (): PricingConfig => structuredClone(defaultConfig);

test('the shipped defaults are valid', () => {
  assert.deepEqual(validateConfig(config), []);
});

test('a clean sedan in the core zone is just the base, rounded to a range', () => {
  const q = quote(config, { service: 'level-1', vehicleClass: 'sedan', zip: '63049' });
  assert.equal(q.total, 15000);
  assert.deepEqual(q.range, [13500, 16500]); // ±8%, rounded outward to $5
  assert.deepEqual(q.hours, [2, 3]);
  assert.equal(q.travelZone?.id, 'core');
  assert.equal(q.lines.length, 1);
  assert.equal(q.inspection, false);
});

test('size scales the base and any size-scaled condition', () => {
  const q = quote(config, {
    service: 'level-2',
    vehicleClass: 'large',
    conditions: { 'pet-hair': 'heavy', stains: 'few' },
    zip: '63101',
  });
  // 275 × 1.3 = 357.50; heavy pet hair 90 × 1.3 = 117; a few stains flat 30
  assert.deepEqual(
    q.lines.map((l) => l.amount),
    [35750, 11700, 3000],
  );
  assert.equal(q.total, 50450);
});

test('conditions a service ignores are not charged', () => {
  const q = quote(config, {
    service: 'level-1',
    vehicleClass: 'sedan',
    conditions: { stains: 'many', odor: 'smoke' },
  });
  assert.equal(q.total, 15000);
});

test('add-ons already included in the service are dropped, not charged', () => {
  const q = quote(config, {
    service: 'level-3',
    vehicleClass: 'sedan',
    addOns: ['engine-bay', 'sealant', 'headlights'],
  });
  assert.deepEqual(
    q.lines.map((l) => l.label),
    ['The Knockout — Sedan', 'Headlight restoration'],
  );
});

test('an unknown add-on is an error, not a silent discount', () => {
  assert.throws(
    () => quote(config, { service: 'level-1', vehicleClass: 'sedan', addOns: ['nope'] }),
    QuoteError,
  );
});

test('travel: prefix zones, fees, and ZIPs outside every zone', () => {
  const stCharles = quote(config, { service: 'level-1', vehicleClass: 'sedan', zip: '63301' });
  assert.equal(stCharles.travelZone?.id, 'st-charles');
  assert.equal(stCharles.total, 17500);

  const illinois = quote(config, { service: 'level-1', vehicleClass: 'sedan', zip: '62220' });
  assert.equal(illinois.travelZone, null);
  assert.equal(illinois.inspection, true);
  assert.ok(illinois.range, 'still gives a number, just flagged');

  const none = quote(config, { service: 'level-1', vehicleClass: 'sedan' });
  assert.match(none.notes.join(' '), /ZIP/);
});

test('an exact ZIP beats a prefix', () => {
  const c = clone();
  c.travel.zones.push({ id: 'far', label: 'Far end', zips: ['63090'], fee: 4000 });
  assert.equal(quote(c, { service: 'level-1', vehicleClass: 'sedan', zip: '63090' }).travelZone?.id, 'far');
});

test('the minimum job tops up small quotes', () => {
  const c = clone();
  c.minimum = 20000;
  const q = quote(c, { service: 'level-1', vehicleClass: 'compact' });
  assert.equal(q.total, 20000);
  assert.equal(q.lines.at(-1)?.label, 'Minimum job');
});

test('inspection-only services capture the job without a number', () => {
  const q = quote(config, { service: 'ceramic', vehicleClass: 'sedan' });
  assert.equal(q.range, null);
  assert.equal(q.inspection, true);
  assert.equal(fromPrice(config, 'ceramic'), null);
  assert.ok(!q.lines.some((l) => l.label === 'Minimum job'));
});

test('boats price per foot, and size-scaled boat conditions are per foot too', () => {
  const q = quote(config, { service: 'marine', boatFeet: 20, conditions: { oxidation: 'moderate' } });
  assert.deepEqual(
    q.lines.map((l) => l.amount),
    [30000, 8000],
  );
  assert.deepEqual(q.hours, [4, 6]); // 20×0.15 + 20×0.05 = 4; 20×0.25 + 1 = 6
});

test('boats outside the length range are flagged', () => {
  assert.equal(quote(config, { service: 'marine', boatFeet: 60 }).inspection, true);
  assert.throws(() => quote(config, { service: 'marine' }), QuoteError);
});

test('fromPrice is the low end for the smallest vehicle', () => {
  // 150 × 0.9 = 135, less 8% = 124.20, floored to $5
  assert.equal(fromPrice(config, 'level-1'), 12000);
});

test('formatting', () => {
  assert.equal(formatRange([13500, 16500]), '$135–$165');
  assert.equal(formatRange([124000, 124000]), '$1,240');
});

test('validation catches the mistakes a hand edit makes', () => {
  const c = clone();
  c.services[0]!.base = 99.5;
  c.conditions[0]!.options[0]!.add = 1000;
  c.addOns[0]!.includedIn = ['level-9'];
  c.travel.zones[0]!.zips.push('63A');
  const errors = validateConfig(c);
  assert.equal(errors.length, 4, errors.join('\n'));
});

test('add-ons to offer at the car: priced for the vehicle, minus what the job has or its package includes', () => {
  const sedan = config.vehicleClasses.find((c) => c.id === 'sedan')!.multiplier;
  const offers = offerableAddOns(config, { service: 'level-1', vehicleClass: 'sedan', addOns: ['headlights'] });
  assert.ok(!offers.some((a) => a.id === 'headlights'), 'already on the job');
  assert.equal(offers.find((a) => a.id === 'engine-bay')?.amount, 6000, 'flat price');
  assert.equal(offers.find((a) => a.id === 'sealant')?.amount, Math.round(7500 * sedan), 'scales with size');
  const l3 = offerableAddOns(config, { service: 'level-3', vehicleClass: 'sedan' });
  assert.ok(!l3.some((a) => a.id === 'engine-bay' || a.id === 'sealant'), 'included in level 3');
  assert.deepEqual(offerableAddOns(config, { service: 'gone', vehicleClass: 'sedan' }), []);
});
