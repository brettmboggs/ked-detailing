/**
 * The Insights tab: every number Jacob needs to run the business on purpose,
 * each with what to do about it (docs/crm.md). Opens with the weekly note and
 * "Do these next" (always from the last 90 days), then a period picker that
 * scopes every section below it: Money, Customers, Leads and sources, Where,
 * What's ahead and Marketing spend.
 */
import { $, h, api, small, checkbox } from './core';
import { dateInput, labelled, select } from './books-lib';
import { type Insights, type Summary, range } from './insights-lib';
import { actionsBlock, noteBlock } from './insights-note';
import { moneySection, pipelineSection } from './insights-money';
import { customersSection, sourcesSection, whereSection } from './insights-people';
import { spendSection } from './insights-spend';

const TZ = 'America/Chicago';
const todayLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const shift = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

type Key = 'this-month' | 'last-month' | '90' | 'this-year' | '12' | 'custom';
const PERIODS: [Key, string][] = [
  ['this-month', 'This month'],
  ['last-month', 'Last month'],
  ['90', 'Last 90 days'],
  ['this-year', 'This year'],
  ['12', 'Last 12 months'],
  ['custom', 'Pick dates…'],
];

/** Kept while Jacob moves between tabs. */
const state: { key: Key; from: string; to: string; compare: boolean } = { key: '90', from: '', to: '', compare: true };

function periodFor(key: Key): { from: string; to: string } {
  const t = todayLocal();
  const first = `${t.slice(0, 8)}01`;
  switch (key) {
    case 'this-month':
      return { from: first, to: t };
    case 'last-month': {
      const end = shift(first, -1);
      return { from: `${end.slice(0, 8)}01`, to: end };
    }
    case 'this-year':
      return { from: `${t.slice(0, 4)}-01-01`, to: t };
    case '12':
      return { from: shift(t, -364), to: t };
    case 'custom':
      return { from: state.from || shift(t, -89), to: state.to || t };
    default:
      return { from: shift(t, -89), to: t };
  }
}

const view = () => $('[data-view="insights"]');

export async function renderInsights() {
  const top = h('div');
  const sections = h('div', { class: 'transition-opacity' });

  const t = todayLocal();
  const last90 = { from: shift(t, -89), to: t };
  const [summary, base] = await Promise.all([
    api<{ summaries: Summary[]; claude: boolean }>('/crm/insights/summary?limit=1'),
    api<Insights>(`/crm/insights?from=${last90.from}&to=${last90.to}`),
  ]);

  const drawTop = (s: { summaries: Summary[]; claude: boolean }): void =>
    top.replaceChildren(
      noteBlock(s.summaries, s.claude, async () => drawTop(await api<{ summaries: Summary[]; claude: boolean }>('/crm/insights/summary?limit=1'))),
      actionsBlock(base.actions, range(base.period.from, base.period.to)),
    );
  drawTop(summary);

  /* ---- the period picker, one row above everything it scopes */
  const period = select(PERIODS, state.key);
  const p0 = periodFor(state.key);
  const from = dateInput(state.from || p0.from);
  const to = dateInput(state.to || p0.to);
  const custom = h('div', { class: 'grid grid-cols-2 gap-3', hidden: state.key !== 'custom' }, labelled('From', from), labelled('To', to));
  const compare = checkbox('Compare with the period before', () => state.compare, (v) => {
    state.compare = v;
    void load();
  });
  const shown = h('p', { class: `${small} mt-1` });

  let seq = 0;
  async function load(first?: Insights) {
    state.key = period.value as Key;
    custom.hidden = state.key !== 'custom';
    if (state.key === 'custom') {
      state.from = from.value;
      state.to = to.value;
    }
    const r = periodFor(state.key);
    if (!r.from || !r.to || r.from > r.to) {
      shown.textContent = 'Pick a start date before the end date.';
      return;
    }
    const mine = ++seq;
    // Refetch keeps the frame: the old numbers dim until the new ones land.
    sections.classList.add('opacity-50');
    try {
      const d =
        first ??
        (await api<Insights>(`/crm/insights?from=${r.from}&to=${r.to}${state.compare ? '' : '&compare=0'}`));
      if (mine !== seq) return;
      shown.textContent = `${range(d.period.from, d.period.to)}${d.period.compare ? `, compared with ${range(d.period.compare.from, d.period.compare.to)}` : ''}`;
      sections.replaceChildren(
        moneySection(d),
        customersSection(d),
        sourcesSection(d),
        whereSection(d),
        pipelineSection(d),
        spendSection(d, () => load()),
      );
    } catch (err) {
      if (mine === seq) sections.replaceChildren(h('p', { class: 'mt-6 text-red-300' }, (err as Error).message));
    } finally {
      if (mine === seq) sections.classList.remove('opacity-50');
    }
  }
  for (const el of [period, from, to]) el.addEventListener('change', () => void load());

  view().replaceChildren(
    top,
    h(
      'div',
      { class: 'mt-16 border-y border-ink-700 py-5' },
      h('div', { class: 'flex flex-wrap items-end gap-x-8 gap-y-3' }, labelled('Show me', period, 'w-full max-w-xs'), custom, h('div', { class: 'pb-2' }, compare)),
      shown,
    ),
    h('div', { class: 'mt-12' }, sections),
  );

  // The default period is the same last 90 days: no second request.
  const reuse = state.key === '90' && state.compare ? base : undefined;
  await load(reuse);
}
