/**
 * The Today tab, the first thing Jacob sees: today's jobs, then the people to
 * contact today with the message ready (one tap opens Messages), then what's
 * coming up, what went out by email on its own this week, and the settings
 * for all of it. The daily rules that fill the list live in
 * api/src/crm-followups.ts.
 */
import { zonedToUtc, addDays } from '@ked/scheduling';
import { TZ, h, $, api, ghost, small, heading, headingStyle, input, when } from './core';
import {
  type CalJob,
  STATUS,
  STATUS_EDGE,
  STATUS_TEXT,
  action,
  dayFmt,
  goTab,
  goldSmall,
  labelled,
  pending,
  serviceName,
  span,
  textButton,
  today as todayDate,
} from './calendar-shared';
import { type FollowUp, KIND, followUpRow } from './today-item';
import { type SettingsResponse, settingsPanel } from './today-settings';

interface List {
  today: string;
  due: FollowUp[];
  upcoming: FollowUp[];
  sent: FollowUp[];
  done: FollowUp[];
  email: { configured: boolean; sentLastDay: number; perDay: number };
}

const view = () => $('[data-view="today"]');

/** Settings stay open across redraws once Jacob opens them. */
let settingsOpen = false;

export async function renderToday() {
  const day = todayDate();
  const from = zonedToUtc(day, '00:00', TZ);
  const to = zonedToUtc(addDays(day, 1), '00:00', TZ);
  const [{ jobs }, list, settings] = await Promise.all([
    api<{ jobs: CalJob[] }>(`/jobs?from=${from.toISOString()}&to=${to.toISOString()}`),
    api<List>('/crm/follow-ups'),
    api<SettingsResponse>('/crm/follow-ups/settings'),
  ]);
  draw(jobs.filter((j) => j.status !== 'cancelled'), list, settings);
}

function draw(jobs: CalJob[], list: List, settings: SettingsResponse) {
  const today = list.today;

  /* ------------------------------------------------ header */
  const top = h(
    'div',
    { class: 'mb-8' },
    h('p', { class: `${small} mb-2` }, dayFmt(today, { weekday: 'long', month: 'long', day: 'numeric' })),
    h('h2', { class: heading, style: headingStyle }, 'Today'),
    list.email.configured
      ? null
      : h('p', { class: 'mt-4 max-w-2xl border-l-2 border-gold-500 pl-4 text-sm text-bone-200' },
          'Emails will send once Brett finishes email setup. Until then, everything shows here to text.'),
  );

  /* ------------------------------------------------ jobs */
  const jobRow = (j: CalJob) =>
    h(
      'li',
      {},
      h(
        'button',
        {
          type: 'button',
          class: `grid w-full grid-cols-[5.5rem_1fr] gap-x-4 gap-y-0.5 border-b border-l-2 border-b-ink-800 ${STATUS_EDGE[j.status]} py-3 pl-3 pr-1 text-left transition-colors hover:bg-ink-900 sm:grid-cols-[9rem_1fr_auto]`,
          onclick: () => {
            pending.job = j.id;
            goTab('bookings');
          },
        },
        h('span', { class: 'tabular-nums text-bone-50' }, span(j.start, j.end).split(' – ')[0]),
        h('span', { class: 'min-w-0' },
          h('span', { class: 'block truncate text-bone-50' }, j.customer.name),
          h('span', { class: 'block truncate text-sm text-bone-400' }, [serviceName(j), j.address].filter(Boolean).join(' · '))),
        h('span', { class: `col-start-2 text-xs uppercase tracking-[0.14em] sm:col-start-auto sm:self-center ${STATUS_TEXT[j.status]}` }, STATUS[j.status]),
      ),
    );
  const jobsBlock = h(
    'section',
    { class: 'mb-12' },
    h('div', { class: 'mb-3 flex items-baseline justify-between gap-4' },
      h('h3', { class: small }, jobs.length ? `Jobs today · ${jobs.length}` : 'Jobs today'),
      h('button', { type: 'button', class: textButton, onclick: () => goTab('bookings') }, 'Open the calendar')),
    jobs.length
      ? h('ul', { class: 'border-t border-ink-800' }, ...jobs.map(jobRow))
      : h('p', { class: 'border-t border-ink-800 pt-3 text-sm text-bone-400' }, 'Nothing booked today.'),
  );

  /* ------------------------------------------------ people to contact */
  const count = h('span', {});
  const setCount = (n: number) => (count.textContent = n ? ` · ${n}` : '');
  let left = list.due.length;
  setCount(left);
  const rows = list.due.map((f) => {
    let open = true;
    const row = followUpRow(f, today, () => {
      // A row settles (done, skipped, snoozed) or comes back (undo).
      open = !open;
      left += open ? 1 : -1;
      setCount(left);
    });
    return row;
  });

  const check = action('Check now', async () => {
    const r = await api<{ created: Record<string, number>; emailed: number; emailWaiting: number }>('/crm/follow-ups/run', { method: 'POST', body: {} });
    const made = Object.values(r.created).reduce((a, b) => a + b, 0);
    await renderToday();
    return [made ? `${made} new.` : 'Nothing new.', r.emailed ? `${r.emailed} emailed.` : ''].filter(Boolean).join(' ');
  });

  const people = h(
    'section',
    { class: 'mb-12' },
    h('div', { class: 'mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2' },
      h('h3', { class: small }, 'People to contact today', count),
      h('div', { class: 'flex flex-wrap items-center gap-4' }, check.status, check.btn)),
    rows.length
      ? h('ul', { class: 'border-t border-ink-800' }, ...rows)
      : h('p', { class: 'border-t border-ink-800 pt-3 text-sm text-bone-400' }, "Nobody to contact today. You're caught up."),
    addReminder(today),
  );

  /* ------------------------------------------------ coming up, sent, done */
  const upcoming = h(
    'section',
    { class: 'mb-12' },
    h('h3', { class: `${small} mb-3` }, 'Coming up'),
    list.upcoming.length
      ? h('ul', { class: 'border-t border-ink-800' }, ...list.upcoming.map((f) => laterRow(f)))
      : h('p', { class: 'border-t border-ink-800 pt-3 text-sm text-bone-400' }, 'Nothing waiting on a later day.'),
  );

  const sent = h(
    'section',
    { class: 'mb-12' },
    h('h3', { class: `${small} mb-3` }, 'Sent automatically this week'),
    list.sent.length
      ? h('ul', { class: 'border-t border-ink-800' }, ...list.sent.map(sentRow))
      : h('p', { class: 'border-t border-ink-800 pt-3 text-sm text-bone-400' },
          list.email.configured ? 'No emails went out on their own this week.' : 'None yet. Emails start once email setup is done.'),
    list.email.configured
      ? h('p', { class: 'mt-3 text-sm text-bone-500' }, `${list.email.sentLastDay} sent in the last day, out of ${list.email.perDay} allowed.`)
      : null,
  );

  const done = list.done.length
    ? h(
        'details',
        { class: 'mb-12 border-t border-ink-800 pt-3' },
        h('summary', { class: `${small} cursor-pointer` }, `Done this week · ${list.done.length}`),
        h('ul', { class: 'mt-3' }, ...list.done.map(doneRow)),
      )
    : null;

  /* ------------------------------------------------ settings */
  const settingsWrap = h('details', { class: 'border-t border-ink-800 pt-3', open: settingsOpen });
  settingsWrap.addEventListener('toggle', () => (settingsOpen = (settingsWrap as HTMLDetailsElement).open));
  settingsWrap.append(
    h('summary', { class: 'cursor-pointer py-2 font-display uppercase tracking-[0.12em] text-bone-50' }, 'Follow-up settings'),
    settingsPanel(settings, () => undefined),
  );

  view().replaceChildren(...[top, jobsBlock, people, upcoming, sent, done, settingsWrap].filter(Boolean) as HTMLElement[]);
}

/* ------------------------------------------------------------ rows */

const shortDate = (d: string) => dayFmt(d, { weekday: 'short', month: 'short', day: 'numeric' });

function laterRow(f: FollowUp) {
  const li = h('li', { class: 'grid grid-cols-[5.5rem_1fr] gap-x-4 border-b border-ink-800 py-3 sm:grid-cols-[9rem_1fr_auto]' });
  const now = action('Do it today', async () => {
    await api(`/crm/follow-ups/${f.id}`, { method: 'PATCH', body: { dueDate: todayDate() } });
    await renderToday();
  }, textButton);
  li.append(
    h('span', { class: 'text-sm tabular-nums text-bone-200' }, shortDate(f.dueDate)),
    h('span', { class: 'min-w-0' },
      h('span', { class: 'block text-bone-50' }, f.customer?.name || f.title),
      h('span', { class: 'block text-sm text-bone-400' }, f.customer ? `${KIND[f.kind]}: ${f.title}` : KIND[f.kind])),
    h('span', { class: 'col-start-2 sm:col-start-auto sm:self-center' }, now.btn),
  );
  return li;
}

function sentRow(f: FollowUp) {
  return h(
    'li',
    { class: 'border-b border-ink-800 py-3' },
    h('details', {},
      h('summary', { class: 'grid cursor-pointer grid-cols-[5.5rem_1fr] gap-x-4 sm:grid-cols-[9rem_1fr]' },
        h('span', { class: 'text-sm tabular-nums text-bone-200' }, f.email?.sentAt ? when(f.email.sentAt, { weekday: 'short', month: 'short', day: 'numeric' }) : ''),
        h('span', { class: 'min-w-0' },
          h('span', { class: 'block text-bone-50' }, f.customer?.name ?? ''),
          h('span', { class: 'block truncate text-sm text-bone-400' }, `${KIND[f.kind]} · ${f.subject ?? ''}`))),
      h('p', { class: 'mt-3 max-w-2xl whitespace-pre-wrap border-l-2 border-ink-700 pl-4 text-sm text-bone-200' }, f.message ?? '')),
  );
}

function doneRow(f: FollowUp) {
  const back = action('Put it back', async () => {
    await api(`/crm/follow-ups/${f.id}/reopen`, { method: 'POST' });
    await renderToday();
  }, textButton);
  return h(
    'li',
    { class: 'flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-ink-800 py-2 text-sm' },
    h('span', { class: 'text-bone-200' }, f.customer?.name || f.title, h('span', { class: 'text-bone-500' }, ` · ${f.status === 'skipped' ? 'Skipped' : 'Done'} · ${KIND[f.kind]}`)),
    back.btn,
  );
}

/* ------------------------------------------------------------ add */

/** "Call Bob back Tuesday": Jacob's own reminder, with or without a customer. */
function addReminder(today: string) {
  const wrap = h('div', { class: 'mt-4' });
  const open = h('button', { type: 'button', class: ghost }, 'Add a reminder');

  const what = h('input', { type: 'text', class: input, maxlength: 200, placeholder: 'Call Bob back about the boat' }) as HTMLInputElement;
  const due = h('input', { type: 'date', class: input, min: today }) as HTMLInputElement;
  due.value = today;
  const note = h('textarea', { class: `${input} min-h-20`, maxlength: 2000, rows: 3, placeholder: 'Text to send them (optional)' }) as HTMLTextAreaElement;

  // Who, by search: optional.
  let customerId: string | null = null;
  const who = h('input', { type: 'search', class: input, placeholder: 'Name or phone (optional)', autocomplete: 'off' }) as HTMLInputElement;
  const matches = h('ul', { class: 'mt-1' });
  let timer: ReturnType<typeof setTimeout> | undefined;
  who.addEventListener('input', () => {
    customerId = null;
    clearTimeout(timer);
    const q = who.value.trim();
    if (q.length < 2) return matches.replaceChildren();
    timer = setTimeout(async () => {
      const { customers } = await api<{ customers: { id: string; name: string; phone: string | null }[] }>(`/customers?q=${encodeURIComponent(q)}`).catch(() => ({ customers: [] }));
      if (who.value.trim() !== q) return;
      matches.replaceChildren(
        ...customers.slice(0, 5).map((c) =>
          h('li', {}, h('button', {
            type: 'button',
            class: 'w-full border-b border-ink-800 px-1 py-2 text-left text-sm text-bone-200 hover:bg-ink-900',
            onclick: () => {
              customerId = c.id;
              who.value = c.name;
              matches.replaceChildren();
            },
          }, c.name, c.phone ? h('span', { class: 'text-bone-500' }, ` · ${c.phone}`) : null)),
        ),
      );
    }, 250);
  });

  const add = action('Add it', async () => {
    if (!what.value.trim()) throw new Error('Say what to do.');
    await api('/crm/follow-ups', {
      method: 'POST',
      body: { title: what.value.trim(), dueDate: due.value || today, customerId, message: note.value.trim() || null, channel: customerId && note.value.trim() ? 'text' : null },
    });
    await renderToday();
  }, goldSmall);

  const form = h(
    'div',
    { class: 'mt-2 grid max-w-2xl gap-3 border-l-2 border-ink-700 pl-4', hidden: true },
    labelled('What to do', what),
    h('div', { class: 'grid gap-3 sm:grid-cols-2' }, labelled('When', due), h('div', {}, labelled('Who', who), matches)),
    labelled('Message', note),
    h('div', { class: 'flex flex-wrap items-center gap-3' }, add.btn,
      h('button', { type: 'button', class: textButton, onclick: () => ((form.hidden = true), (open.hidden = false)) }, 'Cancel'), add.status),
  );
  open.addEventListener('click', () => {
    form.hidden = false;
    open.hidden = true;
    what.focus();
  });
  wrap.append(open, form);
  return wrap;
}
