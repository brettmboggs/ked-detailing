/**
 * The top of Insights: the weekly note (written by Claude, or from the rules
 * when it isn't set up) and "Do these next", the ranked steps with the number
 * behind each and a button to the place to do it.
 */
import { h, api, small, heading, headingStyle, when } from './core';
import { goldSmall, goTab } from './calendar-shared';
import { statusLine, textBtn } from './books-lib';
import { type Action, type Summary, usd } from './insights-lib';

/** Hands a segment to whichever tab can use it (Customers or Marketing may read it). */
export const SEGMENT_KEY = 'ked-insights-segment';

export function go(target: Action['target']) {
  try {
    if (target.segment) sessionStorage.setItem(SEGMENT_KEY, JSON.stringify(target.segment));
    else sessionStorage.removeItem(SEGMENT_KEY);
  } catch {
    // fine: the tab still opens
  }
  if (target.tab === 'insights') {
    const el = document.querySelector<HTMLElement>('[data-insights-sources]');
    // Lenis owns scrolling on this site: ask it first.
    if (el && document.dispatchEvent(new CustomEvent('ked:scroll-to', { detail: el, cancelable: true }))) el.scrollIntoView({ block: 'start' });
    return;
  }
  goTab(target.tab);
}

const WORDS: Record<Action['type'], string> = {
  reviews: 'Reviews',
  rebook: 'Bring them back',
  area: 'Where to market',
  pricing: 'Prices',
  schedule: 'Your calendar',
  channel: 'Where leads come from',
  referral: 'Referrals',
  upsell: 'Add-ons',
  leads: 'Quote requests',
};

export function actionsBlock(actions: Action[], periodText: string) {
  return h(
    'section',
    { class: 'mt-12' },
    h('h2', { class: `${heading} border-b border-ink-700 pb-2`, style: headingStyle }, 'Do these next'),
    h('p', { class: 'mt-3 max-w-3xl text-sm text-bone-400' }, `From your numbers for ${periodText}, most money first. Each one says the number behind it.`),
    actions.length
      ? h(
          'ul',
          { class: 'mt-4 border-t border-ink-700' },
          ...actions.map((a) =>
            h(
              'li',
              { class: 'grid gap-x-8 gap-y-3 border-b border-ink-800 py-5 sm:grid-cols-[1fr_auto]' },
              h(
                'div',
                { class: 'min-w-0' },
                h('p', { class: `${small} text-gold-400` }, WORDS[a.type]),
                h('p', { class: 'mt-1 text-base font-semibold text-bone-50' }, a.title),
                h('p', { class: 'mt-1 text-sm text-bone-400' }, a.detail),
              ),
              h(
                'div',
                { class: 'flex flex-row items-center justify-between gap-4 sm:flex-col sm:items-end sm:justify-start' },
                a.impact !== null
                  ? h(
                      'p',
                      { class: 'text-sm sm:text-right' },
                      h('span', { class: 'font-display text-lg text-bone-50', style: "font-variation-settings:'wdth' 80,'wght' 750" }, `About ${usd(a.impact)}`),
                      a.impactNote ? h('span', { class: 'block text-xs text-bone-500' }, a.impactNote) : null,
                    )
                  : h('span'),
                h('button', { type: 'button', class: `${goldSmall} whitespace-nowrap`, onclick: () => go(a.target) }, `${a.target.label} →`),
              ),
            ),
          ),
        )
      : h('p', { class: 'mt-4 text-bone-400' }, 'Nothing needs doing from these numbers. Pick a longer period to see more.'),
  );
}

/** The latest weekly note, and a button to write a fresh one. */
export function noteBlock(summaries: Summary[], claude: boolean, reload: () => Promise<void>) {
  const latest = summaries[0];
  const status = statusLine();
  const make = h('button', { type: 'button', class: textBtn }, latest ? 'Write a new one now' : 'Write this week’s note now') as HTMLButtonElement;
  make.addEventListener('click', () =>
    status.run(make, async () => {
      await api('/crm/insights/summary', { method: 'POST' });
      await reload();
    }),
  );

  const by = latest
    ? latest.source === 'claude'
      ? 'Written by Claude from your numbers. Check anything that looks off against the numbers below.'
      : latest.note ?? 'Built from your numbers.'
    : claude
      ? 'A note arrives every Monday morning, by email too.'
      : 'Every Monday morning a note is built from your numbers and emailed to you.';

  return h(
    'section',
    { class: 'border-y border-ink-700 py-6' },
    h(
      'div',
      { class: 'flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1' },
      h('h2', { class: heading, style: headingStyle }, 'Your week'),
      latest ? h('p', { class: small }, `${shortWeek(latest.weekStart, latest.weekEnd)} · ${when(latest.createdAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`) : null,
    ),
    latest
      ? h('div', { class: 'mt-4 flex max-w-3xl flex-col gap-4 text-bone-200' }, ...noteParagraphs(latest.body))
      : h('p', { class: 'mt-4 max-w-3xl text-bone-400' }, 'No weekly note yet.'),
    h('p', { class: 'mt-4 max-w-3xl text-xs text-bone-500' }, by),
    h('div', { class: 'mt-3 flex flex-wrap items-center gap-4' }, make, status.el),
  );
}

const shortWeek = (a: string, b: string) => {
  const f = (d: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(`${d}T12:00:00Z`));
  return `Week of ${f(a)} to ${f(b)}`;
};

/** The note is plain text: a label line ends in a colon, list lines start with "- ". */
function noteParagraphs(body: string) {
  return body
    .trim()
    .split(/\n\s*\n/)
    // The rules note ends with why Claude didn't write it; the byline says that.
    .filter((block) => !/^\(.*\)$/s.test(block.trim()))
    .map((block) => {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      const label = lines[0]?.endsWith(':') ? lines.shift()! : null;
      const items = lines.filter((l) => /^[-•*]\s/.test(l));
      const rest = lines.filter((l) => !/^[-•*]\s/.test(l));
      return h(
        'div',
        {},
        label ? h('p', { class: 'font-display text-sm uppercase tracking-[0.14em] text-gold-400' }, label.replace(/:$/, '')) : null,
        rest.length ? h('p', { class: label ? 'mt-1' : '' }, rest.join(' ')) : null,
        items.length ? h('ul', { class: 'mt-1 flex flex-col gap-1.5 border-l border-ink-700 pl-4' }, ...items.map((i) => h('li', {}, i.replace(/^[-•*]\s+/, '')))) : null,
      );
    });
}
