/**
 * The floor map (ked-coatings docs/BRIEF.md, "The floor map runs
 * everything"). At the measure visit the owner draws the floor in the app;
 * everything the firm quote needs is measured from the drawing, never typed.
 *
 * Part of the floor-coating trade, not of one business: nothing here knows
 * whose floor it is.
 *
 * Units are feet. x runs along the garage door wall, y from the door toward
 * the back wall, so a plain 22 × 24 garage is the rectangle (0,0)–(22,24)
 * with the door on the y = 0 edge.
 */
import type { FloorMeasurements } from './floor-types.ts';

export type Pt = [x: number, y: number];
export interface Segment {
  a: Pt;
  b: Pt;
}

/** Things drawn as a point: what the crew has to work around or know about. */
export type FloorFixtureKind =
  | 'drain'
  | 'post'
  | 'water-heater'
  | 'outlet-120'
  | 'outlet-240'
  | 'step'
  | 'other';

export interface FloorFixture {
  kind: FloorFixtureKind;
  at: Pt;
  /** For a step: its width in feet (the tread that gets coated). */
  width?: number;
  note?: string;
}

export interface FloorMap {
  /** Shape of the stored drawing, for later changes. */
  version: 1;
  /** The coated floor, any shape: a closed polygon, corners in order. */
  outline: Pt[];
  /** Garage door openings, drawn on the outline. */
  doors: Segment[];
  /** The concrete curb along the walls that gets coated, per run. */
  stemWalls: Segment[];
  /** Each crack as a line, so its length is measured. */
  cracks: Pt[][];
  /** Spalled (flaking, pitted) areas to rebuild, as polygons. */
  spalls: Pt[][];
  /** Old paint, epoxy or coating to grind off: the whole floor, or areas. */
  oldCoating: 'none' | 'all' | Pt[][];
  /** Inside the outline but not coated: a fixed cabinet, a heater pad. */
  excluded: Pt[][];
  /** Another area the customer might coat later (basement, shop, patio). */
  future: { label: string; outline: Pt[] }[];
  fixtures: FloorFixture[];
}

export const emptyFloorMap = (): FloorMap => ({
  version: 1,
  outline: [],
  doors: [],
  stemWalls: [],
  cracks: [],
  spalls: [],
  oldCoating: 'none',
  excluded: [],
  future: [],
  fixtures: [],
});

/** A plain rectangle, the usual starting point: door along the front. */
export function rectangleFloorMap(width: number, depth: number): FloorMap {
  return {
    ...emptyFloorMap(),
    outline: [
      [0, 0],
      [width, 0],
      [width, depth],
      [0, depth],
    ],
  };
}

const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Area of a simple polygon (shoelace), always positive. */
export function polygonArea(p: Pt[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i]!;
    const [x2, y2] = p[(i + 1) % p.length]!;
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

/** Length of an open line through the points. */
export function polylineLength(p: Pt[]): number {
  let s = 0;
  for (let i = 1; i < p.length; i++) s += dist(p[i - 1]!, p[i]!);
  return s;
}

export function perimeter(p: Pt[]): number {
  return p.length < 2 ? 0 : polylineLength([...p, p[0]!]);
}

/** Is the point inside the polygon (edges count as inside)? */
export function pointInPolygon(pt: Pt, poly: Pt[]): boolean {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (onSegment(pt, poly[j]!, poly[i]!)) return true;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const EPS = 1e-6;

function onSegment(p: Pt, a: Pt, b: Pt): boolean {
  const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  if (Math.abs(cross) > EPS * Math.max(1, dist(a, b))) return false;
  return (
    Math.min(a[0], b[0]) - EPS <= p[0] &&
    p[0] <= Math.max(a[0], b[0]) + EPS &&
    Math.min(a[1], b[1]) - EPS <= p[1] &&
    p[1] <= Math.max(a[1], b[1]) + EPS
  );
}

/** Do two segments cross (touching at a shared end doesn't count)? */
function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const o1 = o(a, b, c);
  const o2 = o(a, b, d);
  const o3 = o(c, d, a);
  const o4 = o(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

/** A polygon whose edges cross itself has no meaningful area. */
export function selfIntersects(p: Pt[]): boolean {
  const n = p.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue; // neighbours share a corner
      if (segmentsCross(p[i]!, p[(i + 1) % n]!, p[j]!, p[(j + 1) % n]!)) return true;
    }
  }
  return false;
}

export interface FloorMapProblem {
  /** What it's about, for highlighting in the editor. */
  ref: 'outline' | 'doors' | 'stemWalls' | 'cracks' | 'spalls' | 'oldCoating' | 'excluded' | 'fixtures';
  index?: number;
  message: string;
}

/** What's wrong with a drawing, in words for the person drawing it. Empty when it can be priced. */
export function checkFloorMap(map: FloorMap): FloorMapProblem[] {
  const out: FloorMapProblem[] = [];
  const o = map.outline;
  if (o.length < 3) {
    out.push({ ref: 'outline', message: 'Draw the floor outline: at least three corners.' });
    return out;
  }
  if (selfIntersects(o)) out.push({ ref: 'outline', message: 'The outline crosses itself. Move a corner so the edges don’t cross.' });
  if (polygonArea(o) < 1) out.push({ ref: 'outline', message: 'The outline has no area.' });
  const inside = (pts: Pt[]) => pts.every((p) => pointInPolygon(p, o));
  map.cracks.forEach((c, i) => {
    if (c.length < 2) out.push({ ref: 'cracks', index: i, message: 'A crack needs at least two points.' });
    else if (!inside(c)) out.push({ ref: 'cracks', index: i, message: 'A crack runs outside the floor.' });
  });
  const areas = [
    ['spalls', map.spalls],
    ['excluded', map.excluded],
    ['oldCoating', Array.isArray(map.oldCoating) ? map.oldCoating : []],
  ] as const;
  for (const [ref, list] of areas) {
    list.forEach((a, i) => {
      if (a.length < 3) out.push({ ref, index: i, message: 'An area needs at least three corners.' });
      else if (selfIntersects(a)) out.push({ ref, index: i, message: 'An area crosses itself.' });
      else if (!inside(a)) out.push({ ref, index: i, message: 'An area reaches outside the floor.' });
    });
  }
  map.fixtures.forEach((f, i) => {
    if (f.kind === 'step' && !(f.width && f.width > 0)) out.push({ ref: 'fixtures', index: i, message: 'Give the step its width.' });
  });
  return out;
}

/** Everything measured from the drawing. Feeds `floorQuote` and the materials list. */
export interface FloorMapMeasurements extends FloorMeasurements {
  /** The outline's area before anything is cut out. */
  outlineSqft: number;
  excludedSqft: number;
  /** Wall length, door openings left out: where the cove or edge work goes. */
  edgeFeet: number;
  doorFeet: number;
  stepFeet: number;
  futureSqft: number;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Measure a drawing. The moisture primer is not on the map: it follows the
 * moisture test, so the caller sets `moisturePrimer` from the test result.
 * Assumes `checkFloorMap` found nothing (areas inside the outline, not
 * overlapping each other).
 */
export function measureFloorMap(map: FloorMap): FloorMapMeasurements {
  const outlineSqft = polygonArea(map.outline);
  const excludedSqft = map.excluded.reduce((s, a) => s + polygonArea(a), 0);
  const sqft = Math.max(0, outlineSqft - excludedSqft);
  const doorFeet = map.doors.reduce((s, d) => s + dist(d.a, d.b), 0);
  const steps = map.fixtures.filter((f) => f.kind === 'step');
  const removalSqft =
    map.oldCoating === 'all' ? sqft : map.oldCoating === 'none' ? 0 : map.oldCoating.reduce((s, a) => s + polygonArea(a), 0);
  return {
    sqft: r1(sqft),
    crackFeet: r1(map.cracks.reduce((s, c) => s + polylineLength(c), 0)),
    removalSqft: r1(Math.min(removalSqft, sqft)),
    stemWallFeet: r1(map.stemWalls.reduce((s, w) => s + dist(w.a, w.b), 0)),
    steps: steps.length,
    spalledSqft: r1(map.spalls.reduce((s, a) => s + polygonArea(a), 0)),
    outlineSqft: r1(outlineSqft),
    excludedSqft: r1(excludedSqft),
    edgeFeet: r1(Math.max(0, perimeter(map.outline) - doorFeet)),
    doorFeet: r1(doorFeet),
    stepFeet: r1(steps.reduce((s, f) => s + (f.width ?? 0), 0)),
    futureSqft: r1(map.future.reduce((s, f) => s + polygonArea(f.outline), 0)),
  };
}
