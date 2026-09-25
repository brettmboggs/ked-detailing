import { Hono } from 'hono';
import type { AppEnv } from './app-env.ts';

/**
 * The CRM's public routes, no sign-in: unsubscribing from emails (every
 * marketing email links here) and anything else a customer reaches from an
 * email. Mounted at /v1/crm/public. See docs/crm.md.
 */
export const crmPublic = new Hono<AppEnv>();
