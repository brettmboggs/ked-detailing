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

  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  await env.DB.prepare(
    'INSERT INTO sessions (token_hash, subject, email, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(await sha256(token), subject, email, now(), expiresAt)
    .run();
  return { token, expiresAt };
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
