import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  areaFromStroke,
  checkFloorMap,
  formatFeet,
  insertCorner,
  lPlan,
  lineFromStroke,
  measureFloorMap,
  moveCorner,
  parseFeet,
  planToMap,
  rectanglePlan,
  removeCorner,
  setWallLength,
  toggleStemWall,
  wallLength,
} from './index.ts';
import type { Pt } from './index.ts';

const garage = () => {
  const p = rectanglePlan(22, 24);
  p.doors.push({ wall: 0, at: 11, width: 16 });
  return p;
};

test('a door on the front wall, and a stem wall that stops at it', () => {
  let p = garage();
  p = toggleStemWall(p, 0); // front: either side of the door
  p = toggleStemWall(p, 2); // back wall, full length
  const map = planToMap(p);
  assert.deepEqual(map.doors, [{ a: [3, 0], b: [19, 0] }]);
  const m = measureFloorMap(map);
  assert.equal(m.stemWallFeet, 3 + 3 + 22);
  assert.equal(m.doorFeet, 16);
  assert.deepEqual(checkFloorMap(map), []);
});

test('typing a wall length keeps a rectangle square, and the door moves with its wall', () => {
  const p = setWallLength(garage(), 0, 24); // front wall 22 -> 24
  assert.equal(wallLength(p, 0), 24);
  assert.equal(wallLength(p, 2), 24); // back wall followed
  assert.equal(wallLength(p, 1), 24); // depth unchanged
  assert.equal(measureFloorMap(planToMap(p)).sqft, 24 * 24);
  const deeper = setWallLength(p, 1, 26);
  assert.equal(measureFloorMap(planToMap(deeper)).sqft, 24 * 26);
});

test('a corner added on a wall keeps the door and stem wall on the same stretch', () => {
  let p = toggleStemWall(garage(), 0);
  p = insertCorner(p, 0, [20, 0.4]); // lands on the wall at x = 20
  assert.equal(p.outline.length, 5);
  assert.deepEqual(p.outline[1], [20, 0]);
  assert.deepEqual(p.stemWalls, [0, 1]);
  assert.deepEqual(planToMap(p).doors, [{ a: [3, 0], b: [19, 0] }]);
  const back = removeCorner(p, 1);
  assert.equal(back.outline.length, 4);
  assert.deepEqual(back.stemWalls, [0]);
  assert.deepEqual(planToMap(back).doors, [{ a: [3, 0], b: [19, 0] }]);
});

test('removing the first corner keeps doors on the merged wall', () => {
  const p = rectanglePlan(20, 20);
  const five = insertCorner(p, 3, [0, 10]); // a corner halfway up the left wall
  five.doors.push({ wall: 4, at: 5, width: 3 }); // on the lower half of the left wall
  const four = removeCorner(five, 4);
  assert.equal(four.outline.length, 4);
  assert.equal(four.doors[0]!.wall, 3);
  assert.equal(four.doors[0]!.at, 15);
});

test('corners snap to 3 inches and square up with their neighbours', () => {
  const p = moveCorner(rectanglePlan(22, 24), 2, [22.3, 24.11]);
  assert.deepEqual(p.outline[2], [22, 24]);
  const q = moveCorner(rectanglePlan(22, 24), 2, [25.6, 30.1]);
  assert.deepEqual(q.outline[2], [25.5, 30]);
});

test('an L-shaped plan measures its full area', () => {
  assert.equal(measureFloorMap(planToMap(lPlan(22, 24, 10, 8))).sqft, 22 * 24 + 10 * 8);
});

test('a circled area is kept on the floor and a crossed loop still makes an area', () => {
  const p = rectanglePlan(10, 10);
  const loop: Pt[] = [[1, 1], [4, 1], [4, 4], [1, 4], [1.1, 1.1]];
  const area = areaFromStroke(p, loop)!;
  assert.ok(Math.abs(measureFloorMap({ ...planToMap(p), spalls: [area] }).spalledSqft! - 9) < 0.01);
  const outside = areaFromStroke(p, [[8, 8], [12, 8], [12, 12], [8, 12]])!;
  assert.ok(outside.every(([x, y]) => x <= 10 && y <= 10));
  const bow = areaFromStroke(p, [[1, 1], [5, 5], [5, 1], [1, 5]])!;
  assert.ok(bow.length >= 3);
  assert.equal(areaFromStroke(p, [[1, 1], [1.1, 1.1], [1.2, 1]]), null);
});

test('a drawn crack is smoothed; a tap is not a crack', () => {
  const p = rectanglePlan(10, 10);
  const wobbly: Pt[] = Array.from({ length: 30 }, (_, i) => [1 + i * 0.2, 5 + (i % 2) * 0.02] as Pt);
  assert.equal(lineFromStroke(p, wobbly)!.length, 2);
  assert.equal(lineFromStroke(p, [[2, 2], [2.1, 2.1]]), null);
});

test('lengths read the way people type them', () => {
  for (const [t, v] of [['22', 22], ['22.5', 22.5], ['22 6', 22.5], ["22'6", 22.5], ['22\' 6"', 22.5], ['22ft 6in', 22.5], ['270in', 22.5], ['22′ 6″', 22.5]] as const)
    assert.equal(parseFeet(t), v, t);
  for (const t of ['', 'abc', '22 13', '-4']) assert.equal(parseFeet(t), null, t);
  assert.equal(formatFeet(22.5), '22′ 6″');
  assert.equal(formatFeet(22), '22′');
  assert.equal(formatFeet(21.999), '22′');
});
