import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

// Every customer email goes out branded without the sender asking: the HTML
// layout with the logo, the customer link as a button, the business's details
// underneath. And a paid-in-full invoice sends its own receipt.
const API = process.env.API!;
const admin = { Authorization: `Bearer ${process.env.ADMIN_TOKEN}` };

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = admin) {
  const res = await fetch(`${API}/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await res.text();
  return { status: res.status, body: (t ? JSON.parse(t) : null) as any };
}

const mail: { to: string[]; subject: string; text: string; html: string }[] = [];
const resend = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    mail.push(JSON.parse(raw));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ id: `re_${mail.length}` }));
  });
});
await new Promise<void>((r) => resend.listen(Number(process.env.RESEND_PORT), r));
after(() => resend.close());
const mailTo = (addr: string) => mail.filter((m) => m.to[0] === addr);

let n = 0;
async function invoiceFor(name: string, email: string, start: string) {
  const j = await call('POST', '/jobs', {
    customer: { name, phone: `314-555-78${String(n++).padStart(2, '0')}`, email },
    address: '4 Brand Ave',
    input: { service: 'level-1', vehicleClass: 'sedan' },
    start,
  });
  assert.equal(j.status, 201, JSON.stringify(j.body));
  const inv = await call('POST', `/jobs/${j.body.job.id}/invoice`, { lines: [{ label: 'The Tune-Up', amount: 12000 }] });
  assert.equal(inv.status, 201);
  return inv.body;
}

test('an invoice email is branded, with the pay link as its button', async () => {
  const inv = await invoiceFor('Brandy Keller', 'brandy@example.com', '2035-04-01T15:00:00.000Z');
  const sent = await call('POST', `/invoices/${inv.id}/send`);
  assert.equal(sent.status, 200);
  assert.equal(sent.body.emailed, true);

  const [m] = mailTo('brandy@example.com');
  assert.ok(m, 'emailed');
  assert.match(m.subject, /^Invoice \d+ from Knock Em' Down Detailing$/);
  assert.ok(m.text.includes(inv.payUrl), 'the plain text keeps the link');
  assert.ok(m.html.includes('/email/logo.png'), 'logo');
  assert.ok(m.html.includes('#e8b14c'), 'gold');
  assert.ok(m.html.includes('View your invoice'), 'button');
  assert.equal(m.html.split(inv.payUrl).length - 1, 1, 'the link shows once, as the button');
  assert.ok(m.html.includes('(314) 223-2988'), 'business details in the footer');
  assert.ok(!/<script/i.test(m.html));
});

test('paying in full sends a receipt; a part payment does not', async () => {
  const inv = await invoiceFor('Rex Receipt', 'rex@example.com', '2035-04-02T15:00:00.000Z');
  await call('POST', `/invoices/${inv.id}/send`);
  const before = mailTo('rex@example.com').length;

  const part = await call('POST', `/invoices/${inv.id}/payments`, { date: '2035-04-02', amount: 2000, depositToId: 'cash' });
  assert.equal(part.status, 201);
  assert.equal(part.body.receipted, false);
  assert.equal(mailTo('rex@example.com').length, before);

  const rest = await call('POST', `/invoices/${inv.id}/payments`, { date: '2035-04-02', depositToId: 'cash', tip: 1500 });
  assert.equal(rest.body.invoice.status, 'paid');
  assert.equal(rest.body.receipted, true);
  const receipt = mailTo('rex@example.com').at(-1)!;
  assert.match(receipt.subject, /^Receipt for invoice \d+/);
  assert.ok(receipt.text.includes('$120') && receipt.text.includes('$15 tip'));
  assert.ok(receipt.html.includes('View your receipt'));
});

test('an invoice that was never sent gets no receipt', async () => {
  const inv = await invoiceFor('Quiet Quinn', 'quinn@example.com', '2035-04-03T15:00:00.000Z');
  const paid = await call('POST', `/invoices/${inv.id}/payments`, { date: '2035-04-03', depositToId: 'cash' });
  assert.equal(paid.body.invoice.status, 'paid');
  assert.equal(paid.body.receipted, false);
  assert.equal(mailTo('quinn@example.com').length, 0);
});
