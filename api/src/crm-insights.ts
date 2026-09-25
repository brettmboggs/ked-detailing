import { Hono } from 'hono';
import type { AppEnv } from './app-env.ts';
import { requireOwner } from './auth.ts';

/**
 * Metrics and marketing insights, and the weekly AI summary. Mounted at /v1/crm/insights.
 * See docs/crm.md.
 */
export const insights = new Hono<AppEnv>();
insights.use('*', requireOwner);

/** Runs once a week from the Worker's cron (see `scheduled` in index.ts). */
export async function runWeekly(_env: AppEnv['Bindings']): Promise<void> {}
