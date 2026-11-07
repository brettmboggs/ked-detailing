import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkFloorMap,
  defaultFloorConfig,
  floorQuote,
  measureFloorMap,
  pointInPolygon,
  polygonArea,
  rectangleFloorMap,
  selfIntersects,
} from './index.ts';
import type { FloorMap, Pt } from './index.ts';

const garage = (): FloorMap => {
  const m = rectangleFloorMap(22, 24);
  m.doors.push({ a: [3, 0], b: [19, 0] }); // 16 ft door
  return m;
};

test('a plain rectangle measures its area, and the edge leaves out the door', () => {
  const m = measureFloorMap(garage());
  assert.equal(m.sqft, 528);
  assert.equal(m.edgeFeet, 22 * 2 + 24 * 2 - 16);
  assert.equal(m.crackFeet, 0);
  assert.equal(m.steps, 0);
});

test('an L-shaped garage measures as drawn, either winding', () => {
  // 22 wide at the door, a 10 x 8 bump-out at the back right.
  const L: Pt[] = [[0, 0], [22, 0], [22, 32], [12, 32], [12, 24], [0, 24]];
  assert.equal(polygonArea(L), 22 * 24 + 10 * 8);
  assert.equal(polygonArea([...L].reverse()), 22 * 24 + 10 * 8);
});

test('cracks, stem wall, spalls, steps and excluded areas all come from the drawing', () => {
  const map = garage();
  map.cracks.push([[2, 5], [8, 5], [8, 9]]); // 6 + 4 ft
  map.stemWalls.push({ a: [0, 0], b: [0, 24] }, { a: [0, 24], b: [22, 24] });
  map.spalls.push([[18, 1], [20, 1], [20, 3], [18, 3]]);
  map.excluded.push([[0, 22], [3, 22], [3, 24], [0, 24]]); // heater pad
  map.fixtures.push({ kind: 'step', at: [11, 24], width: 4 }, { kind: 'drain', at: [11, 12] });
  map.oldCoating = 'all';
  const m = measureFloorMap(map);
  assert.equal(m.sqft, 528 - 6);
  assert.equal(m.crackFeet, 10);
  assert.equal(m.stemWallFeet, 46);
  assert.equal(m.spalledSqft, 4);
  assert.equal(m.removalSqft, 522);
  assert.equal(m.steps, 1);
  assert.equal(m.stepFeet, 4);
  assert.deepEqual(checkFloorMap(map), []);
});

test('the measurements price with the same firm-quote formula as everything else', () => {
  const map = garage();
  map.cracks.push([[2, 5], [2, 23]]); // 18 ft
  const m = measureFloorMap(map);
  const fromMap = floorQuote(defaultFloorConfig, m);
  const byHand = floorQuote(defaultFloorConfig, { sqft: 528, crackFeet: 18 });
  assert.equal(m.crackFeet, 18);
  assert.equal(fromMap.total, byHand.total);
});

test('a drawing that crosses itself or strays outside the floor is flagged in plain words', () => {
  const bow: Pt[] = [[0, 0], [10, 10], [10, 0], [0, 10]];
  assert.equal(selfIntersects(bow), true);
  assert.equal(selfIntersects([[0, 0], [10, 0], [10, 10], [0, 10]]), false);
  const map = garage();
  map.outline = bow;
  assert.match(checkFloorMap(map)[0]!.message, /crosses itself/);

  const stray = garage();
  stray.cracks.push([[5, 5], [30, 5]]);
  stray.fixtures.push({ kind: 'step', at: [11, 24] });
  const problems = checkFloorMap(stray);
  assert.deepEqual(problems.map((p) => p.ref), ['cracks', 'fixtures']);
});

test('an empty drawing asks for an outline', () => {
  const map = rectangleFloorMap(1, 1);
  map.outline = [];
  assert.match(checkFloorMap(map)[0]!.message, /outline/);
});

test('points on an edge count as inside', () => {
  const sq: Pt[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.equal(pointInPolygon([0, 5], sq), true);
  assert.equal(pointInPolygon([5, 5], sq), true);
  assert.equal(pointInPolygon([11, 5], sq), false);
});
