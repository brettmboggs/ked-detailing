import { Hono } from 'hono';
import type { AppEnv } from './app-env.ts';
import { requireOwner } from './auth.ts';

/**
 * Email and text campaigns to a segment of customers. Mounted at /v1/crm/campaigns.
 * See docs/crm.md.
 */
export const campaigns = new Hono<AppEnv>();
campaigns.use('*', requireOwner);
