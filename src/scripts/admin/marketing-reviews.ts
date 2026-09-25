/**
 * Marketing → Reviews: the link people use to leave a review, a QR code for
 * a card, and who to ask: recent finished jobs whose customer hasn't been
 * asked. The Today list also makes review follow-ups on its own; this is the
 * by-hand view, and an ask from either place counts for both.
 */
import { original } from '../../lib/site-content';
import { h, api, input, small } from './core';
import { qrBlock } from './marketing-links';
import { type MarketingCtx, M, button, copyButton, firstName, isPhone, note, part, plainDate, quiet, shortDate, smsHref, goldSmall } from './marketing-shared';

interface Reviews {
  reviewUrl: string | null;
  siteReviewUrl: string | null;
  toAsk: { jobId: string; customerId: string; name: string; phone: string | null; date: string; service: string; onToday: boolean }[];
  recent: { name: string | null; at: string }[];
}

export async function renderReviews(el: HTMLElement, _ctx: MarketingCtx) {
  const r = await api<Reviews>(`${M}/reviews`);
  let link = r.reviewUrl ?? r.siteReviewUrl ?? original.reviews.url;

  const ask = (name: string) =>
    `Hi ${firstName(name)}, it's Jacob with Knock Em' Down. Thanks for letting me work on your car! If you're happy with it, a quick review helps my small business a lot: ${link} Thank you!`;

  /* ------------------------------------------------------------ the link */

  const linkIn = h('input', { class: input, type: 'url', maxlength: 300, 'aria-label': 'Review link' }) as HTMLInputElement;
  linkIn.value = link;
  const qrArea = h('div', { class: 'mt-6' });
  const drawQr = () => qrArea.replaceChildren(qrBlock(link, 'ked-review-qr', 'For the back of a card, or a small sign on the dash when you hand back the keys.'));
  drawQr();
  const saveLink = button('Save', async () => {
    const res = await api<{ settings: { reviewUrl: string | null }; siteReviewUrl: string | null }>(`${M}/settings`, { method: 'PUT', body: { reviewUrl: linkIn.value.trim() || null } });
    link = res.settings.reviewUrl ?? res.siteReviewUrl ?? original.reviews.url;
    linkIn.value = link;
    drawQr();
    drawList();
    return 'Saved.';
  });

  /* ------------------------------------------------------------ who to ask */

  const listEl = h('div', {});
  const people = [...r.toAsk];
  const phone = isPhone();

  const asked = async (jobId: string, how: 'text' | 'in_person') => {
    await api(`${M}/reviews/asked`, { method: 'POST', body: { jobId, how } });
    const i = people.findIndex((p) => p.jobId === jobId);
    if (i >= 0) people.splice(i, 1);
  };

  function drawList() {
    listEl.replaceChildren(
      people.length
        ? h(
            'ul',
            { class: 'border-t border-ink-800' },
            ...people.map((p) => {
              const li = h('li', { class: 'grid gap-x-6 gap-y-2 border-b border-ink-800 py-4 sm:grid-cols-[1fr_auto] sm:items-center' });
              const done = (how: string) => {
                li.replaceChildren(h('p', { class: 'text-sm text-bone-400' }, `${p.name}: asked ${how}.`));
              };
              const textIt = p.phone
                ? phone
                  ? h(
                      'a',
                      {
                        href: smsHref(p.phone, ask(p.name)),
                        class: goldSmall,
                        onclick: () => void asked(p.jobId, 'text').then(() => done('by text')),
                      },
                      `Text ${firstName(p.name)}`,
                    )
                  : h(
                      'span',
                      { class: 'flex flex-wrap items-center gap-x-5 gap-y-2' },
                      copyButton(() => ask(p.name), 'Copy the text'),
                      button('Mark asked', async () => {
                        await asked(p.jobId, 'text');
                        done('by text');
                      }).btn,
                    )
                : null;
              li.append(
                h(
                  'div',
                  {},
                  h('p', { class: 'font-semibold text-bone-50' }, p.name),
                  h(
                    'p',
                    { class: 'text-sm text-bone-400' },
                    `${p.service} · ${plainDate(p.date, { weekday: 'short', month: 'short', day: 'numeric' })}`,
                    p.onToday ? h('span', { class: 'text-gold-400' }, ' · also on your Today list') : '',
                  ),
                ),
                h(
                  'div',
                  { class: 'flex flex-wrap items-center gap-x-5 gap-y-2' },
                  textIt,
                  h(
                    'button',
                    {
                      type: 'button',
                      class: quiet,
                      onclick: () => void asked(p.jobId, 'in_person').then(() => done('in person')),
                    },
                    'Asked in person',
                  ),
                ),
              );
              return li;
            }),
          )
        : h('p', { class: 'text-bone-500' }, "You're all caught up. Everyone from the last two months has been asked."),
    );
  }
  drawList();

  el.replaceChildren(
    h(
      'p',
      { class: 'mb-8 max-w-2xl border-l-2 border-gold-500 pl-4 text-bone-200' },
      'Reviews are how new people pick you on Google. The best time to ask is the same day, while they still love how the car looks.',
    ),
    part(
      'Who to ask',
      `Your jobs from the last two months where nobody has asked for a review yet.${phone ? ' Tap Text and Messages opens with the ask written for you.' : ' On your phone, Text opens Messages with the ask written for you.'}`,
      listEl,
    ),
    part(
      'Your review link',
      'Where the ask sends people. For Google, open your Business Profile, tap "Ask for reviews", and paste that link here.',
      h('div', { class: 'flex max-w-2xl flex-col gap-3' }, h('label', { class: 'flex flex-col gap-1' }, h('span', { class: small }, 'Review link'), linkIn), h('div', { class: 'flex flex-wrap items-center gap-5' }, saveLink.row, copyButton(() => link, 'Copy link'))),
      qrArea,
    ),
    r.recent.length
      ? part(
          'Asked lately',
          null,
          h(
            'ul',
            { class: 'max-w-xl text-sm' },
            ...r.recent.map((a) => h('li', { class: 'flex justify-between gap-6 border-b border-ink-800 py-2' }, h('span', { class: 'text-bone-200' }, a.name ?? 'Someone'), h('span', { class: 'text-bone-500' }, shortDate(a.at)))),
          ),
        )
      : '',
    note('Answer every review you get, good or bad, within a day or two. Thank them by name and say what you did.'),
  );
}
