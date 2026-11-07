import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyFloorQuoteEdits, defaultFloorConfig as config, floorQuote, noQuoteEdits } from './index.ts';

const q = floorQuote(config, { sqft: 500, stemWallFeet: 40, steps: 1 });

test('no changes: the formula as it was', () => {
  const e = applyFloorQuoteEdits(config, q, noQuoteEdits());
  assert.equal(e.total, q.total);
  assert.equal(e.edited, false);
  assert.ok(e.lines.every((l) => l.source === 'formula'));
});

test('a re-priced line keeps what the formula said', () => {
  const edits = noQuoteEdits();
  edits.lines['stem-wall'] = { amount: 30000, label: 'Stem wall, back and left' };
  const e = applyFloorQuoteEdits(config, q, edits);
  const stem = e.lines.find((l) => l.id === 'stem-wall')!;
  assert.equal(stem.source, 'changed');
  assert.deepEqual(stem.formula, { label: 'Stem wall, 40 ft', amount: 40000 });
  assert.equal(e.total, q.total - 10000);
  assert.equal(e.edited, true);
});

test('lines can be taken out and added, and a discount is a negative line', () => {
  const edits = noQuoteEdits();
  edits.lines.steps = { removed: true };
  edits.extras.push({ id: 'x1', label: 'Move the freezer', amount: 5000 }, { id: 'x2', label: 'Friends and family', amount: -20000 });
  const e = applyFloorQuoteEdits(config, q, edits);
  assert.deepEqual(e.removed.map((r) => r.id), ['steps']);
  assert.equal(e.total, q.total - 15000 + 5000 - 20000);
  assert.deepEqual(e.lines.slice(-2).map((l) => l.source), ['added', 'added']);
});

test('the minimum is worked out on the changed lines, unless it is taken out', () => {
  const small = floorQuote(config, { sqft: 300 });
  const edits = noQuoteEdits();
  edits.extras.push({ id: 'd', label: 'Discount', amount: -50000 });
  const e = applyFloorQuoteEdits(config, small, edits);
  assert.equal(e.total, config.minimum);
  assert.equal(e.lines.at(-1)!.id, 'minimum');
  edits.lines.minimum = { removed: true };
  const below = applyFloorQuoteEdits(config, small, edits);
  assert.ok(below.total < config.minimum);
  assert.equal(below.removed.at(-1)!.id, 'minimum');
});

test('a blank added line is ignored', () => {
  const edits = noQuoteEdits();
  edits.extras.push({ id: 'x', label: '  ', amount: 0 });
  assert.equal(applyFloorQuoteEdits(config, q, edits).lines.length, q.lines.length);
});
