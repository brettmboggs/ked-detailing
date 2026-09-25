import { now, ulid } from './lib.ts';

/**
 * The customer timeline (the `activities` table). Anything that happens with a
 * customer that isn't already a job, invoice or payment goes here: notes,
 * calls, texts Jacob sent from a follow-up, emails the system sent, review
 * asks. See docs/crm.md.
 */
export const ACTIVITY_KINDS = ['note', 'call', 'text', 'email', 'review_request', 'referral', 'system'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export interface NewActivity {
  customerId?: string | null;
  leadId?: string | null;
  jobId?: string | null;
  kind: ActivityKind;
  body?: string | null;
  meta?: Record<string, unknown>;
  /** Owner email/sub, or 'system'. */
  by: string;
}

export function activityStatement(db: D1Database, a: NewActivity) {
  return db
    .prepare(
      `INSERT INTO activities (id, customer_id, lead_id, job_id, kind, body, meta, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(ulid(), a.customerId ?? null, a.leadId ?? null, a.jobId ?? null, a.kind, a.body ?? null, a.meta ? JSON.stringify(a.meta) : null, now(), a.by);
}

export async function logActivity(db: D1Database, a: NewActivity) {
  await activityStatement(db, a).run();
}
