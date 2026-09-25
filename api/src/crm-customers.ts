import { Hono } from 'hono';
import type { AppEnv } from './app-env.ts';
import { requireOwner } from './auth.ts';
import { readSegment, segmentCustomers } from './crm-segments.ts';
import { ApiError } from './lib.ts';

/**
 * Customer records beyond the basics: tags, notes and the timeline, referral codes, consent, segments. Mounted at /v1/crm/customers.
 * See docs/crm.md.
 */
export const customers = new Hono<AppEnv>();
customers.use('*', requireOwner);

/**
 * Customers with their numbers, filtered and sorted by a segment passed as
 * JSON in ?segment= (see crm-segments.ts). Leads without a job are included.
 */
customers.get('/', async (c) => {
  let raw: unknown = {};
  try {
    raw = JSON.parse(c.req.query('segment') || '{}');
  } catch {
    throw new ApiError(422, 'invalid_segment', 'segment must be JSON.');
  }
  return c.json({ customers: await segmentCustomers(c.env.DB, readSegment(raw)) });
});
