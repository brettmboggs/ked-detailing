/*
 * QR codes for the Marketing tab: byte mode, versions 1-40, with the best
 * mask picked by the standard penalty rules. Draws SVG (for print) and PNG.
 *
 * The encoder follows the structure of Project Nayuki's QR Code generator
 * library (https://www.nayuki.io/page/qr-code-generator-library), trimmed to
 * byte mode.
 *
 * Copyright (c) Project Nayuki. (MIT License)
 * https://www.nayuki.io/page/qr-code-generator-library
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 * - The above copyright notice and this permission notice shall be included in
 *   all copies or substantial portions of the Software.
 * - The Software is provided "as is", without warranty of any kind, express or
 *   implied, including but not limited to the warranties of merchantability,
 *   fitness for a particular purpose and noninfringement. In no event shall the
 *   authors or copyright holders be liable for any claim, damages or other
 *   liability, whether in an action of contract, tort or otherwise, arising from,
 *   out of or in connection with the Software or the use or other dealings in the
 *   Software.
 */

/** Error correction: how much of the code can be scratched off and still scan. */
export type Ecl = 'L' | 'M' | 'Q' | 'H';

const ECL_ORDER: Ecl[] = ['L', 'M', 'Q', 'H'];
const FORMAT_BITS: Record<Ecl, number> = { L: 1, M: 0, Q: 3, H: 2 };

// Index 0 is padding; versions 1-40 follow.
const ECC_PER_BLOCK: Record<Ecl, number[]> = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};
const BLOCKS: Record<Ecl, number[]> = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};

const bit = (x: number, i: number) => ((x >>> i) & 1) !== 0;

function rawModules(ver: number) {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

const dataCodewords = (ver: number, ecl: Ecl) => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ecl][ver]! * BLOCKS[ecl][ver]!;

/* Reed-Solomon over GF(2^8), polynomial 0x11D. */
function gfMul(x: number, y: number) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree: number) {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMul(result[j]!, root);
      if (j + 1 < result.length) result[j]! ^= result[j + 1]!;
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

function rsRemainder(data: number[], divisor: number[]) {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift()!;
    result.push(0);
    divisor.forEach((coef, i) => (result[i]! ^= gfMul(coef, factor)));
  }
  return result;
}

/** A finished code: `modules[y][x]` is true for a dark square. */
export interface Qr {
  version: number;
  size: number;
  ecl: Ecl;
  mask: number;
  modules: boolean[][];
}

/**
 * Encodes text (UTF-8, byte mode) in the smallest version that fits at `ecl`,
 * raising the error correction for free when there's room. `mask` -1 picks
 * the best; `version` forces one (tests).
 */
export function encode(text: string, ecl: Ecl = 'M', opts: { mask?: number; version?: number; boost?: boolean } = {}): Qr {
  const bytes = [...new TextEncoder().encode(text)];
  let version = opts.version ?? 1;
  const bitsFor = (v: number) => 4 + (v <= 9 ? 8 : 16) + bytes.length * 8;
  for (; ; version++) {
    if (version > 40) throw new Error('Too long for a QR code.');
    if (bitsFor(version) <= dataCodewords(version, ecl) * 8) break;
    if (opts.version) throw new Error('Too long for that version.');
  }
  if (opts.boost !== false) {
    for (const e of ECL_ORDER.slice(ECL_ORDER.indexOf(ecl) + 1)) if (bitsFor(version) <= dataCodewords(version, e) * 8) ecl = e;
  }

  // Mode, length, data, terminator, pad to a byte, then alternating pad bytes.
  const bb: number[] = [];
  const append = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bb.push((val >>> i) & 1);
  };
  const capacity = dataCodewords(version, ecl) * 8;
  append(0x4, 4);
  append(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) append(b, 8);
  append(0, Math.min(4, capacity - bb.length));
  append(0, (8 - (bb.length % 8)) % 8);
  for (let pad = 0xec; bb.length < capacity; pad ^= 0xec ^ 0x11) append(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bb.length; i += 8) data.push(bb.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  return build(version, ecl, data, opts.mask ?? -1);
}

function build(version: number, ecl: Ecl, data: number[], forcedMask: number): Qr {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fixed = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, dark: boolean) => {
    modules[y]![x] = dark;
    fixed[y]![x] = true;
  };

  /* Function patterns. */
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
      }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);

  const align: number[] = [];
  if (version > 1) {
    const n = Math.floor(version / 7) + 2;
    const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (n * 2 - 2)) * 2;
    align.push(6);
    for (let pos = size - 7; align.length < n; pos -= step) align.splice(1, 0, pos);
  }
  align.forEach((ay, i) =>
    align.forEach((ax, j) => {
      const corner = (i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0);
      if (corner) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }),
  );

  const drawFormat = (mask: number) => {
    const d = (FORMAT_BITS[ecl] << 3) | mask;
    let rem = d;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((d << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) set(8, i, bit(bits, i));
    set(8, 7, bit(bits, 6));
    set(8, 8, bit(bits, 7));
    set(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(bits, i));
    set(8, size - 8, true);
  };
  drawFormat(0);

  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, bit(bits, i));
      set(b, a, bit(bits, i));
    }
  }

  /* Error correction, interleaved. */
  const numBlocks = BLOCKS[ecl][version]!;
  const eccLen = ECC_PER_BLOCK[ecl][version]!;
  const raw = Math.floor(rawModules(version) / 8);
  const shortBlocks = numBlocks - (raw % numBlocks);
  const shortLen = Math.floor(raw / numBlocks);
  const divisor = rsDivisor(eccLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < shortBlocks ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, divisor);
    if (i < shortBlocks) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const all: number[] = [];
  for (let i = 0; i < blocks[0]!.length; i++)
    blocks.forEach((b, j) => {
      if (i !== shortLen - eccLen || j >= shortBlocks) all.push(b[i]!);
    });

  /* Zigzag the codewords in. */
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!fixed[y]![x] && i < all.length * 8) {
          modules[y]![x] = bit(all[i >>> 3]!, 7 - (i & 7));
          i++;
        }
      }
  }

  const applyMask = (mask: number) => {
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        if (fixed[y]![x]) continue;
        const flip = [
          (x + y) % 2 === 0,
          y % 2 === 0,
          x % 3 === 0,
          (x + y) % 3 === 0,
          (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
          ((x * y) % 2) + ((x * y) % 3) === 0,
          (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
          (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
        ][mask];
        if (flip) modules[y]![x] = !modules[y]![x];
      }
  };

  let mask = forcedMask;
  if (mask < 0) {
    let best = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMask(m);
      drawFormat(m);
      const p = penalty(modules);
      if (p < best) {
        best = p;
        mask = m;
      }
      applyMask(m); // XOR again undoes it
    }
  }
  applyMask(mask);
  drawFormat(mask);
  return { version, size, ecl, mask, modules };
}

/** The spec's four penalty rules: long runs, 2x2 blocks, finder look-alikes, dark balance. */
function penalty(m: boolean[][]) {
  const size = m.length;
  let score = 0;
  const lines = (get: (a: number, b: number) => boolean) => {
    for (let a = 0; a < size; a++) {
      let run = 1;
      for (let b = 1; b <= size; b++) {
        if (b < size && get(a, b) === get(a, b - 1)) run++;
        else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
      for (let b = 0; b + 11 <= size; b++) {
        const w = Array.from({ length: 11 }, (_, k) => get(a, b + k));
        const core = w[0] && !w[1] && w[2] && w[3] && w[4] && !w[5] && w[6];
        const coreLate = w[4] && !w[5] && w[6] && w[7] && w[8] && !w[9] && w[10];
        if ((core && !w[7] && !w[8] && !w[9] && !w[10]) || (coreLate && !w[0] && !w[1] && !w[2] && !w[3])) score += 40;
      }
    }
  };
  lines((y, x) => m[y]![x]!);
  lines((x, y) => m[y]![x]!);
  let dark = 0;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      if (m[y]![x]) dark++;
      if (x + 1 < size && y + 1 < size) {
        const c = m[y]![x];
        if (c === m[y]![x + 1] && c === m[y + 1]![x] && c === m[y + 1]![x + 1]) score += 3;
      }
    }
  const total = size * size;
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return score;
}

/* ------------------------------------------------------------ drawing */

const QUIET = 4;
const SVG = 'http://www.w3.org/2000/svg';

/** SVG path data for the dark squares, one run per row segment. */
function pathData(qr: Qr) {
  let d = '';
  qr.modules.forEach((row, y) => {
    for (let x = 0; x < qr.size; x++) {
      if (!row[x]) continue;
      let run = 1;
      while (x + run < qr.size && row[x + run]) run++;
      d += `M${x + QUIET} ${y + QUIET}h${run}v1h-${run}z`;
      x += run - 1;
    }
  });
  return d;
}

/** The code as an <svg> element (for the page), black on white with the quiet zone. */
export function qrSvg(qr: Qr, px = 220, label = 'QR code') {
  const n = qr.size + QUIET * 2;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${n} ${n}`);
  svg.setAttribute('width', String(px));
  svg.setAttribute('height', String(px));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  svg.setAttribute('shape-rendering', 'crispEdges');
  const bg = document.createElementNS(SVG, 'rect');
  bg.setAttribute('width', String(n));
  bg.setAttribute('height', String(n));
  bg.setAttribute('fill', '#ffffff');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', pathData(qr));
  path.setAttribute('fill', '#000000');
  svg.append(bg, path);
  return svg;
}

/** A standalone SVG file, sized in inches for print. */
export function qrSvgFile(qr: Qr, inches = 2) {
  const n = qr.size + QUIET * 2;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="${SVG}" viewBox="0 0 ${n} ${n}" width="${inches}in" height="${inches}in" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${pathData(qr)}" fill="#000"/></svg>
`;
}

/** A PNG, whole pixels per square, at least `minPx` wide. */
export function qrPng(qr: Qr, minPx = 1200): Promise<Blob> {
  const n = qr.size + QUIET * 2;
  const scale = Math.max(1, Math.ceil(minPx / n));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = n * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  qr.modules.forEach((row, y) => row.forEach((dark, x) => dark && ctx.fillRect((x + QUIET) * scale, (y + QUIET) * scale, scale, scale)));
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make the picture.'))), 'image/png'));
}

/** Saves a Blob or text as a file. */
export function download(name: string, content: Blob | string, type = 'image/svg+xml') {
  const blob = typeof content === 'string' ? new Blob([content], { type }) : content;
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
