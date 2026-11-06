#!/usr/bin/env node
// Guards the white-label plan (docs/multi-tenant.md): the system code must
// not pick up new hard-coded facts about Knock Em' Down.
//
// It counts business-specific strings in the system code (API, packages,
// admin, portal pages). The marketing site (src/data, src/components, the
// public pages) is excluded: a white-label copy replaces it whole.
//
// A line carrying "TENANT:" is allowed. Anything else is checked against
// tools/tenant-baseline.json, the debt as of 2026-11-06. A file may go DOWN
// (and should); it may not go up.
//
//   node tools/tenant-check.mjs           check (CI runs this)
//   node tools/tenant-check.mjs --update  rewrite the baseline. Only to
//                                         lower it, or with a reason in the
//                                         commit message
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const baselinePath = join(root, 'tools/tenant-baseline.json');

// Business-specific: the business, its owner, its domains, its home base.
const PATTERN = /Knock ?'?Em|knockemdown|Jacob|kedservice|Brentwood|High Ridge|\bKED\b/g;

const SCAN = ['api/src', 'api/wrangler.jsonc', 'packages', 'src/scripts'];
// System pages: the portal a customer or the owner uses, not marketing.
const SYSTEM_PAGES = [
  'admin', 'approve', 'booking', 'done', 'pay', 'quote', 'unsubscribe', 'car',
].map((p) => `src/pages/${p}.astro`);

const SKIP_DIR = new Set(['node_modules', 'dist', '.wrangler', 'test', '__pycache__']);
const EXT = /\.(ts|tsx|mjs|js|astro|jsonc)$/;

function walk(path, out) {
  const abs = join(root, path);
  if (!existsSync(abs)) return;
  if (statSync(abs).isFile()) {
    if (EXT.test(abs) && !/\.test\.ts$/.test(abs)) out.push(path);
    return;
  }
  for (const name of readdirSync(abs)) {
    if (SKIP_DIR.has(name)) continue;
    walk(join(path, name), out);
  }
}

const files = [];
for (const p of [...SCAN, ...SYSTEM_PAGES]) walk(p, files);

const counts = {};
for (const file of files.sort()) {
  let n = 0;
  for (const line of readFileSync(join(root, file), 'utf8').split('\n')) {
    if (line.includes('TENANT:')) continue;
    n += (line.match(PATTERN) ?? []).length;
  }
  if (n) counts[relative(root, join(root, file))] = n;
}

if (process.argv.includes('--update')) {
  writeFileSync(baselinePath, JSON.stringify(counts, null, 2) + '\n');
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`tenant baseline: ${total} in ${Object.keys(counts).length} files`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const over = Object.entries(counts).filter(([f, n]) => n > (baseline[f] ?? 0));
if (over.length) {
  console.error('New business-specific strings in system code (white-label plan, docs/multi-tenant.md):');
  for (const [f, n] of over) console.error(`  ${f}: ${baseline[f] ?? 0} -> ${n}`);
  console.error(
    '\nRead it from the business profile / site data instead, or tag the line with',
    '"TENANT: <why>" if it truly has to be there.',
  );
  process.exit(1);
}
const lower = Object.entries(baseline).filter(([f, n]) => (counts[f] ?? 0) < n);
if (lower.length) console.log(`tenant check: ${lower.length} file(s) below baseline; run with --update to lock in the gain`);
console.log('tenant check: ok');
