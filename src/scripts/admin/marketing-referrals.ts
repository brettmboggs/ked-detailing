/**
 * Marketing → Referrals: what people get for sending a friend, who has sent
 * the most (and what those friends spent), and any customer's own link.
 * A friend who first visits through someone's link (kedservice.com/?ref=CODE)
 * is tied to them when they ask for a price or book.
 */
import { h, api, input, small, dollars } from './core';
import { type Campaign, type MarketingCtx, M, button, copyButton, firstName, goldSmall, isPhone, part, plural, quiet, smsHref } from './marketing-shared';

interface Leader {
  id: string;
  name: string;
  phone: string | null;
  code: string | null;
  link: string | null;
  referred: number;
  becameCustomers: number;
  revenue: number;
}

interface Referrals {
  referrerGets: string;
  friendGets: string;
  leaders: Leader[];
  linked: number;
  saidFriend: number;
}

interface Found {
  id: string;
  name: string;
  phone: string | null;
}

export async function renderReferrals(el: HTMLElement, ctx: MarketingCtx) {
  const r = await api<Referrals>(`${M}/referrals`);
  const rewards = { referrerGets: r.referrerGets, friendGets: r.friendGets };

  /* ------------------------------------------------------------ rewards */

  const mine = h('input', { class: input, type: 'text', maxlength: 80, 'aria-label': 'Your customer gets' }) as HTMLInputElement;
  const theirs = h('input', { class: input, type: 'text', maxlength: 80, 'aria-label': 'Their friend gets' }) as HTMLInputElement;
  mine.value = r.referrerGets;
  theirs.value = r.friendGets;
  const saveRewards = button('Save', async () => {
    const res = await api<{ settings: { referrerGets: string; friendGets: string } }>(`${M}/settings`, {
      method: 'PUT',
      body: { referrerGets: mine.value, friendGets: theirs.value },
    });
    rewards.referrerGets = mine.value = res.settings.referrerGets;
    rewards.friendGets = theirs.value = res.settings.friendGets;
    return 'Saved.';
  });

  const shareText = (name: string, link: string) =>
    `Hey ${firstName(name)}, it's Jacob with Knock Em' Down. Here's your own link to share: ${link} Anyone who books through it gets ${rewards.friendGets}, and you get ${rewards.referrerGets}. Thanks!`;

  const contact = (name: string, phone: string | null, link: string) =>
    h(
      'span',
      { class: 'flex flex-wrap items-center gap-x-5 gap-y-2' },
      copyButton(() => link, 'Copy link'),
      phone && isPhone() ? h('a', { href: smsHref(phone, shareText(name, link)), class: quiet }, 'Text it to them') : null,
      phone && !isPhone() ? copyButton(() => shareText(name, link), 'Copy a text for them') : null,
    );

  /* ------------------------------------------------------------ leaderboard */

  const leaders = r.leaders.length
    ? h(
        'div',
        {},
        h(
          'div',
          { class: `hidden grid-cols-[1fr_6rem_6rem_7rem] gap-x-6 border-b border-ink-700 pb-2 sm:grid ${small}` },
          h('span', {}, 'Customer'),
          h('span', { class: 'text-right' }, 'Sent you'),
          h('span', { class: 'text-right' }, 'Booked'),
          h('span', { class: 'text-right' }, 'They spent'),
        ),
        h(
          'ul',
          {},
          ...r.leaders.map((l) =>
            h(
              'li',
              { class: 'border-b border-ink-800 py-3' },
              h(
                'div',
                { class: 'grid grid-cols-[1fr_auto] gap-x-6 gap-y-0.5 sm:grid-cols-[1fr_6rem_6rem_7rem]' },
                h('span', { class: 'font-semibold text-bone-50' }, l.name),
                h('span', { class: 'text-right tabular-nums text-bone-200' }, h('span', { class: 'sm:hidden text-bone-500' }, 'Sent '), String(l.referred)),
                h('span', { class: 'col-start-2 text-right tabular-nums text-bone-200 sm:col-start-auto' }, h('span', { class: 'sm:hidden text-bone-500' }, 'Booked '), String(l.becameCustomers)),
                h('span', { class: 'col-start-2 text-right tabular-nums text-gold-400 sm:col-start-auto' }, dollars(l.revenue)),
              ),
              l.link ? h('div', { class: 'mt-2' }, contact(l.name, l.phone, l.link)) : null,
            ),
          ),
        ),
      )
    : h('p', { class: 'text-bone-500' }, 'Nobody has come in through a referral link yet. Send your best customers theirs, below.');

  /* ------------------------------------------------------------ find a link */

  const search = h('input', { class: `${input} max-w-md`, type: 'search', placeholder: 'Name, phone or email', 'aria-label': 'Find a customer', autocomplete: 'off' }) as HTMLInputElement;
  const found = h('div', { class: 'mt-3' });
  let timer: ReturnType<typeof setTimeout> | undefined;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = search.value.trim();
      if (q.length < 2) return found.replaceChildren();
      const { customers } = await api<{ customers: Found[] }>(`/crm/customers?segment=${encodeURIComponent(JSON.stringify({ q, limit: 6, sort: 'name' }))}`);
      if (search.value.trim() !== q) return;
      found.replaceChildren(
        customers.length
          ? h(
              'ul',
              { class: 'max-w-2xl border-t border-ink-800' },
              ...customers.map((c) => {
                const li = h('li', { class: 'border-b border-ink-800 py-3' });
                const show = h(
                  'button',
                  {
                    type: 'button',
                    class: 'text-left font-semibold text-bone-50 hover:text-gold-400',
                    onclick: async () => {
                      const link = await api<{ link: string; phone: string | null; name: string }>(`${M}/referrals/${c.id}`);
                      li.replaceChildren(
                        h('p', { class: 'font-semibold text-bone-50' }, c.name),
                        h('p', { class: 'mt-1 break-all font-mono text-sm text-gold-400' }, link.link),
                        h('div', { class: 'mt-2' }, contact(c.name, link.phone, link.link)),
                      );
                    },
                  },
                  c.name,
                );
                li.append(show, h('span', { class: 'ml-3 text-sm text-bone-500' }, 'Show their link'));
                return li;
              }),
            )
          : h('p', { class: 'text-sm text-bone-500' }, `Nobody matches "${q}".`),
      );
    }, 250);
  });

  el.replaceChildren(
    h(
      'p',
      { class: 'mb-8 max-w-2xl border-l-2 border-gold-500 pl-4 text-bone-200' },
      "Every customer has their own link. When a friend asks for a price or books through it, you'll see who sent them, so you can thank them.",
    ),
    part(
      'Ask your best customers',
      'Makes a text list of your 25 best repeat customers, each with their own link and your offer written in. You can change it before it goes.',
      button(
        'Make the list',
        async () => {
          const c = await api<Campaign>(M, { method: 'POST', body: { template: 'referral' } });
          ctx.go('campaigns', { campaignId: c.id });
        },
        goldSmall,
      ).row,
    ),
    part(
      'What they get',
      'These words go into referral messages, like "They get $20 off their first detail." Give the reward once the friend\'s job is done.',
      h(
        'div',
        { class: 'grid max-w-3xl gap-4 sm:grid-cols-2' },
        h('label', { class: 'flex flex-col gap-1' }, h('span', { class: small }, 'Your customer gets'), mine),
        h('label', { class: 'flex flex-col gap-1' }, h('span', { class: small }, 'Their friend gets'), theirs),
      ),
      h('div', { class: 'mt-4' }, saveRewards.row),
    ),
    part(
      'Who sends you the most',
      r.linked ? `${plural(r.linked, 'person')} came in through a friend's link.` : null,
      leaders,
      r.saidFriend
        ? h(
            'p',
            { class: 'mt-5 max-w-2xl text-sm text-bone-400' },
            `${plural(r.saidFriend, 'more person', 'more people')} said a friend sent them but didn't use a link. Next time you see them, ask who, so you can thank the right person.`,
          )
        : null,
    ),
    part('Find anyone\'s link', 'Look up a customer to copy their link or text it to them.', search, found),
  );
}
