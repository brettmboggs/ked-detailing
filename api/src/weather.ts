import { localDate, zipOf, zipPoint } from '@ked/scheduling';
import { currentRules } from './booking.ts';
import { getBrand } from './brand.ts';
import { now, ulid, type Bindings } from './lib.ts';
import { weatherWarned } from './notify.ts';

/**
 * The rain nudge. Twice a day it reads the National Weather Service's hourly
 * forecast (free, no key) for every job booked in the next three days. A job
 * with rain likely while Jacob is there becomes a follow-up on his list: a
 * ready text offering the customer their link to pick another time.
 *
 * It never moves, cancels or messages anything by itself. Jacob decides:
 * send the text, move the job himself, or skip it. If the forecast clears, or
 * the job moves, the nudge is taken off his list again.
 *
 * Forecasts are by ZIP center, which is plenty for "will it rain on the
 * driveway". The free plan allows 50 outside requests per run, so at most
 * MAX_PLACES ZIPs are looked up (two requests the first time, one after).
 */

const NWS = 'https://api.weather.gov';
/** At or above this chance of rain during the job, Jacob hears about it. */
export const RAIN_LIKELY = 50;
/** An open nudge stays up until the chance drops below this, so it doesn't flicker. */
const RAIN_CLEARED = 30;
const LOOK_AHEAD_HOURS = 72;
const MAX_PLACES = 15;

interface JobRow {
  id: string;
  start_at: string;
  end_at: string;
  zip: string | null;
  address: string;
  quote: string;
  manage_token: string;
  customer_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  text_ok: number;
  email_ok: number;
}

interface Period {
  startTime: string;
  endTime: string;
  probabilityOfPrecipitation?: { value: number | null };
  shortForecast?: string;
}

export interface Rain {
  chance: number;
  at: string;
  summary: string;
}

async function nws(env: Bindings, url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: 'application/geo+json', 'User-Agent': `(ked-api, ${env.SITE_URL || 'https://www.kedservice.com'})` },
  });
  if (!res.ok) throw new Error(`NWS ${res.status} for ${url}`);
  return res.json();
}

/** The worst hour of rain between start and end, or null if the forecast doesn't reach it. */
export function rainDuring(periods: Period[], start: string, end: string): Rain | null {
  const s = Date.parse(start);
  const e = Date.parse(end);
  let worst: Rain | null = null;
  for (const p of periods) {
    if (Date.parse(p.endTime) <= s || Date.parse(p.startTime) >= e) continue;
    const chance = p.probabilityOfPrecipitation?.value ?? 0;
    if (!worst || chance > worst.chance) worst = { chance, at: p.startTime, summary: p.shortForecast ?? '' };
  }
  return worst;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || 'there';

function serviceName(quote: string) {
  try {
    const label = (JSON.parse(quote) as { lines?: { label: string }[] }).lines?.[0]?.label;
    return (label ?? 'detail').split(' — ')[0]!.replace(/^the\s+/i, '');
  } catch {
    return 'detail';
  }
}

export interface WeatherRun {
  checked: number;
  atRisk: { jobId: string; chance: number; at: string }[];
  created: number;
  cleared: number;
  failed: number;
}

export async function runWeather(env: Bindings, at = new Date()): Promise<WeatherRun> {
  const db = env.DB;
  const base = (env.WEATHER_URL || NWS).replace(/\/$/, '');
  const until = new Date(at.getTime() + LOOK_AHEAD_HOURS * 36e5).toISOString();
  const [jobs, open] = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        `SELECT j.id, j.start_at, j.end_at, j.zip, j.address, j.quote, j.manage_token, c.id AS customer_id, c.name, c.phone,
                c.email, c.text_ok, c.email_ok
         FROM jobs j JOIN customers c ON c.id = j.customer_id
         WHERE j.status = 'scheduled' AND j.start_at > ?1 AND j.start_at < ?2
         ORDER BY j.start_at LIMIT 40`,
      )
      .bind(at.toISOString(), until),
    db.prepare("SELECT id, rule_key, job_id FROM follow_ups WHERE status = 'open' AND rule_key LIKE 'weather:%'"),
  ]);
  const rows = jobs!.results as unknown as JobRow[];
  const openNudges = open!.results as { id: string; rule_key: string; job_id: string | null }[];
  const out: WeatherRun = { checked: 0, atRisk: [], created: 0, cleared: 0, failed: 0 };

  // One forecast per ZIP.
  const byZip = new Map<string, JobRow[]>();
  for (const j of rows) {
    const zip = zipOf(j.zip, j.address);
    if (!zip || !zipPoint(zip)) continue;
    byZip.set(zip, [...(byZip.get(zip) ?? []), j]);
  }
  const zips = [...byZip.keys()].slice(0, MAX_PLACES);
  const cached = zips.length
    ? (
        await db
          .prepare('SELECT zip, forecast_url FROM weather_grid WHERE zip IN (SELECT value FROM json_each(?))')
          .bind(JSON.stringify(zips))
          .all<{ zip: string; forecast_url: string }>()
      ).results
    : [];
  const gridUrl = new Map(cached.map((r) => [r.zip, r.forecast_url]));
  const newGrid: { zip: string; url: string }[] = [];

  const rain = new Map<string, Rain | null>(); // job id → worst hour; absent if the lookup failed
  await Promise.all(
    zips.map(async (zip) => {
      try {
        let url = gridUrl.get(zip);
        if (!url) {
          const p = zipPoint(zip)!;
          const point = (await nws(env, `${base}/points/${p.lat.toFixed(4)},${p.lng.toFixed(4)}`)) as { properties?: { forecastHourly?: string } };
          url = point.properties?.forecastHourly;
          if (!url) throw new Error(`no forecast for ${zip}`);
          newGrid.push({ zip, url });
        }
        // Tests point WEATHER_URL at a fake; the real grid URL is absolute.
        const forecast = (await nws(env, url.replace(NWS, base))) as { properties?: { periods?: Period[] } };
        const periods = forecast.properties?.periods ?? [];
        for (const j of byZip.get(zip)!) {
          rain.set(j.id, rainDuring(periods, j.start_at, j.end_at));
          out.checked++;
        }
      } catch (err) {
        console.error('weather lookup failed', err);
        out.failed += byZip.get(zip)!.length;
      }
    }),
  );

  const { rules } = await currentRules(db);
  const brand = await getBrand(env);
  const tz = rules.timezone;
  const when = (iso: string) =>
    new Date(iso).toLocaleString('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric' });
  const dayName = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: tz, weekday: 'long' });
  const clock = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).replace(':00', '');

  const today = localDate(at, tz);
  const nudges: Record<string, unknown>[] = [];
  const keep = new Set<string>();
  for (const j of rows) {
    const r = rain.get(j.id);
    const key = `weather:${j.id}:${j.start_at}`;
    if (r === undefined) {
      keep.add(key); // couldn't check: leave any open nudge alone
      continue;
    }
    if (r && r.chance >= RAIN_CLEARED) keep.add(key);
    if (!r || r.chance < RAIN_LIKELY) continue;
    out.atRisk.push({ jobId: j.id, chance: r.chance, at: r.at });
    const service = serviceName(j.quote);
    const link = `${env.MANAGE_URL}?b=${j.manage_token}`;
    const channel = j.phone && j.text_ok ? 'text' : j.email && j.email_ok ? 'email' : j.phone ? 'call' : null;
    nudges.push({
      id: ulid(),
      customerId: j.customer_id,
      jobId: j.id,
      dueDate: today,
      channel,
      title: `Rain likely ${when(r.at)} (${r.chance}%): ${j.name}, ${service}`,
      subject: `Rain in the forecast for your ${service}`,
      message:
        `Hi ${firstName(j.name)}, it's ${brand.owner} with ${brand.name}. The forecast shows rain ${dayName(r.at)} around ${clock(r.at)} ` +
        `(${r.chance}% chance), right when I'm due for your ${service}. Want to move it? Pick another time here: ${link}\n\n` +
        `Or just text me back. If it clears up, I'll see you as planned.`,
      ruleKey: key,
    });
  }

  const stale = openNudges.filter((n) => !keep.has(n.rule_key)).map((n) => n.id);
  const stamp = now();
  const writes: D1PreparedStatement[] = [];
  if (newGrid.length) {
    writes.push(
      db
        .prepare(
          `INSERT OR REPLACE INTO weather_grid (zip, forecast_url, fetched_at)
           SELECT json_extract(x.value, '$.zip'), json_extract(x.value, '$.url'), ?2 FROM json_each(?1) x`,
        )
        .bind(JSON.stringify(newGrid), stamp),
    );
  }
  if (stale.length) {
    writes.push(
      db
        .prepare(
          // Deleted, not skipped: a key is used once ever, and rain can come back.
          // One Jacob skipped himself isn't open, so it stays skipped.
          `DELETE FROM follow_ups WHERE status = 'open' AND id IN (SELECT value FROM json_each(?1))`,
        )
        .bind(JSON.stringify(stale)),
    );
    out.cleared = stale.length;
  }
  const insertAt = writes.length;
  if (nudges.length) {
    writes.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO follow_ups (id, customer_id, job_id, kind, due_date, status, channel, title, message, subject, rule_key,
                                             created_at, updated_at)
           SELECT json_extract(x.value, '$.id'), json_extract(x.value, '$.customerId'), json_extract(x.value, '$.jobId'), 'custom',
                  json_extract(x.value, '$.dueDate'), 'open', json_extract(x.value, '$.channel'), json_extract(x.value, '$.title'),
                  json_extract(x.value, '$.message'), json_extract(x.value, '$.subject'), json_extract(x.value, '$.ruleKey'), ?2, ?2
           FROM json_each(?1) x
           RETURNING job_id, title`,
        )
        .bind(JSON.stringify(nudges), stamp),
    );
  }
  if (writes.length) {
    const results = await db.batch<{ job_id: string; title: string }>(writes);
    const made = nudges.length ? results[insertAt]!.results : [];
    out.created = made.length;
    if (made.length) await weatherWarned(env, made.map((m) => ({ jobId: m.job_id, title: m.title })));
  }
  return out;
}
