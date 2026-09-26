// Door-jamb QR stickers, laid out on Printful's kiss-cut sticker sheets and
// sent to Jacob's Printful account as a DRAFT order. Nothing is charged here:
// he opens the draft in Printful, checks the preview, and pays with his card.
//
//   node tools/sticker-order.mjs 250                  # look first: sheets + CSV in tools/stickers/
//   node tools/sticker-order.mjs 250 --draft --ship-to=ship.json
//
// --draft needs PRINTFUL_TOKEN (Jacob's private token, scope "orders") and
// KED_TOKEN (the API's, to host the sheets where Printful can fetch them for a
// week). PRINTFUL_STORE_ID too if his token is account-wide. ship.json is
// Printful's recipient: {"name","address1","city","state_code","zip","country_code":"US"}.
// Options: --per-sheet=5 (Printful's stated limit of designs on a sheet),
// --size=1.8 (sticker width in inches; the QR is most of it).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { SITE, makeCodes } from './sticker-codes.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PRODUCT = 505; // Kiss-Cut Sticker Sheet
const PF = 'https://api.printful.com';
const API = (process.env.KED_API ?? 'https://ked-api.ked-api.workers.dev').replace(/\/$/, '');

const args = process.argv.slice(2);
const flag = (name, fallback) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const count = Number(args.find((a) => /^\d+$/.test(a)) ?? 250);
const perSheet = Number(flag('per-sheet', 5));
const inches = Number(flag('size', 1.8));
const draft = args.includes('--draft');

const INK = '#0b0d11';
const GOLD = '#e8b14c';
const BONE = '#f6f7f9';
const WORDMARK = { left: 0, top: 180, width: 1000, height: 200 };

async function printful(path, init = {}) {
  const token = process.env.PRINTFUL_TOKEN;
  if (!token) throw new Error('Set PRINTFUL_TOKEN (Printful → Settings → API → private token) to use Printful.');
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  if (process.env.PRINTFUL_STORE_ID) headers['X-PF-Store-Id'] = process.env.PRINTFUL_STORE_ID;
  const res = await fetch(`${PF}${path}`, { ...init, headers });
  const body = await res.json();
  if (!res.ok) throw new Error(`Printful ${path}: ${body.error?.message ?? body.result ?? res.status}`);
  return body.result;
}

/** The sheet's variant and print file size. From Printful when there's a token, else A5 at 300 dpi. */
async function sheetSpec() {
  if (!process.env.PRINTFUL_TOKEN) return { variantId: null, width: 1749, height: 2481, dpi: 300, source: 'A5 at 300 dpi (no PRINTFUL_TOKEN, so not checked)' };
  const { variants } = await printful(`/products/${PRODUCT}`);
  const files = await printful(`/mockup-generator/printfiles/${PRODUCT}`);
  const variant = variants[0];
  const pfId = files.variant_printfiles.find((v) => v.variant_id === variant.id)?.placements.default;
  const pf = files.printfiles.find((p) => p.printfile_id === pfId) ?? files.printfiles[0];
  return { variantId: variant.id, width: pf.width, height: pf.height, dpi: pf.dpi, source: `Printful: ${variant.name}` };
}

/** One sticker, portrait: logo, QR on a white panel, what it's for, the code. */
async function sticker(code, w, logo) {
  const pad = Math.round(w * 0.08);
  const panel = w - pad * 2;
  // Just the wordmark band of src/assets/logo.png (1000×562): the car and the
  // "mobile detailing service" line don't read at sticker size.
  const logoW = Math.round(w * 0.8);
  const logoH = Math.round((logoW * WORDMARK.height) / WORDMARK.width);
  const logoY = Math.round(w * 0.04);
  const ruleY = logoY + logoH + Math.round(w * 0.03);
  const qrY = ruleY + Math.round(w * 0.04);
  const lineY = qrY + panel + Math.round(w * 0.075);
  const codeY = lineY + Math.round(w * 0.07);
  const h = codeY + Math.round(w * 0.05);
  const qr = await QRCode.toString(`${SITE}/c/${code}`, { type: 'svg', errorCorrectionLevel: 'Q', margin: 2, color: { dark: INK, light: '#ffffff' } });
  const qrInner = qr.replace(/^[\s\S]*?<svg[^>]*viewBox="([^"]+)"[^>]*>/, (_, vb) => `<svg x="${pad}" y="${qrY}" width="${panel}" height="${panel}" viewBox="${vb}" shape-rendering="crispEdges">`);
  const logoPng = (await sharp(logo).extract(WORDMARK).resize(logoW, logoH).png().toBuffer()).toString('base64');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <rect width="${w}" height="${h}" rx="${Math.round(w * 0.01)}" fill="${INK}"/>
  <image href="data:image/png;base64,${logoPng}" x="${(w - logoW) / 2}" y="${logoY}" width="${logoW}" height="${logoH}"/>
  <rect x="${pad}" y="${ruleY}" width="${panel}" height="${Math.max(2, Math.round(w * 0.004))}" fill="${GOLD}"/>
  ${qrInner}
  <text x="${w / 2}" y="${lineY}" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="${Math.round(w * 0.05)}" letter-spacing="${w * 0.004}" fill="${BONE}">SCAN FOR THIS CAR'S DETAILS</text>
  <text x="${w / 2}" y="${codeY}" text-anchor="middle" font-family="monospace" font-size="${Math.round(w * 0.045)}" letter-spacing="${w * 0.01}" fill="${GOLD}">${code}</text>
</svg>`;
  return { png: await sharp(Buffer.from(svg)).png().toBuffer(), h };
}

/** Stickers in a centred grid on a transparent sheet, so each is cut on its own. */
async function sheet(codes, spec, logo) {
  const w = Math.round(inches * spec.dpi);
  const gap = Math.round(0.3 * spec.dpi); // clear of the cut border
  const first = await sticker(codes[0], w, logo);
  const cols = Math.max(1, Math.floor((spec.width + gap) / (w + gap)));
  const rows = Math.ceil(codes.length / cols);
  const gridW = cols * w + (cols - 1) * gap;
  const gridH = rows * first.h + (rows - 1) * gap;
  if (gridW > spec.width || gridH > spec.height) throw new Error(`${codes.length} stickers at ${inches}" don't fit the sheet. Try --size or --per-sheet smaller.`);
  const left = Math.round((spec.width - gridW) / 2);
  const top = Math.round((spec.height - gridH) / 2);
  const parts = [];
  for (const [i, code] of codes.entries()) {
    const { png } = i === 0 ? first : await sticker(code, w, logo);
    parts.push({ input: png, left: left + (i % cols) * (w + gap), top: top + Math.floor(i / cols) * (first.h + gap) });
  }
  return sharp({ create: { width: spec.width, height: spec.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(parts)
    .png()
    .toBuffer();
}

async function host(png) {
  if (!process.env.KED_TOKEN) throw new Error('Set KED_TOKEN so the sheets can be hosted for Printful to fetch.');
  const res = await fetch(`${API}/v1/print-files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.KED_TOKEN}`, 'Content-Type': 'image/png' },
    body: png,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Hosting a sheet: ${body.error?.message ?? res.status}`);
  return `${API}${body.url}`;
}

const spec = await sheetSpec();
const logo = readFileSync(join(ROOT, 'src/assets/logo.png'));
const codes = makeCodes(count);
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const out = join(ROOT, 'tools/stickers', stamp);
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'codes.csv'), `code,url,sheet\n${codes.map((c, i) => `${c},${SITE}/c/${c},${Math.floor(i / perSheet) + 1}`).join('\n')}\n`);

const sheets = [];
for (let i = 0; i < codes.length; i += perSheet) {
  const png = await sheet(codes.slice(i, i + perSheet), spec, logo);
  const file = join(out, `sheet-${String(sheets.length + 1).padStart(3, '0')}.png`);
  writeFileSync(file, png);
  sheets.push({ file, png });
}
console.log(`Sheet: ${spec.width}×${spec.height} px, ${spec.dpi} dpi (${spec.source}).`);
console.log(`${codes.length} stickers at ${inches}" on ${sheets.length} sheets, in ${out.replace(`${ROOT}/`, '')}/`);

if (!draft) {
  console.log('\nNothing sent. Look at the sheets, then add --draft --ship-to=ship.json.');
} else {
  if (!spec.variantId) throw new Error('--draft needs PRINTFUL_TOKEN.');
  const shipTo = flag('ship-to');
  if (!shipTo) throw new Error('--draft needs --ship-to=ship.json (where Printful mails the stickers).');
  const recipient = JSON.parse(readFileSync(shipTo, 'utf8'));
  const items = [];
  for (const [i, s] of sheets.entries()) {
    items.push({ variant_id: spec.variantId, quantity: 1, name: `Door-jamb stickers ${i + 1}`, files: [{ type: 'default', url: await host(s.png) }] });
    process.stdout.write(`\rHosted ${i + 1} / ${sheets.length}`);
  }
  // No ?confirm=1: a draft costs nothing until Jacob confirms it in Printful.
  const order = await printful('/orders', { method: 'POST', body: JSON.stringify({ external_id: `stickers-${stamp}`, recipient, items }) });
  console.log(`\nDraft order ${order.id} is in Printful (${order.costs?.total ? `$${order.costs.total} with shipping` : 'cost shows there'}).`);
  console.log('Jacob: Printful → Orders → open the draft → check the preview → Confirm and pay.');
  console.log(`The sheet links expire in a week; after that, run this again for a fresh batch.`);
}
