import { localDate } from '@ked/scheduling';
import { currentRules } from './booking.ts';
import { ApiError, now, type Bindings } from './lib.ts';

/**
 * Usage: is the app actually being used, and is anyone looking at the site?
 *
 * Owners: the iPhone app and the web admin check in when opened (or returned
 * to) and on each screen. A repeat of the same thing within THROTTLE_MIN is
 * dropped, so the log reads as visits, not taps. Only owners are tracked here.
 *
 * Website: page views per day and path, counted, with nothing stored about the
 * visitor (no IP, no cookie, no id). Views from a browser signed into the web
 * admin are counted apart, so an owner checking the site isn't "traffic".
 */

const THROTTLE_MIN = 10;
const KEEP_DAYS = 180;
const PATH = /^\/[A-Za-z0-9/_\-.[\]()]{0,150}$/;
const BOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|monitor/i;

/** `{ client: 'app' | 'admin', kind: 'open' | 'screen', path?, version? }` from a signed-in owner. */
export async function recordUsage(env: Bindings, who: string, body: Record<string, unknown>) {
  const client = body.client;
  const kind = body.kind;
  if (client !== 'app' && client !== 'admin') throw new ApiError(422, 'invalid', "client must be 'app' or 'admin'.");
  if (kind !== 'open' && kind !== 'screen') throw new ApiError(422, 'invalid', "kind must be 'open' or 'screen'.");
  const path = typeof body.path === 'string' && body.path.length <= 150 ? body.path : null;
  const version = typeof body.version === 'string' ? body.version.slice(0, 40) : null;
  const since = new Date(Date.now() - THROTTLE_MIN * 60e3).toISOString();
  await env.DB
    .prepare(
      `INSERT INTO usage_events (at, who, client, kind, path, version)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6
       WHERE NOT EXISTS (SELECT 1 FROM usage_events WHERE who = ?2 AND client = ?3 AND kind = ?4
                         AND COALESCE(path, '') = COALESCE(?5, '') AND at > ?7)`,
    )
    .bind(now(), who, client, kind, path, version, since)
    .run();
}

/** A page view on the public site: `{ path, owner? }`. Counted, never identified. */
export async function recordView(env: Bindings, req: Request) {
  if (BOT.test(req.headers.get('User-Agent') ?? '')) return;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return;
  }
  const b = body as { path?: unknown; owner?: unknown };
  const path = typeof b.path === 'string' ? b.path.split(/[?#]/)[0]! : '';
  if (!PATH.test(path)) return;
  const { rules } = await currentRules(env.DB);
  await env.DB
    .prepare(
      `INSERT INTO site_views (day, path, owner, views) VALUES (?, ?, ?, 1)
       ON CONFLICT (day, path, owner) DO UPDATE SET views = views + 1`,
    )
    .bind(localDate(new Date(), rules.timezone), path, b.owner === true ? 1 : 0)
    .run();
}

/** Old owner events go; the site's daily counts are small and stay. */
export async function pruneUsage(env: Bindings) {
  const before = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString();
  await env.DB.prepare('DELETE FROM usage_events WHERE at < ?').bind(before).run();
}

/** The Usage page: who's been in, how often, where, and the site's traffic. */
export async function usageReport(env: Bindings, days = 30) {
  const { rules } = await currentRules(env.DB);
  const tz = rules.timezone;
  const from = new Date(Date.now() - days * 864e5);
  const fromIso = from.toISOString();
  const fromDay = localDate(from, tz);
  const [people, daily, screens, recent, devices, site, pages] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare(
      `SELECT who, MAX(at) AS last_seen, COUNT(*) FILTER (WHERE kind = 'open') AS opens,
              (SELECT client FROM usage_events u2 WHERE u2.who = u.who ORDER BY at DESC LIMIT 1) AS last_client
       FROM usage_events u GROUP BY who ORDER BY last_seen DESC`,
    ),
    // Days are UTC dates here; close enough for a count per day.
    env.DB.prepare(
      `SELECT who, substr(at, 1, 10) AS day, COUNT(*) FILTER (WHERE kind = 'open') AS opens, COUNT(*) AS events
       FROM usage_events WHERE at >= ?1 GROUP BY who, day ORDER BY day`,
    ).bind(fromIso),
    env.DB.prepare(
      `SELECT who, client, path, COUNT(*) AS n FROM usage_events WHERE kind = 'screen' AND at >= ?1
       GROUP BY who, client, path ORDER BY n DESC LIMIT 40`,
    ).bind(fromIso),
    env.DB.prepare('SELECT at, who, client, kind, path, version FROM usage_events ORDER BY at DESC LIMIT 60'),
    env.DB.prepare('SELECT subject AS who, created_at, seen_at FROM devices ORDER BY seen_at DESC'),
    env.DB.prepare(
      `SELECT day, SUM(views) FILTER (WHERE owner = 0) AS views, SUM(views) FILTER (WHERE owner = 1) AS owner_views
       FROM site_views WHERE day >= ?1 GROUP BY day ORDER BY day`,
    ).bind(fromDay),
    env.DB.prepare(
      `SELECT path, SUM(views) AS views FROM site_views WHERE day >= ?1 AND owner = 0
       GROUP BY path ORDER BY views DESC LIMIT 25`,
    ).bind(fromDay),
  ]);
  type R = Record<string, unknown>;
  return {
    days,
    people: (people!.results as R[]).map((r) => ({
      who: r.who as string,
      lastSeen: r.last_seen as string,
      lastClient: r.last_client as string,
      opens: Number(r.opens),
    })),
    daily: (daily!.results as R[]).map((r) => ({ who: r.who as string, day: r.day as string, opens: Number(r.opens), events: Number(r.events) })),
    screens: (screens!.results as R[]).map((r) => ({ who: r.who as string, client: r.client as string, path: r.path as string, count: Number(r.n) })),
    recent: (recent!.results as R[]).map((r) => ({
      at: r.at as string,
      who: r.who as string,
      client: r.client as string,
      kind: r.kind as string,
      path: (r.path as string | null) ?? null,
      version: (r.version as string | null) ?? null,
    })),
    devices: (devices!.results as R[]).map((r) => ({ who: r.who as string, registeredAt: r.created_at as string, lastLaunch: r.seen_at as string })),
    site: {
      daily: (site!.results as R[]).map((r) => ({ day: r.day as string, views: Number(r.views ?? 0), ownerViews: Number(r.owner_views ?? 0) })),
      pages: (pages!.results as R[]).map((r) => ({ path: r.path as string, views: Number(r.views) })),
    },
  };
}
