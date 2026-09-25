/**
 * The Marketing tab (docs/crm.md, part 4): campaigns, tracking links and QR
 * codes, the referral program, review asks, and the "find more leads"
 * playbook. Each part lives in its own marketing-*.ts file; this one draws
 * the switcher between them.
 */
import { $, h, heading, headingStyle } from './core';
import { renderCampaigns } from './marketing-campaigns';
import { renderLinks } from './marketing-links';
import { renderPlaybook } from './marketing-playbook';
import { renderReferrals } from './marketing-referrals';
import { renderReviews } from './marketing-reviews';
import type { MarketingCtx, MarketingPart, GoOpts } from './marketing-shared';

const PARTS: [MarketingPart, string][] = [
  ['campaigns', 'Campaigns'],
  ['links', 'Links & QR codes'],
  ['referrals', 'Referrals'],
  ['reviews', 'Reviews'],
  ['leads', 'Find more leads'],
];

/** Remembered while the page is open. */
let current: MarketingPart = 'campaigns';

export async function renderMarketing() {
  const view = $('[data-view="marketing"]');
  const body = h('div', { class: 'mt-8' });

  const nav = h(
    'div',
    { role: 'tablist', 'aria-label': 'Marketing', class: 'grid grid-cols-2 border-l border-t border-ink-700 sm:flex sm:w-fit' },
    ...PARTS.map(([key, label]) =>
      h(
        'button',
        {
          type: 'button',
          role: 'tab',
          'data-part': key,
          class:
            'border-b border-r border-ink-700 px-3 py-2.5 text-left text-sm text-bone-400 transition-colors hover:text-bone-50 sm:px-5 ' +
            'aria-selected:bg-ink-900 aria-selected:text-bone-50 aria-selected:shadow-[inset_0_-2px_0_var(--color-gold-500)] ' +
            'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold-400 ' +
            (key === 'leads' ? 'col-span-2 sm:col-span-1' : ''),
          onclick: () => go(key),
        },
        label,
      ),
    ),
  );

  const ctx: MarketingCtx = { go };

  function go(part: MarketingPart, opts: GoOpts = {}) {
    current = part;
    for (const b of nav.querySelectorAll<HTMLElement>('[data-part]')) b.setAttribute('aria-selected', String(b.dataset.part === part));
    body.replaceChildren(h('p', { class: 'text-bone-400' }, 'Loading…'));
    const draw = {
      campaigns: () => renderCampaigns(body, ctx, opts),
      links: () => renderLinks(body, ctx, opts),
      referrals: () => renderReferrals(body, ctx),
      reviews: () => renderReviews(body, ctx),
      leads: () => renderPlaybook(body, ctx),
    }[part];
    draw().catch((err: Error) => {
      body.replaceChildren(h('p', { class: 'border-l-2 border-red-400 pl-4 text-red-300', role: 'alert' }, err.message));
    });
  }

  view.replaceChildren(
    h(
      'div',
      { class: 'flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1' },
      h('h2', { class: heading, style: headingStyle }, 'Marketing'),
      h('p', { class: 'text-sm text-bone-400' }, 'Bring back old customers and find new ones.'),
    ),
    h('div', { class: 'mt-5' }, nav),
    body,
  );
  go(current);
}
