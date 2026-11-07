/**
 * The floor quote as a real PDF (ked-coatings D19): who it's for, a drawing
 * of their floor, what was measured, every line with the owner's changes,
 * and the total. Made in the browser with pdf-lib, loaded only when someone
 * asks for a PDF, so it costs nothing to run.
 *
 * The business's name, site and legal name come from src/data/site.ts
 * (the floors business is `business.sister` until the two businesses split,
 * D18), never typed here.
 */
import { formatFeet, planToMap, measureFloorMap, wall, alongWall, doorSpan, wallLength, type EditedFloorQuote, type FloorPlan, type Pt } from '@ked/pricing';
import { business } from '../../data/site';

export interface QuoteDoc {
  quoteNo: string;
  date: Date;
  customer: { name: string; address: string; phone: string; email: string };
  plan: FloorPlan;
  quote: EditedFloorQuote;
  moisture: 'untested' | 'passed' | 'failed';
  /** What the primer would add, for an untested slab. Cents. */
  primerIfFailed: number;
  note: string;
}

// Helvetica's character set has no prime marks or curly quotes.
const plain = (t: string) =>
  t
    .replace(/′/g, "'")
    .replace(/″/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E -ÿ–—•…×·]/g, '');

const money = (c: number) => {
  const neg = c < 0;
  const v = Math.abs(c) / 100;
  const s = v.toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
  return `${neg ? '–' : ''}$${s}`;
};

export async function quotePdf(d: QuoteDoc): Promise<Blob> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  const name = business.sister.name;
  pdf.setTitle(plain(`${name} quote ${d.quoteNo}`));
  pdf.setAuthor(plain(name));
  const page = pdf.addPage([612, 792]); // US Letter
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.07, 0.07, 0.07);
  const grey = rgb(0.42, 0.41, 0.39);
  const rule = rgb(0.85, 0.84, 0.82);
  const gold = rgb(0.66, 0.54, 0.25);
  const M = 48;
  const W = 612 - 2 * M;

  const text = (t: string, x: number, y: number, size = 10, f = font, color = ink) => page.drawText(plain(t), { x, y, size, font: f, color });
  const right = (t: string, xr: number, y: number, size = 10, f = font, color = ink) => {
    const s = plain(t);
    page.drawText(s, { x: xr - f.widthOfTextAtSize(s, size), y, size, font: f, color });
  };
  const wrap = (t: string, x: number, y: number, width: number, size = 10, f = font, color = ink, lead = 13) => {
    let line = '';
    for (const word of plain(t).split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (f.widthOfTextAtSize(next, size) > width && line) {
        text(line, x, y, size, f, color);
        y -= lead;
        line = word;
      } else line = next;
    }
    if (line) text(line, x, y, size, f, color);
    return y - lead;
  };
  const hr = (y: number) => page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.75, color: rule });

  // Header.
  let y = 792 - M;
  text(name, M, y - 18, 22, bold);
  text(`${business.sister.what} · ${business.sister.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}`, M, y - 34, 10, font, grey);
  right('QUOTE', M + W, y - 16, 16, bold, gold);
  right(`No. ${d.quoteNo}`, M + W, y - 31, 10, font, grey);
  right(d.date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }), M + W, y - 44, 10, font, grey);
  y -= 60;
  hr(y);

  // Customer.
  y -= 22;
  text('FOR', M, y, 8, bold, grey);
  const c = d.customer;
  let cy = y - 15;
  for (const [t, f] of [[c.name, bold], [c.address, font], [[c.phone, c.email].filter(Boolean).join('  ·  '), font]] as const) {
    if (!t) continue;
    text(t, M, cy, 11, f);
    cy -= 15;
  }
  y = Math.min(cy, y - 15) - 10;

  // The floor, drawn to scale, with its measurements beside it.
  const boxW = 300;
  const boxH = 230;
  const top = y;
  drawFloor(page, d.plan, M, top - boxH, boxW, boxH, { font, bold, ink, grey, gold, rgb });
  const m = measureFloorMap(planToMap(d.plan));
  const mx = M + boxW + 28;
  let my = top - 4;
  text('WHAT WE MEASURED', mx, my, 8, bold, grey);
  my -= 18;
  const rows: [string, string][] = [
    ['Floor', `${Math.round(m.sqft)} sq ft`],
    ['Cracks', m.crackFeet ? formatFeet(m.crackFeet) : 'None'],
    ['Raised curb', m.stemWallFeet ? formatFeet(m.stemWallFeet) : 'None'],
    ['Steps', String(m.steps ?? 0)],
    ['Damaged concrete', m.spalledSqft ? `${Math.round(m.spalledSqft)} sq ft` : 'None'],
    ['Old coating to remove', m.removalSqft ? `${Math.round(m.removalSqft)} sq ft` : 'None'],
    ['Moisture test', d.moisture === 'passed' ? 'Passed' : d.moisture === 'failed' ? 'Failed: primer included' : 'Not done yet'],
  ];
  for (const [k, v] of rows) {
    text(k, mx, my, 10, font, grey);
    right(v, M + W, my, 10, font);
    my -= 16;
  }
  y = Math.min(top - boxH, my) - 24;
  hr(y);

  // Lines.
  y -= 20;
  text('THE WORK', M, y, 8, bold, grey);
  right('PRICE', M + W, y, 8, bold, grey);
  y -= 18;
  for (const l of d.quote.lines) {
    const before = y;
    y = wrap(l.label, M, y, W - 110, 11);
    right(money(l.amount), M + W, before, 11);
    y -= 4;
    page.drawLine({ start: { x: M, y: y + 8 }, end: { x: M + W, y: y + 8 }, thickness: 0.5, color: rule });
  }
  y -= 8;
  text('Total', M, y, 13, bold);
  right(money(d.quote.total), M + W, y, 16, bold);
  y -= 26;

  if (d.moisture === 'untested' && d.primerIfFailed > 0) {
    y = wrap(`The slab still needs its moisture test. If it fails, a moisture-blocking primer adds ${money(d.primerIfFailed)}.`, M, y, W, 10, font, grey);
    y -= 6;
  }
  if (d.note.trim()) {
    text('NOTE', M, y, 8, bold, grey);
    y = wrap(d.note.trim(), M, y - 15, W, 10.5);
  }

  // Footer.
  page.drawLine({ start: { x: M, y: M + 18 }, end: { x: M + W, y: M + 18 }, thickness: 0.5, color: rule });
  text(`${name} is a trade name of ${business.legalName}.`, M, M + 4, 8.5, font, grey);
  right(business.sister.url.replace(/^https?:\/\//, '').replace(/\/$/, ''), M + W, M + 4, 8.5, font, grey);

  const bytes = await pdf.save();
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}

type Kit = {
  font: import('pdf-lib').PDFFont;
  bold: import('pdf-lib').PDFFont;
  ink: import('pdf-lib').RGB;
  grey: import('pdf-lib').RGB;
  gold: import('pdf-lib').RGB;
  rgb: typeof import('pdf-lib').rgb;
};

/** The plan inside a box: walls, doors, curb, cracks, damage, things on the floor, and wall lengths. */
function drawFloor(page: import('pdf-lib').PDFPage, plan: FloorPlan, x0: number, y0: number, w: number, h: number, k: Kit) {
  const o = plan.outline;
  if (o.length < 3) return;
  const xs = o.map((p) => p[0]);
  const ys = o.map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const pad = 22;
  const s = Math.min((w - 2 * pad) / Math.max(1, maxX - minX), (h - 2 * pad) / Math.max(1, maxY - minY));
  const ox = x0 + (w - (maxX - minX) * s) / 2 - minX * s;
  const oy = y0 + (h - (maxY - minY) * s) / 2 - minY * s;
  const P = ([x, y]: Pt) => ({ x: ox + x * s, y: oy + y * s });
  const path = (pts: Pt[], close = true) => {
    const [first, ...rest] = pts.map(P);
    return `M ${first!.x} ${-first!.y} ` + rest.map((p) => `L ${p.x} ${-p.y}`).join(' ') + (close ? ' Z' : '');
  };
  // drawSvgPath measures y downward from the given origin; draw from (0, 0) with negated y.
  const svg = (d: string, opts: Record<string, unknown>) => page.drawSvgPath(d, { x: 0, y: 0, ...opts });

  svg(path(o), { color: k.rgb(0.96, 0.95, 0.93), borderWidth: 0 });
  for (const a of plan.spalls) svg(path(a), { color: k.rgb(1, 0.85, 0.7), borderColor: k.rgb(0.85, 0.45, 0.15), borderWidth: 0.8 });
  for (const a of plan.excluded) svg(path(a), { color: k.rgb(0.88, 0.88, 0.88), borderColor: k.grey, borderWidth: 0.8, borderDashArray: [3, 2] });
  if (Array.isArray(plan.oldCoating)) for (const a of plan.oldCoating) svg(path(a), { color: k.rgb(0.85, 0.92, 1), borderColor: k.rgb(0.3, 0.55, 0.85), borderWidth: 0.8 });

  // Curb: a heavier line just inside the wall.
  const cx = xs.reduce((a, b) => a + b, 0) / o.length;
  const cy = ys.reduce((a, b) => a + b, 0) / o.length;
  for (const i of plan.stemWalls) {
    const { a, b } = wall(plan, i);
    const [A, B] = [P(a), P(b)];
    const L = Math.hypot(B.x - A.x, B.y - A.y) || 1;
    let [nx, ny] = [-(B.y - A.y) / L, (B.x - A.x) / L];
    const C = P([cx, cy]);
    if ((C.x - (A.x + B.x) / 2) * nx + (C.y - (A.y + B.y) / 2) * ny < 0) [nx, ny] = [-nx, -ny];
    page.drawLine({ start: { x: A.x + nx * 2.5, y: A.y + ny * 2.5 }, end: { x: B.x + nx * 2.5, y: B.y + ny * 2.5 }, thickness: 3, color: k.gold, opacity: 0.8 });
  }
  svg(path(o), { borderColor: k.ink, borderWidth: 1.6 });
  for (const d of plan.doors) {
    const { from, to } = doorSpan(plan, d);
    const [A, B] = [P(alongWall(plan, d.wall, from)), P(alongWall(plan, d.wall, to))];
    page.drawLine({ start: A, end: B, thickness: 3, color: k.rgb(1, 1, 1) });
    page.drawLine({ start: A, end: B, thickness: 1.2, color: k.gold, dashArray: [4, 3] });
  }
  for (const c of plan.cracks) svg(path(c, false), { borderColor: k.rgb(0.85, 0.3, 0.2), borderWidth: 1.2 });
  for (const f of plan.fixtures) {
    const q = P(f.at);
    page.drawCircle({ x: q.x, y: q.y, size: 3.2, color: k.ink });
  }
  // Wall lengths outside each wall.
  const C = P([cx, cy]);
  for (let i = 0; i < o.length; i++) {
    const { a, b } = wall(plan, i);
    const m = P([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    const dx = m.x - C.x;
    const dy = m.y - C.y;
    const L = Math.hypot(dx, dy) || 1;
    const t = plain(formatFeet(wallLength(plan, i)));
    const tw = k.font.widthOfTextAtSize(t, 8);
    page.drawText(t, { x: m.x + (dx / L) * 11 - tw / 2, y: m.y + (dy / L) * 11 - 3, size: 8, font: k.font, color: k.grey });
  }
}
