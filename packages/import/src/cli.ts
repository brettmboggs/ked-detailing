import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { defaultAccounts } from '@ked/books';
import { readHcpCustomers, readHcpJobs, type Read } from './housecall.ts';
import { guessAccount, readQuickBooksJournal, toEntries } from './quickbooks.ts';

/**
 * Cutover importer. Looks first, writes only with --go.
 *
 *   npm run import -w @ked/import -- customers ~/hcp-customers.csv
 *   npm run import -w @ked/import -- jobs ~/hcp-jobs.csv
 *   npm run import -w @ked/import -- quickbooks ~/journal.csv
 *
 * Add --go to send it. Needs KED_TOKEN (the API's ADMIN_TOKEN, or a session
 * token); KED_API defaults to the live API. Re-running is safe: anything
 * already imported is skipped.
 *
 * QuickBooks accounts are matched to ours through <file>.map.json, written on
 * the first look with a guess for each. Fix any null or wrong ones, then --go.
 */

const [kind, file, ...flags] = process.argv.slice(2);
const go = flags.includes('--go');
const tz = flags.find((f) => f.startsWith('--tz='))?.slice(5) ?? 'America/Chicago';
const API = (process.env.KED_API ?? 'https://ked-api.ked-api.workers.dev').replace(/\/$/, '');
const TOKEN = process.env.KED_TOKEN;

if (!kind || !file || !['customers', 'jobs', 'quickbooks'].includes(kind)) {
  console.log('Usage: import <customers|jobs|quickbooks> <file.csv> [--go] [--tz=America/Chicago]');
  process.exit(1);
}
const text = readFileSync(file, 'utf8');

function report<T>(read: Read<T>, label: string) {
  console.log(`Columns used: ${Object.entries(read.columns).map(([k, v]) => `${k} ← "${v}"`).join(', ') || 'none found'}`);
  console.log(`${read.items.length} ${label} read.`);
  for (const p of read.problems.slice(0, 20)) console.log(`  ! ${p}`);
  if (read.problems.length > 20) console.log(`  ! …and ${read.problems.length - 20} more`);
}

async function send(path: string, key: string, items: unknown[], size: number) {
  if (!TOKEN) throw new Error('Set KED_TOKEN first.');
  const totals: Record<string, number> = {};
  for (let i = 0; i < items.length; i += size) {
    const res = await fetch(`${API}/v1/import/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ [key]: items.slice(i, i + size) }),
    });
    const body = (await res.json()) as { error?: { message: string } } & Record<string, unknown>;
    if (!res.ok) throw new Error(`Rows ${i + 1}–${i + size}: ${body.error?.message ?? res.status}. Everything before this went in; re-run to continue.`);
    for (const [k, v] of Object.entries(body)) if (typeof v === 'number') totals[k] = (totals[k] ?? 0) + v;
    process.stdout.write(`\r${Math.min(i + size, items.length)} / ${items.length}`);
  }
  console.log(`\nDone: ${Object.entries(totals).map(([k, v]) => `${v} ${k}`).join(', ')}.`);
}

async function ourAccounts(): Promise<{ id: string; name: string }[]> {
  if (!TOKEN) return defaultAccounts;
  const res = await fetch(`${API}/v1/books/accounts?archived=true`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  return res.ok ? ((await res.json()) as { accounts: { id: string; name: string }[] }).accounts : defaultAccounts;
}

if (kind === 'customers') {
  const read = readHcpCustomers(text);
  report(read, 'customers');
  if (go) await send('customers', 'customers', read.items, 20);
} else if (kind === 'jobs') {
  const read = readHcpJobs(text, tz);
  report(read, 'jobs');
  const upcoming = read.items.filter((j) => new Date(j.start) > new Date() && j.status !== 'cancelled');
  console.log(`${upcoming.length} upcoming (go on the calendar), ${read.items.length - upcoming.length} past or cancelled (history).`);
  if (go) await send('jobs', 'jobs', read.items, 15);
} else {
  const journal = readQuickBooksJournal(text);
  const dates = journal.transactions.map((t) => t.date).sort();
  console.log(`${journal.transactions.length} transactions, ${dates[0] ?? '–'} to ${dates.at(-1) ?? '–'}.`);
  for (const p of journal.problems.slice(0, 20)) console.log(`  ! ${p}`);

  const mapFile = `${file}.map.json`;
  const ours = await ourAccounts();
  const mapping: Record<string, string | null> = existsSync(mapFile) ? JSON.parse(readFileSync(mapFile, 'utf8')) : {};
  for (const a of journal.accounts) if (!(a.name in mapping)) mapping[a.name] = guessAccount(a.name, ours);
  writeFileSync(mapFile, `${JSON.stringify(mapping, null, 2)}\n`);

  const names = new Map(ours.map((a) => [a.id, a.name]));
  console.log(`\nAccounts (edit ${mapFile} to change):`);
  for (const a of journal.accounts) {
    const to = mapping[a.name];
    const bad = to && !names.has(to);
    console.log(`  ${to && !bad ? '  ' : '??'} ${a.name.padEnd(40)} → ${to ? (bad ? `${to} (no such account)` : names.get(to)) : 'NOT MAPPED'}   (${a.lines} lines)`);
  }
  const missing = journal.accounts.filter((a) => !mapping[a.name] || !names.has(mapping[a.name]!));
  if (missing.length) {
    console.log(`\n${missing.length} account(s) need a home before --go. Use an id from GET /v1/books/accounts, or add one there first.`);
    if (go) process.exit(1);
  } else if (go) {
    await send('entries', 'entries', toEntries(journal.transactions, mapping as Record<string, string>), 10);
  }
}
if (!go) console.log('\nNothing sent. Add --go to import.');
