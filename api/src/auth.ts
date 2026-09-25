import { createMiddleware } from 'hono/factory';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { ApiError, list, now, randomToken, safeEqual, sha256, type Bindings } from './lib.ts';

const SESSION_DAYS = 90;
const appleKeys = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

export interface Owner {
  subject: string;
  email: string | null;
}

/**
 * Exchange a Sign in with Apple identity token for a session. Only allowlisted
 * people get one; there is no sign-up.
 */
export async function signInWithApple(env: Bindings, identityToken: string) {
  let payload;
  try {
    ({ payload } = await jwtVerify(identityToken, appleKeys, {
      issuer: 'https://appleid.apple.com',
      audience: env.APPLE_AUDIENCE,
    }));
  } catch {
    throw new ApiError(401, 'bad_token', 'That Apple sign-in could not be verified.');
  }

  const subject = String(payload.sub ?? '');
  const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : null;
  const emailVerified = payload.email_verified === true || payload.email_verified === 'true';
  const allowed =
    list(env.OWNER_APPLE_SUBS).includes(subject.toLowerCase()) ||
    (email !== null && emailVerified && list(env.OWNER_EMAILS).includes(email));
  if (!allowed) {
    // The subject is the caller's own ID, so returning it leaks nothing, and it
    // is exactly what needs adding to OWNER_APPLE_SUBS.
    throw new ApiError(403, 'not_owner', 'This Apple ID is not allowed to sign in.', [
      `subject: ${subject}`,
    ]);
  }

  return startSession(env, subject, email, SESSION_DAYS);
}

async function startSession(env: Bindings, subject: string, email: string | null, days: number) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + days * 864e5).toISOString();
  await env.DB.prepare('INSERT INTO sessions (token_hash, subject, email, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256(token), subject, email, now(), expiresAt)
    .run();
  return { token, expiresAt };
}

const LINK_MINUTES = 15;
const WEB_SESSION_DAYS = 30;

/**
 * The web admin's sign-in: email a one-time link to an owner address. The
 * answer is the same whether or not the address is allowed, so it can't be
 * used to find out who is. At most five links an hour per address.
 */
export async function requestEmailLogin(env: Bindings, body: Record<string, unknown>) {
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(422, 'invalid', "That email address doesn't look right.");
  const reply: { sent: true; link?: string } = { sent: true };
  if (!list(env.OWNER_EMAILS).includes(email)) return reply;

  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_links WHERE email = ? AND created_at > ?')
    .bind(email, new Date(Date.now() - 36e5).toISOString())
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= 5) return reply;

  const token = randomToken();
  await env.DB.prepare('INSERT INTO login_links (token_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), email, now(), new Date(Date.now() + LINK_MINUTES * 60_000).toISOString())
    .run();
  // A fragment, so the token never reaches a server log or a Referer.
  const link = `${env.ADMIN_URL}#login=${token}`;
  if (env.TEST_LOGIN_LINKS === '1') reply.link = link; // tests can't read the email
  if (env.EMAIL && env.MAIL_FROM) {
    await env.EMAIL.send({
      to: email,
      from: { name: "Knock Em' Down Detailing", email: env.MAIL_FROM },
      subject: 'Your sign-in link',
      text: `Tap to sign in to the KED admin:\n\n${link}\n\nIt works once, for ${LINK_MINUTES} minutes. If you didn't ask for it, ignore this email.`,
    });
  }
  return reply;
}

/** Trade a sign-in link's token for a session. Each link works once. */
export async function verifyEmailLogin(env: Bindings, body: Record<string, unknown>) {
  const token = typeof body.token === 'string' ? body.token : '';
  const used = await env.DB.prepare(
    'UPDATE login_links SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING email',
  )
    .bind(now(), await sha256(token), now())
    .first<{ email: string }>();
  if (!used) throw new ApiError(401, 'bad_link', 'That sign-in link has expired or was already used. Ask for a new one.');
  // Still an owner? The list may have changed since the link went out.
  if (!list(env.OWNER_EMAILS).includes(used.email)) throw new ApiError(403, 'not_owner', 'This email is not allowed to sign in.');
  return { ...(await startSession(env, `email:${used.email}`, used.email, WEB_SESSION_DAYS)), email: used.email };
}

/** Sign out: the session stops working everywhere at once. */
export async function endSession(env: Bindings, authorization: string | undefined) {
  const token = authorization?.match(/^Bearer (.+)$/)?.[1];
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
}

/** Owner-only routes: a live session token, or the break-glass admin token. */
export const requireOwner = createMiddleware<{ Bindings: Bindings; Variables: { owner: Owner } }>(
  async (c, next) => {
    const token = c.req.header('Authorization')?.match(/^Bearer (.+)$/)?.[1];
    if (!token) throw new ApiError(401, 'signed_out', 'Sign in first.');

    if (c.env.ADMIN_TOKEN && safeEqual(token, c.env.ADMIN_TOKEN)) {
      c.set('owner', { subject: 'admin', email: null });
      return next();
    }

    const session = await c.env.DB.prepare(
      'SELECT subject, email FROM sessions WHERE token_hash = ? AND expires_at > ?',
    )
      .bind(await sha256(token), now())
      .first<Owner>();
    if (!session) throw new ApiError(401, 'signed_out', 'Your session has expired. Sign in again.');
    c.set('owner', session);
    return next();
  },
);
