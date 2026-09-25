import { Hono } from 'hono';
import type { AppEnv } from './app-env.ts';
import { requireOwner } from './auth.ts';

/**
 * Follow-ups: the daily rules that decide who to contact (rebook, review, win-back, quote chase, reminders), the to-do list, one-tap texts and automatic emails. Mounted at /v1/crm/follow-ups.
 * See docs/crm.md.
 */
export const followups = new Hono<AppEnv>();
followups.use('*', requireOwner);

/** Runs once a day from the Worker's cron (see `scheduled` in index.ts). */
export async function runDaily(_env: AppEnv['Bindings']): Promise<void> {}
