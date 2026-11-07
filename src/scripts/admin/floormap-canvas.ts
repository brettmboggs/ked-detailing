/**
 * The floor mapper's drawing surface (DECISIONS D19 in ked-coatings): an
 * SVG of the plan that redraws on every change, and the touch, pen and mouse
 * handling for each step. All the geometry rules live in @ked/pricing
 * (floor-plan.ts), so the app can share them; this file only draws and
 * listens.
 *
 * One finger or the mouse does the step's job (drag a corner, draw a crack,
 * place a drain). Two fingers, or a drag on empty floor where the step
 * doesn't draw, move the view; two fingers pinch to zoom. The scroll wheel
 * is left to the page (Brett: scrolling the page mustn't zoom the drawing),
 * so on a computer the + and − buttons zoom.
 */
import {
  alongWall,
  areaFromStroke,
  doorSpan,
  formatFeet,
  insertCorner,
  keepInside,
  lineFromStroke,
  moveCorner,
  nearestWall,
  pointInPolygon,
  polygonArea,
  project,
  toggleStemWall,
  wall,
  wallLength,
  type FloorFixtureKind,
  type FloorPlan,
  type Pt,
} from '@ked/pricing';

export type StepId = 'shape' | 'doors' | 'curb' | 'cracks' | 'damage' | 'coating' | 'things' | 'uncoated' | 'price';
export type Selection =
  | { kind: 'corner'; i: number }
  | { kind: 'door'; i: number }
  | { kind: 'crack'; i: number }
  | { kind: 'spall'; i: number }
  | { kind: 'coat'; i: number }
  | { kind: 'excluded'; i: number }
  | { kind: 'fixture'; i: number }
  | null;

export interface CanvasHost {
  plan: () => FloorPlan;
  step: () => StepId;
  selection: () => Selection;
  select: (s: Selection) => void;
  /** Show a change while a finger is still down; not yet in the undo history. */
  preview: (p: FloorPlan) => void;
  /** Keep a change: `before` goes on the undo stack. */
  commit: (p: FloorPlan, before: FloorPlan) => void;
  doorWidth: () => number;
  fixtureKind: () => FloorFixtureKind;
  stepWidth: () => number;
  /** Tapped a wall's length label: ask for the exact length. */
  editWall: (i: number, at: { x: number; y: number }) => void;
}

const NS = 'http://www.w3.org/2000/svg';
const C = {
  floor: '#171716',
  grid: '#232321',
  grid5: '#2f2e2b',
  wall: '#eae6dc',
  gold: '#c9a961',
  goldHi: '#e2c98c',
  curb: '#a8893f',
  crack: '#ff7a59',
  spall: '#ff9f43',
  coat: '#6fb7ff',
  excluded: '#8f8b82',
  text: '#eae6dc',
  muted: '#8f8b82',
  ink: '#0b0b0b',
};

function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number | undefined> = {}, ...kids: (SVGElement | string)[]) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) el.setAttribute(k, String(v));
  for (const k of kids) el.append(k);
  return el;
}

const WALL_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const wallName = (i: number) => WALL_LETTERS[i % 26]!;

export function fixtureLabel(kind: FloorFixtureKind): string {
  return { drain: 'Drain', post: 'Post', 'water-heater': 'Water heater', 'outlet-120': 'Outlet 120V', 'outlet-240': 'Outlet 240V', step: 'Step', other: 'Other' }[kind];
}
const fixtureGlyph = (kind: FloorFixtureKind) =>
  ({ drain: '', post: '', 'water-heater': 'WH', 'outlet-120': '120V', 'outlet-240': '240V', step: 'Step', other: '?' })[kind];

export class FloorCanvas {
  readonly el: HTMLDivElement;
  private svg: SVGSVGElement;
  private view = { s: 20, tx: 0, ty: 0 };
  private fitted = false;
  private pointers = new Map<number, { x: number; y: number }>();
  private gesture:
    | null
    | { kind: 'pan'; x: number; y: number; moved: boolean; onTap?: () => void }
    | { kind: 'pinch'; d: number; mx: number; my: number }
    | { kind: 'drag'; before: FloorPlan; moved: boolean; x: number; y: number; move: (p: Pt) => FloorPlan; onTap?: () => void }
    | { kind: 'stroke'; pts: Pt[]; closed: boolean } = null;
  private live: SVGPolylineElement | null = null;

  constructor(private host: CanvasHost) {
    this.svg = s('svg', { class: 'fm-svg', role: 'img', 'aria-label': 'Floor map' }) as SVGSVGElement;
    this.el = document.createElement('div');
    this.el.className = 'fm-canvas relative';
    this.el.append(this.svg);
    this.svg.addEventListener('pointerdown', (e) => this.down(e));
    this.svg.addEventListener('pointermove', (e) => this.move(e));
    this.svg.addEventListener('pointerup', (e) => this.up(e));
    this.svg.addEventListener('pointercancel', (e) => this.cancel(e));
    this.svg.addEventListener('contextmenu', (e) => e.preventDefault());
    new ResizeObserver(() => {
      if (!this.fitted) this.fit();
      this.draw();
    }).observe(this.el);
  }

  /* ---------------------------------------------------------- view */

  private toScreen = ([x, y]: Pt) => ({ x: x * this.view.s + this.view.tx, y: this.view.ty - y * this.view.s });
  private toFeet(clientX: number, clientY: number): Pt {
    const r = this.svg.getBoundingClientRect();
    return [(clientX - r.left - this.view.tx) / this.view.s, (this.view.ty - (clientY - r.top)) / this.view.s];
  }
  private local(e: { clientX: number; clientY: number }) {
    const r = this.svg.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /** Frame the whole floor with room for the wall labels. */
  fit() {
    const o = this.host.plan().outline;
    const w = this.el.clientWidth;
    const h = this.el.clientHeight;
    if (!w || !h || o.length < 3) return;
    const xs = o.map((p) => p[0]);
    const ys = o.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const pad = 64;
    const sc = Math.min((w - 2 * pad) / Math.max(1, x1 - x0), (h - 2 * pad) / Math.max(1, y1 - y0));
    this.view.s = Math.max(4, Math.min(120, sc));
    this.view.tx = (w - (x1 - x0) * this.view.s) / 2 - x0 * this.view.s;
    this.view.ty = (h + (y1 - y0) * this.view.s) / 2 + y0 * this.view.s;
    this.fitted = true;
    this.draw();
  }

  private zoomAt(x: number, y: number, k: number) {
    const s0 = this.view.s;
    const s1 = Math.max(4, Math.min(160, s0 * k));
    const f = s1 / s0;
    this.view.tx = x - (x - this.view.tx) * f;
    this.view.ty = y - (y - this.view.ty) * f;
    this.view.s = s1;
    this.draw();
  }

  /** Refit only when part of the floor has gone off screen. */
  fitIfNeeded() {
    const o = this.host.plan().outline;
    const w = this.el.clientWidth;
    const h = this.el.clientHeight;
    const off = o.some((p) => {
      const q = this.toScreen(p);
      return q.x < 24 || q.y < 24 || q.x > w - 24 || q.y > h - 24;
    });
    if (off) this.fit();
  }

  zoom(k: number) {
    this.zoomAt(this.el.clientWidth / 2, this.el.clientHeight / 2, k);
  }

  /* ---------------------------------------------------------- input */

  private hit(e: PointerEvent): { kind: string; i: number; j?: number } | null {
    const t = (e.target as Element).closest('[data-k]') as SVGElement | null;
    if (!t) return null;
    return { kind: t.dataset.k!, i: Number(t.dataset.i), j: t.dataset.j !== undefined ? Number(t.dataset.j) : undefined };
  }

  /** How close, in feet, a finger needs to be to a wall to mean it. */
  private reach = () => Math.max(0.6, 26 / this.view.s);

  private down(e: PointerEvent) {
    this.svg.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, this.local(e));
    if (this.pointers.size === 2) {
      // Second finger: whatever the first one started becomes a pinch.
      if (this.gesture?.kind === 'drag' && this.gesture.moved) this.host.preview(this.gesture.before);
      this.live?.remove();
      this.live = null;
      const [a, b] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      this.gesture = { kind: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      return;
    }
    if (this.pointers.size > 2) return;
    const at = this.local(e);
    const ft = this.toFeet(e.clientX, e.clientY);
    const plan = this.host.plan();
    const step = this.host.step();
    const hit = this.hit(e);
    const pan = (onTap?: () => void) => (this.gesture = { kind: 'pan', x: at.x, y: at.y, moved: false, onTap });
    const drag = (move: (p: Pt) => FloorPlan, onTap?: () => void) =>
      (this.gesture = { kind: 'drag', before: plan, moved: false, x: at.x, y: at.y, move, onTap });
    // Right or middle button: always move the view.
    if (e.button === 1 || e.button === 2) return pan();

    if (step === 'shape') {
      if (hit?.kind === 'corner') {
        const i = hit.i;
        this.host.select({ kind: 'corner', i });
        return drag((p) => moveCorner(plan, i, p), () => this.host.select({ kind: 'corner', i }));
      }
      if (hit?.kind === 'add') {
        const added = insertCorner(plan, hit.i, alongWall(plan, hit.i, wallLength(plan, hit.i) / 2));
        const i = hit.i + 1;
        this.host.select({ kind: 'corner', i });
        return drag((p) => moveCorner(added, i, p), () => this.host.commit(added, plan));
      }
      if (hit?.kind === 'len') {
        const i = hit.i;
        return pan(() => this.host.editWall(i, at));
      }
      return pan(() => this.host.select(null));
    }

    if (step === 'doors') {
      if (hit?.kind === 'door') {
        const i = hit.i;
        const d = plan.doors[i]!;
        this.host.select({ kind: 'door', i });
        const { a, b } = wall(plan, d.wall);
        return drag((p) => {
          const next = structuredClone(plan);
          next.doors[i]!.at = Math.round(project(p, a, b).at * 4) / 4;
          return next;
        });
      }
      const near = nearestWall(plan, ft);
      if (near.wall >= 0 && near.dist <= this.reach()) {
        return pan(() => {
          const next = structuredClone(plan);
          next.doors.push({ wall: near.wall, at: Math.round(near.at * 4) / 4, width: Math.min(this.host.doorWidth(), wallLength(plan, near.wall)) });
          this.host.commit(next, plan);
          this.host.select({ kind: 'door', i: next.doors.length - 1 });
        });
      }
      return pan(() => this.host.select(null));
    }

    if (step === 'curb') {
      const near = nearestWall(plan, ft);
      if (near.wall >= 0 && near.dist <= this.reach()) return pan(() => this.host.commit(toggleStemWall(plan, near.wall), plan));
      return pan();
    }

    if (step === 'things') {
      if (hit?.kind === 'fixture') {
        const i = hit.i;
        this.host.select({ kind: 'fixture', i });
        return drag((p) => {
          const next = structuredClone(plan);
          const q = keepInside(plan, p);
          next.fixtures[i]!.at = [Math.round(q[0] * 4) / 4, Math.round(q[1] * 4) / 4];
          return next;
        });
      }
      if (pointInPolygon(ft, plan.outline) || nearestWall(plan, ft).dist <= this.reach()) {
        return pan(() => {
          const next = structuredClone(plan);
          const kind = this.host.fixtureKind();
          const q = keepInside(plan, ft);
          next.fixtures.push({ kind, at: [Math.round(q[0] * 4) / 4, Math.round(q[1] * 4) / 4], ...(kind === 'step' ? { width: this.host.stepWidth() } : {}) });
          this.host.commit(next, plan);
          this.host.select({ kind: 'fixture', i: next.fixtures.length - 1 });
        });
      }
      return pan(() => this.host.select(null));
    }

    const drawKinds: Partial<Record<StepId, { sel: string; closed: boolean }>> = {
      cracks: { sel: 'crack', closed: false },
      damage: { sel: 'spall', closed: true },
      uncoated: { sel: 'excluded', closed: true },
      coating: { sel: 'coat', closed: true },
    };
    const d = drawKinds[step];
    if (d && !(step === 'coating' && !Array.isArray(plan.oldCoating))) {
      if (hit?.kind === d.sel) {
        const i = hit.i;
        return pan(() => this.host.select({ kind: d.sel, i } as Selection));
      }
      this.host.select(null);
      this.gesture = { kind: 'stroke', pts: [ft], closed: d.closed };
      this.live = s('polyline', {
        points: `${at.x},${at.y}`,
        fill: d.closed ? 'rgba(255,159,67,0.12)' : 'none',
        stroke: step === 'cracks' ? C.crack : step === 'uncoated' ? C.excluded : step === 'coating' ? C.coat : C.spall,
        'stroke-width': 3,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'stroke-dasharray': d.closed ? '6 5' : undefined,
      }) as SVGPolylineElement;
      this.svg.append(this.live);
      return;
    }
    return pan(() => this.host.select(null));
  }

  private move(e: PointerEvent) {
    if (!this.pointers.has(e.pointerId)) return;
    const at = this.local(e);
    this.pointers.set(e.pointerId, at);
    const g = this.gesture;
    if (!g) return;
    if (g.kind === 'pinch' && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      this.view.tx += mx - g.mx;
      this.view.ty += my - g.my;
      if (g.d > 0) this.zoomAt(mx, my, d / g.d);
      [g.d, g.mx, g.my] = [d, mx, my];
      this.draw();
      return;
    }
    if (g.kind === 'pan') {
      if (!g.moved && Math.hypot(at.x - g.x, at.y - g.y) < 6) return;
      if (!g.moved) [g.moved, g.x, g.y] = [true, g.x, g.y];
      this.view.tx += at.x - g.x;
      this.view.ty += at.y - g.y;
      [g.x, g.y] = [at.x, at.y];
      this.draw();
      return;
    }
    if (g.kind === 'drag') {
      if (!g.moved && Math.hypot(at.x - g.x, at.y - g.y) < 4) return;
      g.moved = true;
      this.host.preview(g.move(this.toFeet(e.clientX, e.clientY)));
      return;
    }
    if (g.kind === 'stroke') {
      const p = this.toFeet(e.clientX, e.clientY);
      const last = g.pts[g.pts.length - 1]!;
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) * this.view.s < 3) return;
      g.pts.push(p);
      this.live?.setAttribute('points', g.pts.map((q) => this.toScreen(q)).map((q) => `${q.x},${q.y}`).join(' '));
    }
  }

  private up(e: PointerEvent) {
    this.pointers.delete(e.pointerId);
    const g = this.gesture;
    if (g?.kind === 'pinch') {
      if (this.pointers.size === 0) this.gesture = null;
      return;
    }
    this.gesture = null;
    if (!g) return;
    const plan = this.host.plan();
    if (g.kind === 'pan' && !g.moved) g.onTap?.();
    if (g.kind === 'drag') {
      if (g.moved) this.host.commit(this.host.plan(), g.before);
      else g.onTap?.();
    }
    if (g.kind === 'stroke') {
      this.live?.remove();
      this.live = null;
      const step = this.host.step();
      const next = structuredClone(plan);
      if (!g.closed) {
        const line = lineFromStroke(plan, g.pts);
        if (!line) return;
        next.cracks.push(line);
        this.host.commit(next, plan);
        this.host.select({ kind: 'crack', i: next.cracks.length - 1 });
        return;
      }
      const area = areaFromStroke(plan, g.pts);
      if (!area) return;
      if (step === 'damage') next.spalls.push(area);
      else if (step === 'uncoated') next.excluded.push(area);
      else if (Array.isArray(next.oldCoating)) next.oldCoating.push(area);
      this.host.commit(next, plan);
      const list = step === 'damage' ? next.spalls : step === 'uncoated' ? next.excluded : (next.oldCoating as Pt[][]);
      this.host.select({ kind: step === 'damage' ? 'spall' : step === 'uncoated' ? 'excluded' : 'coat', i: list.length - 1 });
    }
  }

  private cancel(e: PointerEvent) {
    this.pointers.delete(e.pointerId);
    if (this.gesture?.kind === 'drag' && this.gesture.moved) this.host.preview(this.gesture.before);
    this.live?.remove();
    this.live = null;
    this.gesture = null;
  }

  /* ---------------------------------------------------------- drawing */

  draw() {
    const plan = this.host.plan();
    const step = this.host.step();
    const sel = this.host.selection();
    const w = this.el.clientWidth;
    const h = this.el.clientHeight;
    this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    const kids: SVGElement[] = [];
    const P = this.toScreen;
    const pts = (list: Pt[]) => list.map((q) => P(q)).map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ');
    const isSel = (kind: string, i: number) => sel?.kind === kind && sel.i === i;

    // Grid, one line a foot, a stronger one every five.
    const s0 = this.view.s;
    if (s0 >= 5) {
      const [fx0, fy1] = this.toFeet(this.svg.getBoundingClientRect().left, this.svg.getBoundingClientRect().top);
      const [fx1, fy0] = [fx0 + w / s0, fy1 - h / s0];
      const g = s('g', { 'shape-rendering': 'crispEdges' });
      for (let x = Math.floor(fx0); x <= fx1; x++) {
        const sx = P([x, 0]).x;
        g.append(s('line', { x1: sx, x2: sx, y1: 0, y2: h, stroke: x % 5 ? C.grid : C.grid5, 'stroke-width': 1 }));
      }
      for (let y = Math.floor(fy0); y <= fy1; y++) {
        const sy = P([0, y]).y;
        g.append(s('line', { y1: sy, y2: sy, x1: 0, x2: w, stroke: y % 5 ? C.grid : C.grid5, 'stroke-width': 1 }));
      }
      kids.push(g);
    }

    const o = plan.outline;
    if (o.length >= 3) {
      kids.push(s('polygon', { points: pts(o), fill: C.floor, stroke: 'none' }));

      // Old coating: the whole floor, or the circled areas.
      if (plan.oldCoating === 'all') kids.push(s('polygon', { points: pts(o), fill: 'url(#fm-coat)', stroke: 'none' }));
      else if (plan.oldCoating !== 'none')
        plan.oldCoating.forEach((a, i) =>
          kids.push(s('polygon', { points: pts(a), fill: 'url(#fm-coat)', stroke: C.coat, 'stroke-width': isSel('coat', i) ? 3 : 1.5, 'data-k': 'coat', 'data-i': i })),
        );
      plan.excluded.forEach((a, i) =>
        kids.push(s('polygon', { points: pts(a), fill: 'url(#fm-out)', stroke: C.excluded, 'stroke-width': isSel('excluded', i) ? 3 : 1.5, 'stroke-dasharray': '5 4', 'data-k': 'excluded', 'data-i': i })),
      );
      plan.spalls.forEach((a, i) =>
        kids.push(s('polygon', { points: pts(a), fill: 'url(#fm-spall)', stroke: C.spall, 'stroke-width': isSel('spall', i) ? 3 : 1.5, 'data-k': 'spall', 'data-i': i })),
      );

      // Walls, with the curb drawn as a band on the inside.
      const cx = o.reduce((a, p) => a + p[0], 0) / o.length;
      const cy = o.reduce((a, p) => a + p[1], 0) / o.length;
      for (let i = 0; i < o.length; i++) {
        const { a, b } = wall(plan, i);
        const [A, B] = [P(a), P(b)];
        kids.push(s('line', { x1: A.x, y1: A.y, x2: B.x, y2: B.y, stroke: C.wall, 'stroke-width': 3, 'stroke-linecap': 'round' }));
        if (plan.stemWalls.includes(i)) {
          // inward normal in screen space
          const dx = B.x - A.x;
          const dy = B.y - A.y;
          const L = Math.hypot(dx, dy) || 1;
          const off = 5;
          let nx = -dy / L;
          let ny = dx / L;
          const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
          const c = P([cx, cy]);
          if ((c.x - mid.x) * nx + (c.y - mid.y) * ny < 0) [nx, ny] = [-nx, -ny];
          kids.push(s('line', { x1: A.x + nx * off, y1: A.y + ny * off, x2: B.x + nx * off, y2: B.y + ny * off, stroke: C.curb, 'stroke-width': 6, 'stroke-linecap': 'butt', opacity: 0.9, 'pointer-events': 'none' }));
        }
      }
      // Doors: a gap in the wall and a swing-free bar, labelled.
      plan.doors.forEach((d, i) => {
        if (d.wall >= o.length) return;
        const { from, to } = doorSpan(plan, d);
        const [A, B] = [P(alongWall(plan, d.wall, from)), P(alongWall(plan, d.wall, to))];
        const selD = isSel('door', i);
        kids.push(s('line', { x1: A.x, y1: A.y, x2: B.x, y2: B.y, stroke: C.ink, 'stroke-width': 7 }));
        kids.push(s('line', { x1: A.x, y1: A.y, x2: B.x, y2: B.y, stroke: selD ? C.goldHi : C.gold, 'stroke-width': selD ? 5 : 3, 'stroke-dasharray': '8 5' }));
        kids.push(s('line', { x1: A.x, y1: A.y, x2: B.x, y2: B.y, stroke: 'transparent', 'stroke-width': 30, 'data-k': 'door', 'data-i': i, class: step === 'doors' ? 'fm-grab' : '' }));
        const m = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
        // Inside the floor, clear of the wall's own label and the shape step's + handle.
        const out = outward(m, { x: P([cx, cy]).x, y: P([cx, cy]).y }, -56);
        kids.push(label(out.x, out.y, `Door ${formatFeet(to - from)}`, C.gold, 11));
      });

      // Cracks.
      plan.cracks.forEach((c, i) => {
        kids.push(s('polyline', { points: pts(c), fill: 'none', stroke: C.crack, 'stroke-width': isSel('crack', i) ? 4 : 2.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
        kids.push(s('polyline', { points: pts(c), fill: 'none', stroke: 'transparent', 'stroke-width': 24, 'data-k': 'crack', 'data-i': i }));
      });

      // Things on the floor.
      plan.fixtures.forEach((f, i) => {
        const q = P(f.at);
        const on = isSel('fixture', i);
        const g = s('g', { 'data-k': 'fixture', 'data-i': i, class: step === 'things' ? 'fm-grab' : '' });
        if (f.kind === 'step') {
          const half = ((f.width ?? 4) * this.view.s) / 2;
          g.append(s('rect', { x: q.x - half, y: q.y - 9, width: half * 2, height: 18, fill: '#2a2927', stroke: on ? C.goldHi : C.wall, 'stroke-width': on ? 2.5 : 1.5, rx: 2 }));
          g.append(s('text', { x: q.x, y: q.y + 4, 'text-anchor': 'middle', fill: C.text, 'font-size': 11, 'font-weight': 600 }, `Step ${formatFeet(f.width ?? 4)}`));
        } else {
          g.append(s('circle', { cx: q.x, cy: q.y, r: 22, fill: 'transparent' }));
          const ring = on ? C.goldHi : C.wall;
          const sw = on ? 2.5 : 1.5;
          if (f.kind === 'drain') {
            g.append(s('circle', { cx: q.x, cy: q.y, r: 12, fill: '#2a2927', stroke: ring, 'stroke-width': sw }));
            for (const dy of [-5, 0, 5]) g.append(s('line', { x1: q.x - 7, x2: q.x + 7, y1: q.y + dy, y2: q.y + dy, stroke: C.text, 'stroke-width': 1.5 }));
          } else if (f.kind === 'post') {
            g.append(s('rect', { x: q.x - 9, y: q.y - 9, width: 18, height: 18, fill: C.text, stroke: ring, 'stroke-width': sw }));
          } else {
            g.append(s('rect', { x: q.x - 17, y: q.y - 11, width: 34, height: 22, rx: 11, fill: '#2a2927', stroke: ring, 'stroke-width': sw }));
            g.append(s('text', { x: q.x, y: q.y + 4, 'text-anchor': 'middle', fill: C.text, 'font-size': 10, 'font-weight': 700 }, fixtureGlyph(f.kind)));
          }
        }
        kids.push(g);
      });

      // Wall letters and lengths, outside each wall.
      const ctr = P([cx, cy]);
      for (let i = 0; i < o.length; i++) {
        const { a, b } = wall(plan, i);
        const m = P([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
        const at = outward(m, ctr, 22);
        const text = `${wallName(i)}  ${formatFeet(wallLength(plan, i))}`;
        const g = label(at.x, at.y, text, step === 'shape' ? C.ink : C.text, 12, step === 'shape' ? C.gold : '#1c1c1c');
        if (step === 'shape') {
          g.setAttribute('data-k', 'len');
          g.setAttribute('data-i', String(i));
          g.setAttribute('class', 'fm-tap');
        }
        kids.push(g);
      }

      // Area in the middle.
      const area = polygonArea(o) - plan.excluded.reduce((t, a) => t + polygonArea(a), 0);
      kids.push(label(ctr.x, ctr.y, `${Math.round(area)} sq ft`, C.muted, 13, 'transparent'));

      // Shape handles: corners and "add a corner" on each wall.
      if (step === 'shape') {
        for (let i = 0; i < o.length; i++) {
          const { a, b } = wall(plan, i);
          const m = P([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
          const inward = outward(m, ctr, -28);
          const g = s('g', { 'data-k': 'add', 'data-i': i, class: 'fm-grab' });
          g.append(s('circle', { cx: inward.x, cy: inward.y, r: 18, fill: 'transparent' }));
          g.append(s('circle', { cx: inward.x, cy: inward.y, r: 9, fill: C.ink, stroke: C.gold, 'stroke-width': 1.5, 'stroke-dasharray': '2 2' }));
          g.append(s('text', { x: inward.x, y: inward.y + 4, 'text-anchor': 'middle', fill: C.gold, 'font-size': 13, 'font-weight': 700 }, '+'));
          kids.push(g);
        }
        o.forEach((p, i) => {
          const q = P(p);
          const on = isSel('corner', i);
          const g = s('g', { 'data-k': 'corner', 'data-i': i, class: 'fm-grab' });
          g.append(s('circle', { cx: q.x, cy: q.y, r: 24, fill: 'transparent' }));
          g.append(s('circle', { cx: q.x, cy: q.y, r: on ? 11 : 9, fill: on ? C.goldHi : C.gold, stroke: C.ink, 'stroke-width': 2 }));
          kids.push(g);
        });
      }
    }

    const defs = s(
      'defs',
      {},
      hatch('fm-spall', C.spall, 0.55),
      hatch('fm-out', C.excluded, 0.45),
      hatch('fm-coat', C.coat, 0.35),
    );
    this.svg.replaceChildren(defs, ...kids);
    if (this.live) this.svg.append(this.live);
  }
}

/* ------------------------------------------------------------ helpers */

/** A point `d` px from `m`, away from the centre (negative: toward it). */
function outward(m: { x: number; y: number }, c: { x: number; y: number }, d: number) {
  const dx = m.x - c.x;
  const dy = m.y - c.y;
  const L = Math.hypot(dx, dy) || 1;
  return { x: m.x + (dx / L) * d, y: m.y + (dy / L) * d };
}

function label(x: number, y: number, text: string, color: string, size: number, bg = '#1c1c1c') {
  const g = s('g', {});
  const w = text.length * size * 0.58 + 14;
  const hgt = size + 10;
  g.append(s('rect', { x: x - w / 2, y: y - hgt / 2, width: w, height: hgt, rx: 3, fill: bg }));
  g.append(s('text', { x, y: y + size * 0.36, 'text-anchor': 'middle', fill: color, 'font-size': size, 'font-weight': 700, 'font-family': 'Inter, system-ui, sans-serif' }, text));
  return g;
}

function hatch(id: string, color: string, opacity: number) {
  const p = s('pattern', { id, width: 8, height: 8, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
  p.append(s('rect', { width: 8, height: 8, fill: color, opacity: opacity * 0.25 }));
  p.append(s('line', { x1: 0, y1: 0, x2: 0, y2: 8, stroke: color, 'stroke-width': 2, opacity }));
  return p;
}
