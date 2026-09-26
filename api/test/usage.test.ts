import { test } from 'node:test';
import assert from 'node:assert/strict';

// Usage tracking (api/src/usage.ts): owner check-ins from the app and web
// admin, throttled, and anonymous page counts for the public site.
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

test('owners check in; repeats within ten minutes are dropped', async () => {
  const path = `/usage-test-${Date.now()}`;
  assert.equal((await call('POST', '/usage', { client: 'app', kind: 'open', version: '1.0.0' })).status, 204);
  assert.equal((await call('POST', '/usage', { client: 'app', kind: 'screen', path })).status, 204);
  assert.equal((await call('POST', '/usage', { client: 'app', kind: 'screen', path })).status, 204);
  assert.equal((await call('POST', '/usage', { client: 'app', kind: 'nap' })).status, 422);
  assert.equal((await call('POST', '/usage', { client: 'app', kind: 'open' }, {})).status, 401, 'owners only');

  const report = await call('GET', '/usage?days=7');
  assert.equal(report.status, 200);
  const screen = report.body.screens.find((s: any) => s.path === path);
  assert.equal(screen.count, 1, 'the repeat was throttled');
  assert.ok(report.body.people.length >= 1);
  assert.ok(report.body.recent.some((e: any) => e.kind === 'open' && e.client === 'app'));
});

test('site views are counted by page, owner views apart, bots and junk ignored', async () => {
  const beacon = (body: unknown, ua = 'Mozilla/5.0 (iPhone)') =>
    fetch(`${API}/v1/visit`, { method: 'POST', headers: { 'Content-Type': 'text/plain', 'User-Agent': ua }, body: JSON.stringify(body) });
  const path = `/areas/test-${Date.now()}/`;
  assert.equal((await beacon({ path: `${path}?utm_source=x` })).status, 204);
  await beacon({ path });
  await beacon({ path, owner: true });
  await beacon({ path }, 'Googlebot/2.1');
  await beacon({ path: 'https://evil.example/' });
  await fetch(`${API}/v1/visit`, { method: 'POST', body: 'not json' });

  const { body } = await call('GET', '/usage?days=2');
  const page = body.site.pages.find((p: any) => p.path === path);
  assert.equal(page.views, 2, 'two customer views; the owner and the bot not counted here');
  const today = body.site.daily.at(-1);
  assert.ok(today.ownerViews >= 1);
  assert.ok(!body.site.pages.some((p: any) => p.path.includes('evil')));
});
