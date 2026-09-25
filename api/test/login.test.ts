import { test } from 'node:test';
import assert from 'node:assert/strict';

// The test Worker runs with TEST_LOGIN_LINKS=1, so the link comes back in the
// response as well as by email.
const API = process.env.API!;

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${API}/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await res.text();
  return { status: res.status, body: raw ? JSON.parse(raw) : null };
}

const tokenOf = (link: string) => new URL(link).hash.replace('#login=', '');

test('an owner signs in with an emailed link that works once', async () => {
  const asked = await call('POST', '/auth/email', { email: ' KnockEmDownDetailing@Gmail.com ' });
  assert.equal(asked.status, 200);
  assert.match(asked.body.link, /\/admin\/#login=[A-Za-z0-9_-]{43}$/);

  const session = await call('POST', '/auth/email/verify', { token: tokenOf(asked.body.link) });
  assert.equal(session.status, 200);
  assert.equal(session.body.email, 'knockemdowndetailing@gmail.com');
  const auth = { Authorization: `Bearer ${session.body.token}` };
  assert.equal((await call('GET', '/leads', undefined, auth)).status, 200, 'the session opens owner endpoints');

  assert.equal((await call('POST', '/auth/email/verify', { token: tokenOf(asked.body.link) })).status, 401, 'a link works once');

  assert.equal((await call('DELETE', '/auth/session', undefined, auth)).status, 204);
  assert.equal((await call('GET', '/leads', undefined, auth)).status, 401, 'signed out everywhere');
});

test('strangers get the same answer and no link', async () => {
  const stranger = await call('POST', '/auth/email', { email: 'someone@example.com' });
  assert.equal(stranger.status, 200);
  assert.deepEqual(stranger.body, { sent: true });
  assert.equal((await call('POST', '/auth/email', { email: 'nope' })).status, 422);
  assert.equal((await call('POST', '/auth/email/verify', { token: 'A'.repeat(43) })).status, 401);
});

test('at most five links an hour per address', async () => {
  const links = [];
  for (let i = 0; i < 6; i++) links.push((await call('POST', '/auth/email', { email: 'brettmboggs@gmail.com' })).body.link);
  assert.ok(links.slice(0, 5).every(Boolean));
  assert.equal(links[5], undefined, 'the sixth is quietly not sent');
});
