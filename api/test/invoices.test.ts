import { test } from 'node:test';
import assert from 'node:assert/strict';

// Run through `npm test`, which starts a local Worker with an empty D1.
const API = process.env.API!;
const auth = { Authorization: `Bearer ${process.env.ADMIN_TOKEN}` };

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = auth) {
  const res = await fetch(`${API}/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await res.text();
  return { status: res.status, body: raw ? JSON.parse(raw) : null };
}

let phone = 700;

/** A job in this suite's own year, so other suites' jobs never match. Its own phone, so customers don't merge. */
async function job(name: string, start: string, input: Record<string, unknown> = { service: 'level-1', vehicleClass: 'sedan' }) {
  const res = await call('POST', '/jobs', { customer: { name, phone: `314-555-0${phone++}` }, address: '9 Oak St', input, start });
  assert.equal(res.status, 201);
  return res.body.job;
}

const tokenOf = (payUrl: string) => new URL(payUrl).searchParams.get('i')!;

test('an invoice starts from the quote, and asking again returns the same one', async () => {
  const j = await job('Invoice Customer', '2034-03-01T15:00:00.000Z');
  const made = await call('POST', `/jobs/${j.id}/invoice`);
  assert.equal(made.status, 201);
  const inv = made.body;
  assert.equal(inv.status, 'draft');
  assert.deepEqual(inv.lines, j.quote.lines);
  assert.equal(inv.total, j.quote.total);
  assert.equal(inv.balance, inv.total);
  assert.ok(inv.number >= 1001);
  assert.match(inv.payUrl, /\/pay\/\?i=[A-Za-z0-9_-]{43}$/);
  assert.equal((await call('GET', `/jobs/${j.id}`)).body.finalPrice, inv.total, 'the job carries the invoiced price');

  const again = await call('POST', `/jobs/${j.id}/invoice`, { lines: [{ label: 'Ignored', amount: 100 }] });
  assert.equal(again.status, 200);
  assert.equal(again.body.id, inv.id);
  assert.equal(again.body.total, inv.total);
});

test('a settled price shows as a discount line; edits re-price the job; bad lines are refused', async () => {
  const j = await job('Discount Customer', '2034-03-02T15:00:00.000Z');
  await call('PATCH', `/jobs/${j.id}`, { finalPrice: j.quote.total - 2000 });
  const inv = (await call('POST', `/jobs/${j.id}/invoice`)).body;
  assert.deepEqual(inv.lines.at(-1), { label: 'Discount', amount: -2000 });
  assert.equal(inv.total, j.quote.total - 2000);

  const edited = await call('PATCH', `/invoices/${inv.id}`, {
    lines: [{ label: 'Full detail', amount: 25000 }, { label: 'Pet hair', amount: 4050 }],
    dueDate: '2034-03-15',
    notes: 'Thanks!',
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.total, 29050);
  assert.equal(edited.body.dueDate, '2034-03-15');
  assert.equal((await call('GET', `/jobs/${j.id}`)).body.finalPrice, 29050);

  for (const lines of [[], [{ label: '', amount: 100 }], [{ label: 'X', amount: 1.5 }], [{ label: 'Refund', amount: -500 }]]) {
    assert.equal((await call('PATCH', `/invoices/${inv.id}`, { lines })).status, 422, JSON.stringify(lines));
  }
  assert.equal((await call('PATCH', `/invoices/${inv.id}`, { dueDate: 'soon' })).status, 422);
});

test('send, the customer view, part payments, a tip, and a voided payment reopening it', async () => {
  const j = await job('Dana Whitfield', '2034-03-03T15:00:00.000Z');
  const inv = (await call('POST', `/jobs/${j.id}/invoice`, { lines: [{ label: 'The Knockout', amount: 20000 }] })).body;

  const sent = await call('POST', `/invoices/${inv.id}/send`);
  assert.equal(sent.body.invoice.status, 'sent');
  assert.match(sent.body.message, /^Hi Dana,/);
  assert.ok(sent.body.message.includes('$200') && sent.body.message.includes(inv.payUrl));

  const token = tokenOf(inv.payUrl);
  const view = await call('GET', `/pay/${token}`, undefined, {});
  assert.equal(view.status, 200);
  assert.equal(view.body.customerName, 'Dana', 'first name only');
  assert.equal(view.body.balance, 20000);
  assert.equal(view.body.payOnline, false);
  assert.ok(!JSON.stringify(view.body).includes('314-555'), 'no phone on the public copy');
  assert.ok((await call('GET', `/invoices/${inv.id}`)).body.viewedAt, 'Jacob can see it was opened');

  const part = await call('POST', `/invoices/${inv.id}/payments`, { date: '2034-03-03', amount: 5000, depositToId: 'cash', method: 'cash' });
  assert.equal(part.status, 201);
  assert.equal(part.body.invoice.status, 'sent');
  assert.equal(part.body.invoice.balance, 15000);

  // The rest by default, plus a tip that doesn't count against the balance.
  const rest = await call('POST', `/invoices/${inv.id}/payments`, { date: '2034-03-04', depositToId: 'checking', method: 'zelle', tip: 3000 });
  assert.equal(rest.body.invoice.status, 'paid');
  assert.equal(rest.body.invoice.balance, 0);
  assert.equal(rest.body.invoice.paid, 20000);
  assert.equal(rest.body.invoice.paidOn, '2034-03-04');
  assert.equal(rest.body.entries.length, 2);
  assert.ok(rest.body.entries[1].lines.some((l: any) => l.accountId === 'income-tips' && l.amount === -3000));
  assert.equal((await call('GET', `/pay/${token}`, undefined, {})).body.status, 'paid');
  assert.equal((await call('POST', `/invoices/${inv.id}/payments`, { depositToId: 'cash' })).status, 409, 'nothing left to pay');
  assert.equal((await call('POST', `/invoices/${inv.id}/send`)).status, 409);

  // Voiding the second payment in the books reopens the invoice.
  const second = rest.body.entries[0].id;
  assert.equal((await call('POST', `/books/entries/${second}/void`, {})).status, 201);
  const reopened = (await call('GET', `/invoices/${inv.id}`)).body;
  assert.equal(reopened.status, 'sent');
  assert.equal(reopened.balance, 15000);
});

test('"Mark paid" in the books settles the invoice too', async () => {
  const j = await job('Books Payer', '2034-03-05T15:00:00.000Z');
  const inv = (await call('POST', `/jobs/${j.id}/invoice`)).body;
  await call('POST', '/books/income', { date: '2034-03-05', amount: inv.total, depositToId: 'checking', jobId: j.id });
  assert.equal((await call('GET', `/invoices/${inv.id}`)).body.status, 'paid');
  assert.ok((await call('GET', '/invoices?status=paid')).body.invoices.some((i: any) => i.id === inv.id));
  assert.ok(!(await call('GET', '/invoices?status=unpaid')).body.invoices.some((i: any) => i.id === inv.id));
});

test('void: refused while payments stand, then a fresh invoice gets the next number', async () => {
  const j = await job('Void Customer', '2034-03-06T15:00:00.000Z');
  const inv = (await call('POST', `/jobs/${j.id}/invoice`)).body;
  const paid = await call('POST', `/invoices/${inv.id}/payments`, { date: '2034-03-06', amount: 1000, depositToId: 'cash' });
  assert.equal((await call('POST', `/invoices/${inv.id}/void`)).status, 409);
  await call('POST', `/books/entries/${paid.body.entries[0].id}/void`, {});

  const voided = await call('POST', `/invoices/${inv.id}/void`);
  assert.equal(voided.body.status, 'void');
  assert.equal((await call('PATCH', `/invoices/${inv.id}`, { notes: 'x' })).status, 409);
  assert.equal((await call('POST', `/invoices/${inv.id}/payments`, { depositToId: 'cash' })).status, 409);
  assert.equal((await call('GET', `/pay/${tokenOf(inv.payUrl)}`, undefined, {})).body.status, 'void');

  const fresh = await call('POST', `/jobs/${j.id}/invoice`);
  assert.equal(fresh.status, 201);
  assert.notEqual(fresh.body.id, inv.id);
  assert.ok(fresh.body.number > inv.number);
  assert.deepEqual((await call('GET', `/invoices?jobId=${j.id}`)).body.invoices.map((i: any) => i.status), ['draft', 'void']);
});

test('cancelled and unpriced jobs, bad links, checkout, and strangers', async () => {
  const cancelled = await job('Cancelled Customer', '2034-03-07T15:00:00.000Z');
  await call('PATCH', `/jobs/${cancelled.id}`, { status: 'cancelled' });
  assert.equal((await call('POST', `/jobs/${cancelled.id}/invoice`)).status, 409);

  const ceramic = await job('Ceramic Customer', '2034-03-08T15:00:00.000Z', { service: 'ceramic', vehicleClass: 'sedan' });
  const unpriced = await call('POST', `/jobs/${ceramic.id}/invoice`);
  assert.equal(unpriced.status, 422);
  assert.equal(unpriced.body.error.code, 'no_price');
  await call('PATCH', `/jobs/${ceramic.id}`, { finalPrice: 90000 });
  const priced = await call('POST', `/jobs/${ceramic.id}/invoice`);
  assert.equal(priced.status, 201);
  assert.deepEqual(priced.body.lines, [{ label: ceramic.quote.lines[0].label, amount: 90000 }], 'named for the service, not "Adjustment"');

  assert.equal((await call('GET', '/pay/nope', undefined, {})).status, 404);
  assert.equal((await call('GET', `/pay/${'A'.repeat(43)}`, undefined, {})).status, 404);
  const inv = (await call('GET', `/invoices?jobId=${ceramic.id}`)).body.invoices[0];
  const checkout = await call('POST', `/pay/${tokenOf(inv.payUrl)}/checkout`, undefined, {});
  assert.equal(checkout.status, 503);
  assert.equal(checkout.body.error.code, 'payments_off');

  assert.equal((await call('GET', '/invoices', undefined, {})).status, 401);
  assert.equal((await call('POST', `/jobs/${ceramic.id}/invoice`, undefined, {})).status, 401);
  assert.equal((await call('GET', '/invoices?status=late')).status, 422);
});
