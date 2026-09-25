import { logActivity } from './crm-activity.ts';
import { randomToken, type Bindings } from './lib.ts';

/**
 * Email to customers, through Resend (free plan: 3,000 a month, 100 a day).
 * Replies go to Jacob's own inbox (REPLY_TO). Without RESEND_API_KEY nothing
 * sends and every call returns false, so callers can fall back to a one-tap
 * text.
 *
 * Marketing email (follow-ups, campaigns) must go through `sendMarketingEmail`:
 * it skips anyone who unsubscribed and adds the unsubscribe link and header.
 * Service email (booking confirmations, reminders about their own booking)
 * uses `sendEmail`.
 */

const RESEND = 'https://api.resend.com/emails';

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  headers?: Record<string, string>;
}

export async function sendEmail(env: Bindings, m: OutgoingEmail): Promise<boolean> {
  if (!env.RESEND_API_KEY) return false;
  try {
    const res = await fetch(env.RESEND_URL || RESEND, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.CUSTOMER_MAIL_FROM,
        to: [m.to],
        reply_to: env.REPLY_TO || undefined,
        subject: m.subject,
        text: m.text,
        html: m.html,
        headers: m.headers,
      }),
    });
    if (!res.ok) {
      console.error(`resend: HTTP ${res.status} ${await res.text().catch(() => '')}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('resend failed', err);
    return false;
  }
}

/** The customer's unsubscribe link. Makes their token on first use. */
export async function unsubscribeUrl(env: Bindings, customerId: string): Promise<string> {
  const row = await env.DB.prepare('SELECT unsubscribe_token FROM customers WHERE id = ?').bind(customerId).first<{ unsubscribe_token: string | null }>();
  let token = row?.unsubscribe_token;
  if (!token) {
    token = randomToken();
    await env.DB.prepare('UPDATE customers SET unsubscribe_token = COALESCE(unsubscribe_token, ?) WHERE id = ?').bind(token, customerId).run();
    token = (await env.DB.prepare('SELECT unsubscribe_token FROM customers WHERE id = ?').bind(customerId).first<{ unsubscribe_token: string }>())!.unsubscribe_token;
  }
  return `${(env.SITE_URL || 'https://www.kedservice.com').replace(/\/$/, '')}/unsubscribe/?t=${encodeURIComponent(token)}`;
}

/** Mail apps POST here for one-click unsubscribe (RFC 8058); the static site can't take a POST. */
export const oneClickUrl = (env: Bindings, token: string) =>
  `${(env.API_URL || 'https://ked-api.ked-api.workers.dev').replace(/\/$/, '')}/v1/crm/public/unsubscribe/${encodeURIComponent(token)}`;

/** The footer every marketing email ends with. */
export const marketingFooter = (link: string) =>
  `\n\n--\nKnock Em' Down Auto & Marine Detailing, St. Louis\nDon't want these emails? ${link}`;

export type MarketingResult = 'sent' | 'unsubscribed' | 'no_email' | 'not_configured' | 'failed';

/**
 * A follow-up or campaign email to one customer. Checks consent, adds the
 * unsubscribe footer and List-Unsubscribe headers, and logs it on their
 * timeline when it goes.
 */
export async function sendMarketingEmail(
  env: Bindings,
  customerId: string,
  m: { subject: string; text: string; meta?: Record<string, unknown> },
): Promise<MarketingResult> {
  if (!env.RESEND_API_KEY) return 'not_configured';
  const c = await env.DB.prepare('SELECT email, email_ok FROM customers WHERE id = ?').bind(customerId).first<{ email: string | null; email_ok: number }>();
  if (!c?.email) return 'no_email';
  if (!c.email_ok) return 'unsubscribed';
  const link = await unsubscribeUrl(env, customerId);
  const token = new URL(link).searchParams.get('t')!;
  const ok = await sendEmail(env, {
    to: c.email,
    subject: m.subject,
    text: `${m.text.trimEnd()}${marketingFooter(link)}`,
    headers: { 'List-Unsubscribe': `<${oneClickUrl(env, token)}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  });
  if (!ok) return 'failed';
  await logActivity(env.DB, { customerId, kind: 'email', body: `${m.subject}\n\n${m.text}`, meta: m.meta, by: 'system' });
  return 'sent';
}
