import { h, $, when, api, sectionHead } from './core';

/**
 * Usage: who's been in the app and the admin, how often and where, and how
 * much the public website is seen. Data from GET /v1/usage (api/src/usage.ts).
 * Days on the charts are UTC dates, which is close enough for a count.
 */

interface Report {
  days: number;
  people: { who: string; lastSeen: string; lastClient: string; opens: number }[];
  daily: { who: string; day: string; opens: number; events: number }[];
  screens: { who: string; client: string; path: string; count: number }[];
  recent: { at: string; who: string; client: string; kind: string; path: string | null; version: string | null }[];
  devices: { who: string; registeredAt: string; lastLaunch: string }[];
  site: { daily: { day: string; views: number; ownerViews: number }[]; pages: { path: string; views: number }[] };
}

const stamp = (iso: string) => when(iso, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const CLIENT: Record<string, string> = { app: 'iPhone app', admin: 'web admin' };

/** "3 hours ago", "yesterday", "12 days ago". */
function ago(iso: string) {
  const mins = (Date.now() - Date.parse(iso)) / 60e3;
  if (mins < 2) return 'just now';
  if (mins < 60) return `${Math.round(mins)} minutes ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} hours ago`;
  const days = Math.round(mins / 1440);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/** The last `n` days as YYYY-MM-DD, oldest first (UTC, to match the data). */
function lastDays(n: number) {
  return Array.from({ length: n }, (_, i) => new Date(Date.now() - (n - 1 - i) * 864e5).toISOString().slice(0, 10));
}

/** A row of bars, one per day, with the count on hover. */
function bars(values: number[], labels: string[], color = 'bg-gold-500') {
  const max = Math.max(1, ...values);
  return h(
    'div',
    { class: 'flex h-16 items-end gap-[3px]', role: 'img', 'aria-label': `${values.reduce((a, b) => a + b, 0)} in ${values.length} days` },
    ...values.map((v, i) =>
      h('div', {
        class: `flex-1 ${v ? color : 'bg-ink-800'}`,
        style: `height:${v ? Math.max(8, (v / max) * 100) : 4}%`,
        title: `${labels[i]}: ${v}`,
      }),
    ),
  );
}

export async function renderUsage() {
  const view = $('[data-view="usage"]');
  const r = await api<Report>('/usage?days=30');
  const days = lastDays(30);

  const people = r.people.length
    ? h(
        'ul',
        { class: 'border-t border-ink-800' },
        ...r.people.map((p) => {
          const perDay = days.map((d) => r.daily.find((x) => x.who === p.who && x.day === d)?.opens ?? 0);
          return h(
            'li',
            { class: 'grid gap-4 border-b border-ink-800 py-5 sm:grid-cols-[1fr_16rem] sm:items-end' },
            h(
              'div',
              {},
              h('p', { class: 'text-bone-50' }, p.who),
              h('p', { class: 'mt-1 text-sm text-bone-200' }, `Last in ${ago(p.lastSeen)}, on the ${CLIENT[p.lastClient] ?? p.lastClient}`),
              h('p', { class: 'text-xs text-bone-500' }, `${stamp(p.lastSeen)} · ${p.opens} opens in all`),
            ),
            h('div', {}, bars(perDay, days), h('p', { class: 'mt-1 text-right text-xs text-bone-500' }, 'Opens per day, last 30 days')),
          );
        }),
      )
    : h('p', { class: 'text-bone-400' }, 'No one has opened the app or the admin since tracking started.');

  const screens = r.screens.length
    ? h(
        'ul',
        { class: 'border-t border-ink-800 text-sm' },
        ...r.screens.map((s) =>
          h(
            'li',
            { class: 'flex justify-between gap-4 border-b border-ink-800 py-2' },
            h('span', { class: 'text-bone-200' }, `${s.path} `, h('span', { class: 'text-bone-500' }, `· ${CLIENT[s.client] ?? s.client} · ${s.who}`)),
            h('span', { class: 'tabular-nums text-bone-50' }, String(s.count)),
          ),
        ),
      )
    : h('p', { class: 'text-sm text-bone-400' }, 'Nothing yet.');

  const recent = h(
    'ul',
    { class: 'border-t border-ink-800 text-sm' },
    ...r.recent.map((e) =>
      h(
        'li',
        { class: 'flex flex-wrap justify-between gap-x-4 border-b border-ink-800 py-2' },
        h('span', { class: 'text-bone-200' }, e.kind === 'open' ? `Opened the ${CLIENT[e.client] ?? e.client}` : e.path ?? 'screen', h('span', { class: 'text-bone-500' }, ` · ${e.who}`)),
        h('span', { class: 'text-bone-500' }, stamp(e.at)),
      ),
    ),
  );

  const devices = h(
    'ul',
    { class: 'border-t border-ink-800 text-sm' },
    ...r.devices.map((d) =>
      h(
        'li',
        { class: 'flex flex-wrap justify-between gap-x-4 border-b border-ink-800 py-2' },
        h('span', { class: 'text-bone-200' }, d.who),
        h('span', { class: 'text-bone-500' }, `Last launched ${ago(d.lastLaunch)} · set up ${when(d.registeredAt, { month: 'short', day: 'numeric' })}`),
      ),
    ),
  );

  const views = days.map((d) => r.site.daily.find((x) => x.day === d)?.views ?? 0);
  const ownerViews = days.map((d) => r.site.daily.find((x) => x.day === d)?.ownerViews ?? 0);
  const total = views.reduce((a, b) => a + b, 0);
  const site = h(
    'div',
    {},
    h('p', { class: 'text-sm text-bone-200' }, `${total} page views from customers and visitors in the last 30 days.`),
    h('div', { class: 'mt-3' }, bars(views, days)),
    h('p', { class: 'mt-4 text-sm text-bone-400' }, `Owners looking at the site: ${ownerViews.reduce((a, b) => a + b, 0)} views`),
    h('div', { class: 'mt-2' }, bars(ownerViews, days, 'bg-bone-400')),
    r.site.pages.length
      ? h(
          'ul',
          { class: 'mt-6 border-t border-ink-800 text-sm' },
          ...r.site.pages.map((p) =>
            h(
              'li',
              { class: 'flex justify-between gap-4 border-b border-ink-800 py-2' },
              h('span', { class: 'text-bone-200' }, p.path),
              h('span', { class: 'tabular-nums text-bone-50' }, String(p.views)),
            ),
          ),
        )
      : null,
  );

  view.replaceChildren(
    sectionHead('People', 'Every time the iPhone app or this admin is opened or come back to, and each screen, at most once per 10 minutes.'),
    people,
    sectionHead('Phones', 'Each phone signed into the app, and the last time the app was launched fresh on it.'),
    devices,
    sectionHead('Most used screens', 'Last 30 days.'),
    screens,
    sectionHead('Latest'),
    recent,
    sectionHead('Website', 'Page views, counted without cookies or anything about the visitor. Views from a browser signed into this admin are counted apart.'),
    site,
  );
}
