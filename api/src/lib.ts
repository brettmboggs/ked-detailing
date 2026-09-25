import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** Secrets aren't in wrangler.jsonc, so `wrangler types` can't see them. */
export type Bindings = Env & {
  ADMIN_TOKEN?: string;
  /** Cloudflare Pages deploy hook. Rebuilds the site so /quote shows new prices. */
  PAGES_DEPLOY_HOOK?: string;
  /** R2 for photos, if the account ever enables it. KV (PHOTO_KV) otherwise. */
  PHOTOS?: R2Bucket;
  /** "on" to email customers. Needs the Workers Paid plan. */
  CUSTOMER_EMAIL?: string;
  /** Tests point this away from Expo. */
  EXPO_PUSH_URL?: string;
  /** Tests set "1" to get the sign-in link in the response instead of only by email. */
  TEST_LOGIN_LINKS?: string;
  /** Tests set "1" to get each response's query count in X-D1-Queries. */
  COUNT_QUERIES?: string;
};

/**
 * The free Workers plan caps a request at 50 D1 queries, counting every
 * statement in a batch, and local dev doesn't enforce it. This wraps the
 * database to count, so tests can hold heavy endpoints under the cap.
 */
export function countingDb(db: D1Database, count: { n: number }): D1Database {
  const wrap = (stmt: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(stmt, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== 'function') return value;
        if (prop === 'bind') return (...args: unknown[]) => wrap(value.apply(target, args));
        if (['first', 'all', 'run', 'raw'].includes(prop as string)) {
          return (...args: unknown[]) => {
            count.n++;
            return value.apply(target, args);
          };
        }
        return value.bind(target);
      },
    });
  return new Proxy(db, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === 'prepare') return (sql: string) => wrap(target.prepare(sql));
      if (prop === 'batch') {
        return (stmts: D1PreparedStatement[]) => {
          count.n += stmts.length;
          return target.batch(stmts);
        };
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/** Thrown anywhere; rendered as the contract's error body by `onError`. */
export class ApiError extends HTTPException {
  constructor(
    status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly details?: string[],
  ) {
    super(status, { message });
  }
}

export const now = () => new Date().toISOString();

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** ULID: sortable by creation time, which is how every list is ordered. */
export function ulid(time = Date.now()): string {
  let out = '';
  for (let i = 9, t = time; i >= 0; i--, t = Math.floor(t / 32)) out = CROCKFORD[t % 32] + out;
  const random = crypto.getRandomValues(new Uint8Array(16));
  for (const byte of random) out += CROCKFORD[byte % 32];
  return out;
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Constant-time string compare, for the break-glass admin token. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const list = (csv: string) =>
  csv
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

/** Trimmed string or undefined; rejects anything over `max` characters. */
export function text(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new ApiError(422, 'invalid', `${field} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new ApiError(422, 'invalid', `${field} is too long.`);
  return trimmed || undefined;
}

export async function json(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new ApiError(400, 'bad_json', 'The request body must be a JSON object.');
}
