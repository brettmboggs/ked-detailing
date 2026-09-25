import { Hono } from 'hono';
import type { AppEnv } from './app-env.ts';
import { activityStatement } from './crm-activity.ts';
import { ApiError, now } from './lib.ts';

/**
 * The CRM's public routes, no sign-in: unsubscribing from emails (every
 * marketing email links here) and anything else a customer reaches from an
 * email. Mounted at /v1/crm/public. See docs/crm.md.
 *
 * The token in the link is the only key, so answers show as little as they
 * can: a first name and a masked email.
 */
export const crmPublic = new Hono<AppEnv>();

interface Who {
  id: string;
  name: string;
  email: string | null;
  email_ok: number;
}

/** Tokens are 43 URL-safe characters (crm-email.ts) or 48 hex (crm-followups.ts). */
async function byToken(db: D1Database, token: string) {
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) throw new ApiError(404, 'not_found', "That unsubscribe link doesn't work. It may have been cut off.");
  const row = await db.prepare('SELECT id, name, email, email_ok FROM customers WHERE unsubscribe_token = ?').bind(token).first<Who>();
  if (!row) throw new ApiError(404, 'not_found', "That unsubscribe link doesn't work. It may have been cut off.");
  return row;
}

/** "j•••n@gmail.com": enough to recognize, not enough to harvest. */
export function maskEmail(email: string | null) {
  if (!email) return null;
  const [user = '', domain = ''] = email.split('@');
  const shown = user.length <= 2 ? `${user[0] ?? ''}•••` : `${user[0]}•••${user[user.length - 1]}`;
  return `${shown}@${domain}`;
}

const view = (w: Who) => ({
  firstName: w.name.trim().split(/\s+/)[0] ?? '',
  email: maskEmail(w.email),
  unsubscribed: w.email_ok === 0,
});

crmPublic.get('/unsubscribe/:token', async (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json(view(await byToken(c.env.DB, c.req.param('token'))));
});

/**
 * Unsubscribe. The page's button posts here, and so do mail apps for the
 * List-Unsubscribe-Post one-click header (RFC 8058: a form body of
 * "List-Unsubscribe=One-Click", no cookies), so the body is never read.
 * Doing it twice is fine.
 */
crmPublic.post('/unsubscribe/:token', async (c) => {
  c.header('Cache-Control', 'no-store');
  const w = await byToken(c.env.DB, c.req.param('token'));
  if (w.email_ok !== 0) {
    const oneClick = (c.req.header('Content-Type') ?? '').includes('application/x-www-form-urlencoded');
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE customers SET email_ok = 0, updated_at = ? WHERE id = ?').bind(now(), w.id),
      activityStatement(c.env.DB, {
        customerId: w.id,
        kind: 'system',
        body: oneClick ? 'Unsubscribed from emails (from their mail app).' : 'Unsubscribed from emails (from the link in an email).',
        by: 'customer',
      }),
    ]);
  }
  return c.json({ ...view(w), unsubscribed: true });
});

/** Changed their mind: the page offers this right after unsubscribing. */
crmPublic.post('/unsubscribe/:token/undo', async (c) => {
  c.header('Cache-Control', 'no-store');
  const w = await byToken(c.env.DB, c.req.param('token'));
  if (w.email_ok === 0) {
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE customers SET email_ok = 1, updated_at = ? WHERE id = ?').bind(now(), w.id),
      activityStatement(c.env.DB, { customerId: w.id, kind: 'system', body: 'Subscribed to emails again (from the unsubscribe page).', by: 'customer' }),
    ]);
  }
  return c.json({ ...view(w), unsubscribed: false });
});
