import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig } from '@ked/pricing';

// Run through `npm test`, which starts a local Worker with an empty D1.
const API = process.env.API!;
const admin = { Authorization: `Bearer ${process.env.ADMIN_TOKEN}` };

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${API}/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, headers: res.headers, body: (await res.json()) as any };
}

const lead = {
  name: 'Sam Driver',
  phone: '(314) 555-0100',
  vehicle: '2021 Tahoe',
  zip: '63049',
  input: { service: 'level-2', vehicleClass: 'large', conditions: { 'pet-hair': 'heavy' }, addOns: [] },
};

test('pricing falls back to the built-in defaults before anything is saved', async () => {
  const r = await call('GET', '/pricing');
  assert.equal(r.status, 200);
  assert.equal(r.body.version, defaultConfig.version);
  assert.equal(r.body.updatedAt, null);
  assert.deepEqual(r.body.config, defaultConfig);
});

test('owner endpoints refuse anyone without a token', async () => {
  assert.equal((await call('GET', '/leads')).status, 401);
  assert.equal((await call('GET', '/leads', undefined, { Authorization: 'Bearer nope' })).status, 401);
  const r = await call('PUT', '/pricing', defaultConfig);
  assert.equal(r.status, 401);
  assert.equal(r.body.error.code, 'signed_out');
});

test('a website lead is priced on the server, not trusted from the browser', async () => {
  const r = await call('POST', '/leads', { ...lead, quote: { total: 1 } });
  assert.equal(r.status, 201);
  // 275 × 1.3 = 357.50, heavy pet hair 90 × 1.3 = 117, no travel in the core zone
  assert.equal(r.body.quote.total, 47450);
  assert.match(r.body.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);

  const listed = await call('GET', '/leads?status=new', undefined, admin);
  assert.equal(listed.status, 200);
  const stored = listed.body.leads.find((l: any) => l.id === r.body.id);
  assert.equal(stored.name, 'Sam Driver');
  assert.equal(stored.configVersion, defaultConfig.version);
  assert.equal(stored.input.zip, '63049');
});

test('leads need a name, a way to reach them, and a real service', async () => {
  const noName = await call('POST', '/leads', { ...lead, name: '' });
  assert.equal(noName.status, 422);
  const noContact = await call('POST', '/leads', { ...lead, phone: undefined });
  assert.equal(noContact.status, 422);
  const badService = await call('POST', '/leads', { ...lead, input: { service: 'level-9' } });
  assert.equal(badService.status, 422);
  assert.equal(badService.body.error.code, 'invalid_quote');
});

test('the honeypot looks like success but stores nothing', async () => {
  const before = (await call('GET', '/leads', undefined, admin)).body.leads.length;
  const r = await call('POST', '/leads', { ...lead, website: 'http://spam.example' });
  assert.equal(r.status, 201);
  const after = (await call('GET', '/leads', undefined, admin)).body.leads.length;
  assert.equal(after, before);
});

test('lead status moves along and rejects nonsense', async () => {
  const { body } = await call('POST', '/leads', lead);
  const moved = await call('PATCH', `/leads/${body.id}`, { status: 'contacted' }, admin);
  assert.equal(moved.status, 200);
  assert.equal(moved.body.status, 'contacted');
  assert.equal((await call('PATCH', `/leads/${body.id}`, { status: 'done' }, admin)).status, 422);
  assert.equal((await call('PATCH', '/leads/NOPE', { status: 'lost' }, admin)).status, 404);
});

test('saving pricing validates, versions, and goes live', async () => {
  const bad = structuredClone(defaultConfig);
  bad.services[0]!.base = -5;
  const refused = await call('PUT', '/pricing', bad, admin);
  assert.equal(refused.status, 422);
  assert.ok(refused.body.error.details.length > 0);

  assert.equal((await call('PUT', '/pricing', { hello: 'world' }, admin)).status, 422);

  const next = structuredClone(defaultConfig);
  next.services.find((s) => s.id === 'level-2')!.base = 30000;
  const saved = await call('PUT', '/pricing', next, admin);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.version, defaultConfig.version + 1);

  const live = await call('GET', '/pricing');
  assert.equal(live.body.version, defaultConfig.version + 1);

  // New leads price with the new numbers and record which version did it.
  const r = await call('POST', '/leads', { ...lead, input: { service: 'level-2', vehicleClass: 'sedan' } });
  assert.equal(r.body.quote.total, 30000);
});

test('CORS: the website may call, strangers may not', async () => {
  const ok = await fetch(`${API}/v1/pricing`, { headers: { Origin: 'https://www.kedservice.com' } });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://www.kedservice.com');
  const no = await fetch(`${API}/v1/pricing`, { headers: { Origin: 'https://evil.example' } });
  assert.equal(no.headers.get('access-control-allow-origin'), null);
});

test('errors use the contract shape', async () => {
  const r = await call('GET', '/nope');
  assert.equal(r.status, 404);
  assert.equal(r.body.error.code, 'not_found');
  const bad = await fetch(`${API}/v1/leads`, { method: 'POST', body: 'not json' });
  assert.equal(bad.status, 400);
});
