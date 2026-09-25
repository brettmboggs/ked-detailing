/**
 * Marketing → Find more leads: a to-do list for getting work, built from
 * Jacob's own jobs. Which streets and ZIPs to go back to, what fits this
 * time of year, which places to advertise he hasn't tried, and the free
 * habits that bring in work. Ticks are saved, so the list keeps track.
 */
import { h, api, dollars, clearError, showError } from './core';
import { type Campaign, type MarketingCtx, M, button, goldSmall, part, plainDate, plural, quiet, shortDate } from './marketing-shared';

interface Playbook {
  month: number;
  zips: { zip: string; town: string | null; jobs: number; customers: number; revenue: number; share: number }[];
  nearbyOpen: { zip: string; town: string; jobs: number }[];
  streets: { street: string; zip: string | null; town: string | null; jobs: number; customers: number; last: string }[];
  channels: { source: string; name: string; people: number; recent: number; booked: number; state: 'untried' | 'no-bookings' | 'working'; tryIt: string; links: number }[];
  seasons: { key: string; months: number[]; title: string; text: string; template?: string; now: boolean }[];
  checklist: { key: string; title: string; text: string; every: 'once' | 'week' | 'month'; doneAt: string | null; done: boolean }[];
}

const EVERY: Record<string, string> = { week: 'Every week', month: 'Every month', once: 'Once' };

export async function renderPlaybook(el: HTMLElement, ctx: MarketingCtx) {
  const p = await api<Playbook>(`${M}/playbook`);

  const startTemplate = (id: string, text = 'Write the message') =>
    button(
      text,
      async () => {
        const c = await api<Campaign>(M, { method: 'POST', body: { template: id } });
        ctx.go('campaigns', { campaignId: c.id });
      },
      goldSmall,
    ).btn;

  const place = (zip: string | null, town: string | null) => [town, zip].filter(Boolean).join(' ');

  /* ------------------------------------------------------------ this time of year */

  const seasons = p.seasons.length
    ? h(
        'ul',
        { class: 'border-t border-ink-800' },
        ...p.seasons.map((s) =>
          h(
            'li',
            { class: 'grid gap-x-6 gap-y-3 border-b border-ink-800 py-4 sm:grid-cols-[1fr_auto] sm:items-center' },
            h(
              'div',
              {},
              h(
                'p',
                { class: 'flex flex-wrap items-baseline gap-x-3' },
                h('span', { class: 'font-semibold text-bone-50' }, s.title),
                h('span', { class: `text-xs uppercase tracking-[0.14em] ${s.now ? 'text-gold-400' : 'text-bone-500'}` }, s.now ? 'Now' : 'Next month: get ready'),
              ),
              h('p', { class: 'mt-0.5 max-w-2xl text-sm text-bone-400' }, s.text),
            ),
            s.template ? startTemplate(s.template) : null,
          ),
        ),
      )
    : null;

  /* ------------------------------------------------------------ streets */

  const streets = p.streets.length
    ? h(
        'ul',
        { class: 'border-t border-ink-800' },
        ...p.streets.map((s) =>
          h(
            'li',
            { class: 'border-b border-ink-800 py-3' },
            h(
              'p',
              { class: 'text-bone-200' },
              "You've done ",
              h('span', { class: 'font-semibold text-bone-50' }, plural(s.jobs, 'job')),
              ' on ',
              h('span', { class: 'font-semibold text-bone-50' }, s.street),
              s.zip ? ` (${place(s.zip, s.town)})` : '',
              s.customers > 1 ? ` for ${s.customers} different customers.` : '.',
            ),
            h('p', { class: 'mt-0.5 text-sm text-bone-400' }, `Last one ${plainDate(s.last, { month: 'short', year: 'numeric' })}. Next time you're there, hang door hangers on the neighbors' doors.`),
          ),
        ),
      )
    : h('p', { class: 'text-bone-500' }, 'Once you have done two jobs on the same street, it shows up here.');

  /* ------------------------------------------------------------ ZIPs */

  const top = p.zips.slice(0, 2);
  const zipAdvice = top.length
    ? `${top.map((z) => place(z.zip, z.town)).join(' and ')} ${top.length > 1 ? 'are' : 'is'} ${top.reduce((s, z) => s + z.share, 0)}% of your work. Put door hangers, Nextdoor posts and Facebook town-group posts there first. People there already know someone you've done.`
    : null;
  const zips = p.zips.length
    ? h(
        'div',
        {},
        h(
          'ul',
          { class: 'max-w-2xl border-t border-ink-800' },
          ...p.zips.map((z) =>
            h(
              'li',
              { class: 'grid grid-cols-[1fr_auto] gap-x-6 gap-y-0.5 border-b border-ink-800 py-3 sm:grid-cols-[1fr_6rem_6rem_7rem]' },
              h('span', { class: 'text-bone-50' }, place(z.zip, z.town)),
              h('span', { class: 'text-right tabular-nums text-bone-200' }, plural(z.jobs, 'job')),
              h('span', { class: 'col-start-2 text-right tabular-nums text-bone-400 sm:col-start-auto' }, `${z.share}%`),
              h('span', { class: 'col-start-2 text-right tabular-nums text-gold-400 sm:col-start-auto' }, dollars(z.revenue)),
            ),
          ),
        ),
        p.nearbyOpen.length
          ? h(
              'p',
              { class: 'mt-5 max-w-2xl text-sm text-bone-400' },
              h('span', { class: 'text-bone-200' }, 'Close to home, barely touched: '),
              p.nearbyOpen.map((n) => `${n.town} (${n.zip})`).join(', '),
              '. Short drives mean more jobs in a day. Try a Facebook town-group post or door hangers there.',
            )
          : null,
      )
    : h('p', { class: 'text-bone-500' }, 'Once jobs have ZIP codes, your best areas show up here.');

  /* ------------------------------------------------------------ channels */

  const channelLine = (c: Playbook['channels'][number]) => {
    if (c.state === 'untried') return h('p', { class: 'text-bone-200' }, h('span', { class: 'font-semibold text-bone-50' }, c.name), ': no leads yet. ', h('span', { class: 'text-bone-400' }, c.tryIt));
    if (c.state === 'no-bookings')
      return h('p', { class: 'text-bone-200' }, h('span', { class: 'font-semibold text-bone-50' }, c.name), `: ${plural(c.people, 'person', 'people')}, none booked yet. `, h('span', { class: 'text-bone-400' }, c.tryIt));
    return h(
      'p',
      { class: 'text-bone-200' },
      h('span', { class: 'font-semibold text-bone-50' }, c.name),
      `: ${plural(c.people, 'person', 'people')}, ${c.booked} booked${c.recent ? ` (${c.recent} in the last year)` : ''}. Keep it going.`,
    );
  };
  const LINK_PRESET: Record<string, string> = { maps: 'maps', instagram: 'instagram', facebook: 'facebook', nextdoor: 'nextdoor', van: 'van' };
  const channels = h(
    'ul',
    { class: 'border-t border-ink-800' },
    ...p.channels.map((c) =>
      h(
        'li',
        { class: 'grid gap-x-6 gap-y-2 border-b border-ink-800 py-3 sm:grid-cols-[1fr_auto] sm:items-center' },
        channelLine(c),
        LINK_PRESET[c.source] && !c.links
          ? h('button', { type: 'button', class: `${quiet} justify-self-start`, onclick: () => ctx.go('links', { preset: LINK_PRESET[c.source] }) }, 'Make a tracking link')
          : c.source === 'referral'
            ? h('button', { type: 'button', class: `${quiet} justify-self-start`, onclick: () => ctx.go('referrals') }, 'Referrals')
            : h('span', {}),
      ),
    ),
  );

  /* ------------------------------------------------------------ checklist */

  const checklist = h(
    'ul',
    { class: 'border-t border-ink-800' },
    ...p.checklist.map((item) => {
      const box = h('input', { type: 'checkbox', class: 'mt-1 size-5 shrink-0 accent-[#e8b14c]', 'aria-label': item.title }) as HTMLInputElement;
      box.checked = item.done;
      const when = h('span', { class: 'text-xs uppercase tracking-[0.14em] text-bone-500' });
      const drawWhen = () =>
        (when.textContent = [EVERY[item.every], item.doneAt ? `last done ${shortDate(item.doneAt)}` : null].filter(Boolean).join(' · '));
      drawWhen();
      const title = h('span', { class: `font-semibold ${item.done ? 'text-bone-400' : 'text-bone-50'}` }, item.title);
      box.addEventListener('change', async () => {
        clearError();
        box.disabled = true;
        try {
          const res = await api<{ doneAt: string | null; done: boolean }>(`${M}/playbook/done`, { method: 'POST', body: { key: item.key, done: box.checked } });
          item.doneAt = res.doneAt;
          item.done = res.done;
          title.className = `font-semibold ${item.done ? 'text-bone-400' : 'text-bone-50'}`;
          drawWhen();
        } catch (err) {
          box.checked = !box.checked;
          showError(err);
        } finally {
          box.disabled = false;
        }
      });
      return h(
        'li',
        { class: 'border-b border-ink-800 py-4' },
        h(
          'label',
          { class: 'flex cursor-pointer gap-4' },
          box,
          h('span', { class: 'flex flex-col gap-1' }, h('span', { class: 'flex flex-wrap items-baseline gap-x-3' }, title, when), h('span', { class: 'max-w-2xl text-sm text-bone-400' }, item.text)),
        ),
      );
    }),
  );
  const todo = p.checklist.filter((c) => !c.done).length;

  el.replaceChildren(
    h(
      'p',
      { class: 'mb-8 max-w-2xl border-l-2 border-gold-500 pl-4 text-bone-200' },
      'Where to find your next customers, from your own jobs. Most of it is free. Start at the top.',
    ),
    seasons ? part('This time of year', null, seasons) : '',
    part('Streets to go back to', 'Neighbors see your work up close. A door hanger on the houses next to a job you just did is the cheapest ad there is.', streets),
    part('Your best areas', zipAdvice, zips),
    part('Places to be seen', 'Where people found you, and where they could. Try one new place a month, with its own tracking link so you can tell if it worked.', channels),
    part(
      'Free things that bring in work',
      todo ? `${plural(todo, 'thing')} left to do. Weekly ones come back after a week.` : "All caught up. Nice work. The weekly ones come back next week.",
      checklist,
    ),
  );
}
