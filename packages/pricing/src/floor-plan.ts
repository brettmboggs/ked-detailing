/**
 * The floor map as it's edited (ked-coatings DECISIONS D19). A `FloorMap`
 * (floor-map.ts) is what gets measured and priced; a `FloorPlan` is what the
 * editor holds: doors and stem walls belong to a wall of the outline, so
 * they follow it when a corner moves or a wall's length is typed in.
 * `planToMap` turns a plan into the map.
 *
 * The web admin's mapper uses these today and the app will use the same
 * rules, so a floor drawn on either measures the same.
 *
 * Feet throughout. Wall i runs from corner i to corner i + 1 (wrapping).
 */
import type { FloorFixture, FloorMap, Pt, Segment } from './floor-map.ts';
import { pointInPolygon, polygonArea, selfIntersects } from './floor-map.ts';

export interface DoorOnWall {
  wall: number;
  /** Feet from the wall's start corner to the middle of the door. */
  at: number;
  width: number;
}

export interface FloorPlan {
  version: 1;
  outline: Pt[];
  doors: DoorOnWall[];
  /** Walls with a raised concrete curb to coat. The curb stops at doors. */
  stemWalls: number[];
  cracks: Pt[][];
  spalls: Pt[][];
  oldCoating: 'none' | 'all' | Pt[][];
  excluded: Pt[][];
  fixtures: FloorFixture[];
}

export const emptyPlan = (): FloorPlan => ({
  version: 1,
  outline: [],
  doors: [],
  stemWalls: [],
  cracks: [],
  spalls: [],
  oldCoating: 'none',
  excluded: [],
  fixtures: [],
});

/** The usual start: a rectangle with the garage door wall along y = 0. */
export function rectanglePlan(width: number, depth: number): FloorPlan {
  return { ...emptyPlan(), outline: [[0, 0], [width, 0], [width, depth], [0, depth]] };
}

/** An L: the rectangle plus a bump-out at the back right. */
export function lPlan(width: number, depth: number, bumpWidth: number, bumpDepth: number): FloorPlan {
  const bx = width - bumpWidth;
  return {
    ...emptyPlan(),
    outline: [[0, 0], [width, 0], [width, depth + bumpDepth], [bx, depth + bumpDepth], [bx, depth], [0, depth]],
  };
}

/* -------------------------------------------------------------- geometry */

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const mul = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k];
const len = (a: Pt) => Math.hypot(a[0], a[1]);
const round = (v: number, step: number) => Math.round(v / step) * step;

export function wall(plan: FloorPlan, i: number): Segment {
  const n = plan.outline.length;
  return { a: plan.outline[i]!, b: plan.outline[(i + 1) % n]! };
}

export function wallLength(plan: FloorPlan, i: number): number {
  const { a, b } = wall(plan, i);
  return len(sub(b, a));
}

/** The point `at` feet along wall i from its start. */
export function alongWall(plan: FloorPlan, i: number, at: number): Pt {
  const { a, b } = wall(plan, i);
  const L = len(sub(b, a)) || 1;
  return add(a, mul(sub(b, a), at / L));
}

/** Closest point on a segment, and how far along it is (feet). */
export function project(p: Pt, a: Pt, b: Pt): { pt: Pt; at: number; dist: number } {
  const ab = sub(b, a);
  const L2 = ab[0] ** 2 + ab[1] ** 2;
  const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / L2)) : 0;
  const pt = add(a, mul(ab, t));
  return { pt, at: t * Math.sqrt(L2), dist: len(sub(p, pt)) };
}

/** The wall nearest a point. */
export function nearestWall(plan: FloorPlan, p: Pt): { wall: number; at: number; dist: number; pt: Pt } {
  let best = { wall: -1, at: 0, dist: Infinity, pt: p as Pt };
  for (let i = 0; i < plan.outline.length; i++) {
    const { a, b } = wall(plan, i);
    const r = project(p, a, b);
    if (r.dist < best.dist) best = { wall: i, ...r };
  }
  return best;
}

/** The point itself if it's on the floor, else the nearest point on a wall. */
export function keepInside(plan: FloorPlan, p: Pt): Pt {
  if (plan.outline.length < 3 || pointInPolygon(p, plan.outline)) return p;
  return nearestWall(plan, p).pt;
}

/** Ramer–Douglas–Peucker: drop points that don't change the line by more than `tol` feet. */
export function simplify(points: Pt[], tol: number): Pt[] {
  if (points.length < 3) return points.slice();
  const [a, b] = [points[0]!, points[points.length - 1]!];
  let worst = 0;
  let at = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = project(points[i]!, a, b).dist;
    if (d > worst) [worst, at] = [d, i];
  }
  if (worst <= tol) return [a, b];
  return [...simplify(points.slice(0, at + 1), tol).slice(0, -1), ...simplify(points.slice(at), tol)];
}

/** Convex hull (monotone chain), for a circled area whose line crossed itself. */
export function convexHull(points: Pt[]): Pt[] {
  const p = [...points].sort((u, v) => u[0] - v[0] || u[1] - v[1]);
  if (p.length < 3) return p;
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Pt[] = [];
  for (const q of p.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/**
 * A hand-drawn loop around an area, made usable: kept on the floor,
 * smoothed, and turned into its outline if the line crossed itself.
 * Null when it's too small to mean anything.
 */
export function areaFromStroke(plan: FloorPlan, stroke: Pt[], tol = 0.2): Pt[] | null {
  let pts = simplify(stroke.map((p) => keepInside(plan, p)), tol);
  if (pts.length > 3 && len(sub(pts[0]!, pts[pts.length - 1]!)) < 0.5) pts = pts.slice(0, -1);
  if (pts.length < 3) return null;
  if (selfIntersects(pts)) pts = convexHull(pts);
  return polygonArea(pts) >= 0.25 ? pts : null;
}

/** A hand-drawn crack, kept on the floor and smoothed. Null when it's a tap, not a line. */
export function lineFromStroke(plan: FloorPlan, stroke: Pt[], tol = 0.15): Pt[] | null {
  const pts = simplify(stroke.map((p) => keepInside(plan, p)), tol);
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += len(sub(pts[i]!, pts[i - 1]!));
  return L >= 0.5 ? pts : null;
}

/* ------------------------------------------------------------ editing */

const clone = (plan: FloorPlan): FloorPlan => structuredClone(plan);

/** Move a corner, snapped to `step` feet and squared up with its neighbours when close. */
export function moveCorner(plan: FloorPlan, i: number, to: Pt, step = 0.25, square = 0.5): FloorPlan {
  const out = clone(plan);
  const n = out.outline.length;
  let [x, y] = [round(to[0], step), round(to[1], step)];
  for (const j of [(i + n - 1) % n, (i + 1) % n]) {
    const q = out.outline[j]!;
    if (Math.abs(x - q[0]) < square) x = q[0];
    if (Math.abs(y - q[1]) < square) y = q[1];
  }
  out.outline[i] = [x, y];
  return out;
}

/** Put a new corner on wall i (for an L or a notch). Doors and stem walls stay where they are. */
export function insertCorner(plan: FloorPlan, i: number, at: Pt): FloorPlan {
  const out = clone(plan);
  const { a, b } = wall(plan, i);
  const r = project(at, a, b);
  out.outline.splice(i + 1, 0, r.pt);
  out.doors = out.doors.map((d) => {
    if (d.wall > i) return { ...d, wall: d.wall + 1 };
    if (d.wall === i && d.at > r.at) return { ...d, wall: i + 1, at: d.at - r.at };
    return d;
  });
  out.stemWalls = [...new Set(out.stemWalls.flatMap((w) => (w > i ? [w + 1] : w === i ? [i, i + 1] : [w])))].sort((p, q) => p - q);
  return out;
}

/** Take a corner out; its two walls become one. Needs four corners to stay a floor. */
export function removeCorner(plan: FloorPlan, i: number): FloorPlan {
  const n = plan.outline.length;
  if (n <= 3) return plan;
  const out = clone(plan);
  const before = (i + n - 1) % n; // the wall ending at corner i
  const lenBefore = wallLength(plan, before);
  out.outline.splice(i, 1);
  const m = n - 1;
  // Walls after i shift down by one; wall i (starting at the removed corner) joins `before`.
  const remap = (w: number) => (w === i ? (before > i ? before - 1 : before) : w > i ? w - 1 : w) % m;
  out.doors = plan.doors.map((d) => ({ ...d, wall: remap(d.wall), at: d.wall === i ? d.at + lenBefore : d.at }));
  out.stemWalls = [...new Set(plan.stemWalls.map(remap))].sort((p, q) => p - q);
  return out;
}

/**
 * Make wall i exactly `feet` long by moving its end corner along the wall.
 * When the next wall is square to this one, its far corner moves too, so a
 * rectangle stays a rectangle.
 */
export function setWallLength(plan: FloorPlan, i: number, feet: number): FloorPlan {
  if (!(feet > 0)) return plan;
  const out = clone(plan);
  const n = out.outline.length;
  const { a, b } = wall(plan, i);
  const dir = sub(b, a);
  const L = len(dir);
  if (!L) return plan;
  const delta = mul(dir, (feet - L) / L);
  const j = (i + 1) % n;
  const k = (i + 2) % n;
  out.outline[j] = add(b, delta);
  const next = sub(plan.outline[k]!, b);
  const square = Math.abs(dir[0] * next[0] + dir[1] * next[1]) < 1e-6 * L * (len(next) || 1);
  if (square && k !== i) out.outline[k] = add(plan.outline[k]!, delta);
  return out;
}

export function toggleStemWall(plan: FloorPlan, i: number): FloorPlan {
  const out = clone(plan);
  out.stemWalls = out.stemWalls.includes(i) ? out.stemWalls.filter((w) => w !== i) : [...out.stemWalls, i].sort((p, q) => p - q);
  return out;
}

/** The door's ends on its wall, kept within the wall. */
export function doorSpan(plan: FloorPlan, d: DoorOnWall): { from: number; to: number } {
  const L = wallLength(plan, d.wall);
  const w = Math.min(d.width, L);
  const mid = Math.max(w / 2, Math.min(L - w / 2, d.at));
  return { from: mid - w / 2, to: mid + w / 2 };
}

/* ------------------------------------------------------------ to the map */

/** The plan as a FloorMap, ready for `checkFloorMap` and `measureFloorMap`. */
export function planToMap(plan: FloorPlan): FloorMap {
  const doors: Segment[] = [];
  const cuts = new Map<number, [number, number][]>();
  for (const d of plan.doors) {
    if (d.wall < 0 || d.wall >= plan.outline.length) continue;
    const { from, to } = doorSpan(plan, d);
    doors.push({ a: alongWall(plan, d.wall, from), b: alongWall(plan, d.wall, to) });
    cuts.set(d.wall, [...(cuts.get(d.wall) ?? []), [from, to]]);
  }
  const stemWalls: Segment[] = [];
  for (const w of plan.stemWalls) {
    if (w < 0 || w >= plan.outline.length) continue;
    const L = wallLength(plan, w);
    let start = 0;
    for (const [from, to] of (cuts.get(w) ?? []).sort((p, q) => p[0] - q[0])) {
      if (from - start > 0.01) stemWalls.push({ a: alongWall(plan, w, start), b: alongWall(plan, w, from) });
      start = Math.max(start, to);
    }
    if (L - start > 0.01) stemWalls.push({ a: alongWall(plan, w, start), b: alongWall(plan, w, L) });
  }
  return {
    version: 1,
    outline: plan.outline,
    doors,
    stemWalls,
    cracks: plan.cracks,
    spalls: plan.spalls,
    oldCoating: plan.oldCoating,
    excluded: plan.excluded,
    future: [],
    fixtures: plan.fixtures,
  };
}

/* ------------------------------------------------------------ feet and inches */

/** 22.5 → "22′ 6″", rounded to the inch. */
export function formatFeet(feet: number): string {
  let ft = Math.floor(feet + 1e-9);
  let inch = Math.round((feet - ft) * 12);
  if (inch === 12) [ft, inch] = [ft + 1, 0];
  return inch ? `${ft}′ ${inch}″` : `${ft}′`;
}

/**
 * What someone types for a length: "22", "22.5", "22 6", "22'6", "22' 6\"",
 * "22ft 6in", "270in". Null when it isn't a length.
 */
export function parseFeet(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/[′’]/g, "'").replace(/[″”]/g, '"');
  if (!t) return null;
  const inchesOnly = t.match(/^(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)$/);
  if (inchesOnly) return Number(inchesOnly[1]) / 12;
  const m = t.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft|feet|foot)?\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)?)?$/);
  if (!m) return null;
  const ft = Number(m[1]);
  const inch = m[2] ? Number(m[2]) : 0;
  if (inch >= 12) return null;
  const v = ft + inch / 12;
  return v > 0 ? v : null;
}
