import { test } from 'node:test';
import assert from 'node:assert/strict';

// The free Workers plan allows 50 D1 queries per request, counting each
// statement in a batch. Local dev doesn't enforce that, so the test Worker
// reports its count in X-D1-Queries and these hold the heavy paths under it.
const API = process.env.API!;
const auth = { Authorization: `Bearer ${process.env.ADMIN_TOKEN}` };
const CAP = 50;

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...auth },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await res.text();
  return { status: res.status, body: raw ? JSON.parse(raw) : null, queries: Number(res.headers.get('X-D1-Queries')) };
}

const qfx = (txns: [string, string, string, string][]) => `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
${txns.map(([id, date, amount, name]) => `<STMTTRN>\n<TRNTYPE>OTHER\n<DTPOSTED>${date}\n<TRNAMT>${amount}\n<FITID>${id}\n<NAME>${name}\n</STMTTRN>`).join('\n')}
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

const day = (i: number) => `203903${String((i % 28) + 1).padStart(2, '0')}`;

test('a long statement imports, files and re-imports within the query cap', async () => {
  const acct = (await call('POST', '/books/accounts', { name: 'Query Cap Checking', type: 'asset', moneyAccount: true })).body.id;

  // Teach one rule: HOBBY LOBBY is supplies.
  const first = await call('POST', '/books/bank-imports', { accountId: acct, file: qfx([['q0', '20390301', '-12.00', 'HOBBY LOBBY #1']]) });
  const line = (await call('GET', `/books/bank-lines?accountId=${acct}&status=unmatched`)).body.lines[0];
  const taught = await call('POST', `/books/bank-lines/${line.id}`, { action: 'categorize', categoryId: 'supplies' });
  assert.equal(taught.status, 200);
  assert.ok(taught.queries < CAP, `filing one line: ${taught.queries} queries`);
  assert.ok(first.queries < CAP);

  // A busy month: 60 lines the rule files, 60 it doesn't know.
  const txns: [string, string, string, string][] = [];
  for (let i = 0; i < 60; i++) txns.push([`r${i}`, day(i), `-${10 + i}.00`, `HOBBY LOBBY #${i}`]);
  for (let i = 0; i < 60; i++) txns.push([`u${i}`, day(i), `-${5 + i}.25`, `CORNER SHOP ${i}`]);
  const big = await call('POST', '/books/bank-imports', { accountId: acct, file: qfx(txns) });
  assert.equal(big.status, 201, JSON.stringify(big.body));
  assert.ok(big.queries < CAP, `120-line import: ${big.queries} queries`);
  assert.equal(big.body.added, 120);
  assert.equal(big.body.filed, 60, 'the rule filed its merchant');
  assert.equal(big.body.waiting, 60);

  // Filed properly: entries posted, lines matched to them.
  const filed = (await call('GET', `/books/bank-lines?accountId=${acct}&status=matched`)).body.lines;
  assert.equal(filed.length, 61);
  assert.ok(filed.every((l: any) => l.entryId));
  const entries = (await call('GET', `/books/entries?accountId=${acct}&from=2039-03-01&to=2039-03-31`)).body.entries;
  assert.equal(entries.length, 61);
  assert.deepEqual(entries.find((e: any) => e.memo === 'HOBBY LOBBY #5').lines, [{ accountId: 'supplies', amount: 1500 }, { accountId: acct, amount: -1500 }]);
  const rule = (await call('GET', '/books/rules')).body.rules.find((r: any) => r.merchant === 'HOBBY LOBBY');
  assert.equal(rule.hits, 60);

  const again = await call('POST', '/books/bank-imports', { accountId: acct, file: qfx(txns) });
  assert.equal(again.body.duplicates, 120);
  assert.ok(again.queries < CAP, `re-import: ${again.queries} queries`);

  // Filing one of the 60 teaches CORNER SHOP, and the other 59 file at once.
  const waiting = (await call('GET', `/books/bank-lines?accountId=${acct}&status=unmatched`)).body.lines;
  const shop = waiting.find((l: any) => l.merchant === 'CORNER SHOP');
  const learned = await call('POST', `/books/bank-lines/${shop.id}`, { action: 'categorize', categoryId: 'office' });
  assert.ok(learned.queries < CAP, `learning and filing 59 more: ${learned.queries} queries`);
  assert.equal((await call('GET', `/books/bank-lines?accountId=${acct}&status=unmatched`)).body.lines.length, 0);
});

test('the importers stay under the cap at full chunks', async () => {
  const customers = Array.from({ length: 20 }, (_, i) => ({ name: `Cap Customer ${i}`, phone: `636-555-${1000 + i}`, email: `cap${i}@example.com` }));
  const c = await call('POST', '/import/customers', { customers });
  assert.equal(c.status, 200);
  assert.ok(c.queries < CAP, `20 customers: ${c.queries} queries`);

  const jobs = Array.from({ length: 15 }, (_, i) => ({
    ref: `cap-${i}`, customer: { name: `Cap Job ${i}`, phone: `636-555-${2000 + i}` }, address: '1 Cap St',
    start: `2039-04-${String(i + 1).padStart(2, '0')}T15:00:00.000Z`, status: 'scheduled', total: 10000,
  }));
  const j = await call('POST', '/import/jobs', { jobs });
  assert.equal(j.status, 200);
  assert.ok(j.queries < CAP, `15 jobs: ${j.queries} queries`);

  const entries = Array.from({ length: 10 }, (_, i) => ({
    ref: `cap-${i}`, date: '2039-04-01', payee: `Cap Vendor ${i}`,
    lines: [{ accountId: 'supplies', amount: 100 + i }, { accountId: 'checking', amount: -(100 + i) }],
  }));
  const e = await call('POST', '/import/entries', { entries });
  assert.equal(e.status, 200);
  assert.ok(e.queries < CAP, `10 entries: ${e.queries} queries`);
});
