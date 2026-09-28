// Builds every KED logo file from one set of shapes.
// Run: node tools/brand.mjs
//
// The shapes were redrawn by hand from the approved logo (an image-generator
// render, so no vector existed). Edit the points here, never the output files.
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const BONE = '#EAE6DC';
const GOLD = '#C9A961';
const INK = '#0B0B0B';

// Full KED. Top of the letters is y=16, baseline is y=188.
const KED = {
  box: [15.7, 16, 856.3, 172],
  shapes: [
    { part: 'main', pts: [[382, 16], [290, 16], [148, 92], [110, 104], [152.3, 69], [182, 16], [112, 16], [15.7, 188], [85.7, 188], [127.7, 113], [216, 188], [323, 188], [222, 102]] },
    { part: 'main', pts: [[421, 16], [556, 16], [532, 58], [343, 58]] },
    { part: 'accent', pts: [[297, 82], [503.5, 82], [480.5, 121.5], [266, 121.5], [250, 107.5]] },
    { part: 'main', pts: [[580, 16], [836, 16], [836, 45], [872, 45], [818, 152], [756, 188], [342, 188], [295, 146], [523, 146], [535, 127], [592, 99], [623, 86], [593, 147], [740, 147], [754, 136], [796, 58], [556, 58]] },
  ],
};

// The K alone: the same K as above, with its upper arm split off in gold.
const K = {
  box: [15.7, 16, 366.3, 172],
  shapes: [
    { part: 'main', pts: [[112, 16], [182, 16], [132.5, 102], [222, 102], [319, 188], [216, 188], [127.7, 113], [85.7, 188], [15.7, 188]] },
    { part: 'accent', pts: [[290, 16], [382, 16], [241, 92], [149, 92]] },
  ],
};

const path = (pts) => 'M' + pts.map(([x, y]) => `${+x.toFixed(1)} ${+y.toFixed(1)}`).join('L') + 'Z';

/** SVG of a mark. `pad` is a fraction of the mark's height; `bg` fills the square/box. */
function svg(mark, { main, accent, pad = 0, square = false, bg } = {}) {
  let [x, y, w, h] = mark.box;
  const p = h * pad;
  x -= p; y -= p; w += 2 * p; h += 2 * p;
  if (square) { const s = Math.max(w, h); x -= (s - w) / 2; y -= (s - h) / 2; w = h = s; }
  const fills = { main, accent };
  const byFill = {};
  for (const s of mark.shapes) (byFill[fills[s.part]] ??= []).push(path(s.pts));
  const body = Object.entries(byFill).map(([f, ds]) => `<path fill="${f}" d="${ds.join('')}"/>`).join('');
  const rect = bg ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${bg}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${[x, y, w, h].map((n) => +n.toFixed(1)).join(' ')}">${rect}${body}</svg>\n`;
}

/** `opaque` drops the alpha channel, which the App Store refuses in an app icon. */
const png = (s, width, out, { opaque = false } = {}) => {
  const img = sharp(Buffer.from(s), { density: 600 }).resize({ width });
  return (opaque ? img.removeAlpha() : img).png().toFile(out);
};

/** A .ico holding one PNG, which every current browser reads. */
async function ico(s, size, out) {
  const img = await sharp(Buffer.from(s), { density: 600 }).resize(size, size).png().toBuffer();
  const head = Buffer.alloc(22);
  head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);
  head.writeUInt8(size, 6); head.writeUInt8(size, 7);
  head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12);
  head.writeUInt32LE(img.length, 14); head.writeUInt32LE(22, 18);
  writeFileSync(out, Buffer.concat([head, img]));
}

const variants = {
  '': { main: BONE, accent: GOLD }, // on dark
  '-on-light': { main: INK, accent: GOLD },
  '-white': { main: '#FFFFFF', accent: '#FFFFFF' },
  '-black': { main: '#000000', accent: '#000000' },
  '-gold': { main: GOLD, accent: GOLD },
};

// Brand kit: every mark in every color, as SVG and a large PNG, for printers and vendors.
mkdirSync('brand/png', { recursive: true });
for (const [name, mark] of [['ked', KED], ['k', K]]) {
  for (const [suffix, colors] of Object.entries(variants)) {
    const s = svg(mark, colors);
    writeFileSync(`brand/${name}${suffix}.svg`, s);
    await png(s, 3000, `brand/png/${name}${suffix}.png`);
  }
}
const appIcon = svg(K, { main: BONE, accent: GOLD, pad: 0.55, square: true, bg: INK });
writeFileSync('brand/app-icon.svg', appIcon);
await png(appIcon, 1024, 'brand/png/app-icon-1024.png', { opaque: true });
// iOS dark and tinted home screens. Dark: no background, iOS lays its own.
// Tinted: greyscale that iOS colours, the strike a step darker so it still
// reads as its own piece.
const appIconDark = svg(K, { main: BONE, accent: GOLD, pad: 0.55, square: true });
writeFileSync('brand/app-icon-dark.svg', appIconDark);
await png(appIconDark, 1024, 'brand/png/app-icon-dark-1024.png');
const appIconTinted = svg(K, { main: '#FFFFFF', accent: '#BDBDBD', pad: 0.55, square: true, bg: '#000000' });
writeFileSync('brand/app-icon-tinted.svg', appIconTinted);
await png(appIconTinted, 1024, 'brand/png/app-icon-tinted-1024.png', { opaque: true });

// Website.
writeFileSync('src/assets/logo.svg', svg(KED, { main: BONE, accent: GOLD }));
const tab = svg(K, { main: BONE, accent: GOLD, pad: 0.12, square: true, bg: INK });
writeFileSync('public/favicon.svg', tab);
await ico(tab, 32, 'public/favicon.ico');
await png(appIcon, 180, 'public/apple-touch-icon.png');
// Email and the pay/car pages: 2x of a 200px-wide logo on the dark header.
await png(svg(KED, { main: BONE, accent: GOLD }), 400, 'public/email/logo.png');

console.log('Brand files written to brand/, src/assets/logo.svg and public/.');
