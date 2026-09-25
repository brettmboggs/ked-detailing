/**
 * One customer, everything about them (GET /v1/crm/customers/:id): the key
 * numbers with what to do next, how to reach them, tags, where they came from,
 * consent, their referral link and who they sent, jobs, invoices, open
 * follow-ups, and the timeline. Jacob books them again from here too.
 */
import { h, api, input, small, heading, headingStyle, dollars, when, clearError, showError, checkbox } from './core';
import {
  type CalJob,
  STATUS,
  STATUS_EDGE,
  STATUS_TEXT,
  action,
  backLink,
  block,
  contactLinks,
  goTab,
  goldSmall,
  labelled,
  pending,
  priceText,
  serviceName,
  textArea,
  textButton,
  time,
  toTop,
  today,
  dayFmt,
} from './calendar-shared';
import { openInvoice } from './invoices';
import { copy } from './invoices-shared';
import {
  type CrmCustomer,
  type Profile,
  type ProfileInvoice,
  SOURCES,
  agoText,
  customerPicker,
  dayText,
  daysSince,
  everyText,
  fact,
  localDay,
  serviceNames,
  shortDate,
  sourceName,
  tagLine,
} from './customers-shared';
import { timelineBlock } from './customers-timeline';
import { mergeBlock } from './customers-merge';

export interface ProfileNav {
  back: () => void;
  open: (id: string, flash?: string) => void;
}

export async function drawProfile(view: HTMLElement, id: string, go: ProfileNav, flash?: string) {
  toTop();
  const [p, names, tagsInUse] = await Promise.all([
    api<Profile>(`/crm/customers/${id}`),
    serviceNames(),
    api<{ tags: { tag: string; count: number }[] }>('/crm/customers/tags').then((r) => r.tags.map((t) => t.tag)).catch(() => [] as string[]),
  ]);
  const c = p.customer;
  const n = p.numbers;

  const title = h('h2', { class: heading, style: headingStyle }, c.name);
  const headTags = h('div', { class: 'mt-2' }, tagLine(c.tags));
  const sub = [
    sourceName(c.source),
    `customer since ${dayText(n.customerSince, { month: 'short', year: 'numeric' })}`,
    n.zip ? `ZIP ${n.zip}` : null,
  ].filter(Boolean);

  const bookThem = () => {
    pending.newJobFor = { ...c };
    goTab('bookings');
  };

  view.replaceChildren(
    backLink('All customers', go.back),
    flash ? h('p', { class: 'mb-4 border-l-2 border-gold-500 pl-4 text-sm text-bone-50', role: 'status' }, flash) : '',
    h(
      'div',
      { class: 'flex flex-wrap items-end justify-between gap-4' },
      h('div', { class: 'min-w-0' }, title, h('p', { class: 'mt-1 text-sm text-bone-400' }, sub.join(' · ')), headTags),
      h('button', { type: 'button', class: goldSmall, onclick: bookThem }, 'Book a job'),
    ),
    h('div', { class: 'mt-4' }, contactLinks(c, c.address ?? p.jobs[0]?.address ?? null)),
    nextStep(p),
    numbers(p, names),
    h(
      'div',
      { class: 'mt-8 grid gap-x-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]' },
      h(
        'div',
        { class: 'min-w-0' },
        p.followUps.length ? followUps(p) : null,
        block(
          'Timeline',
          timelineBlock(c.id, p.timeline, {
            job: (jobId) => openJob(jobId),
            invoice: (invoiceId) => showInvoice(invoiceId),
          }),
        ),
      ),
      h(
        'div',
        { class: 'min-w-0' },
        jobsBlock(p.jobs),
        p.invoices.length ? invoicesBlock(p.invoices) : null,
        block('Tags', tagEditor(c, tagsInUse, (tags) => headTags.replaceChildren(tagLine(tags) ?? ''))),
        block('Where they came from', sourceEditor(c)),
        block('Can we reach out?', consent(c)),
        block('Referrals', referrals(p, go)),
        block('Details', details(c, p.jobs, (name) => (title.textContent = name))),
        block(
          'Same person twice?',
          mergeBlock({ id: c.id, name: c.name, phone: c.phone, email: c.email, createdAt: c.createdAt, visits: n.visits, spend: n.spend }, (kept) =>
            go.open(kept, 'Merged. Everything from both records is on this one now.'),
          ),
        ),
      ),
    ),
  );
}

/* ------------------------------------------------------------ hand-offs */

function openJob(jobId: string) {
  pending.job = jobId;
  goTab('bookings');
}

/** The Invoices tab, opened straight to one invoice (without first drawing its list). */
function showInvoice(invoiceId: string) {
  clearError();
  for (const t of document.querySelectorAll<HTMLElement>('[data-tab]')) t.setAttribute('aria-selected', String(t.dataset.tab === 'invoices'));
  for (const v of document.querySelectorAll<HTMLElement>('[data-view]')) v.hidden = v.dataset.view !== 'invoices';
  toTop();
  openInvoice(invoiceId).catch(showError);
}

/* ------------------------------------------------------------ numbers */

/** One plain sentence: what to do about this person now. */
function nextStep(p: Profile) {
  const n = p.numbers;
  const first = p.customer.name.split(' ')[0];
  let text: string | null = null;
  if (n.owed > 0) text = `${first} owes ${dollars(n.owed)}. Open the invoice below and text them the pay link.`;
  else if (n.nextVisit) text = `Next visit: ${when(n.nextVisit, { weekday: 'long', month: 'long', day: 'numeric' })} at ${time(n.nextVisit)}.`;
  else if (!n.visits && p.quoteRequests.length) text = `Asked for a quote ${agoText(localDay(p.quoteRequests[0]!.createdAt))} but never booked. Call or text ${first} to set a day.`;
  else if (n.lastVisit) {
    const since = daysSince(n.lastVisit);
    if (n.everyDays && since > n.everyDays * 1.2) text = `${first} usually comes ${everyText(n.everyDays)}, and the last visit was ${agoText(n.lastVisit)}. Text them to book the next one.`;
    else if (!n.everyDays && since > 150) text = `Last visit was ${agoText(n.lastVisit)} and nothing is booked. Text ${first} to come back.`;
    else if (n.visits === 1) text = `One visit so far. Ask ${first} to book the next one before they forget.`;
    else if (n.everyDays) text = `${first} usually comes ${everyText(n.everyDays)}. Next one is due around ${shortDate(addDays(n.lastVisit, n.everyDays))}.`;
  }
  return text ? h('p', { class: 'mt-6 max-w-3xl border-l-2 border-gold-500 pl-4 text-bone-50' }, text) : '';
}

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 864e5).toISOString().slice(0, 10);

function numbers(p: Profile, names: Map<string, string>) {
  const n = p.numbers;
  const services = n.services.map((s) => names.get(s) ?? (s === 'imported' ? 'Past jobs' : s));
  return h(
    'div',
    { class: 'mt-8 grid gap-8 md:grid-cols-[14rem_minmax(0,1fr)]' },
    h(
      'div',
      { class: 'border-l-2 border-gold-500 pl-5' },
      h('p', { class: small }, 'Spent with you'),
      h('p', { class: 'mt-1 font-display tabular-nums text-bone-50', style: "font-variation-settings:'wdth' 80,'wght' 800;font-size:clamp(2rem,6vw,2.75rem);line-height:1" }, dollars(n.spend)),
      h('p', { class: 'mt-2 text-sm text-bone-400' }, n.visits ? `over ${n.visits} ${n.visits === 1 ? 'visit' : 'visits'}` : 'No finished jobs yet'),
    ),
    h(
      'dl',
      { class: 'grid gap-x-10 border-t border-ink-800 sm:grid-cols-2' },
      fact('Average visit', n.avgTicket !== null ? dollars(n.avgTicket) : '—'),
      fact('Customer since', dayText(n.customerSince, { month: 'short', day: 'numeric', year: 'numeric' })),
      fact('Last visit', n.lastVisit ? `${shortDate(n.lastVisit)} (${agoText(n.lastVisit)})` : 'Not yet'),
      fact('Next visit', n.nextVisit ? h('span', { class: 'text-gold-400' }, `${shortDate(localDay(n.nextVisit))}, ${time(n.nextVisit)}`) : 'Nothing booked'),
      fact('Comes back', n.everyDays ? `Usually ${everyText(n.everyDays)}` : n.visits > 1 ? 'Same day each time' : 'Not enough visits yet'),
      fact('Services', services.length ? services.join(', ') : '—'),
      n.paid || n.tips ? fact('Paid through invoices', `${dollars(n.paid)}${n.tips ? ` + ${dollars(n.tips)} in tips` : ''}`) : null,
      n.owed ? fact('Still owes', h('span', { class: 'text-gold-400' }, dollars(n.owed))) : null,
    ),
  );
}

/* ------------------------------------------------------------ lists */

function followUps(p: Profile) {
  return block(
    `To do for them · ${p.followUps.length}`,
    h(
      'ul',
      { class: 'border-t border-ink-800' },
      ...p.followUps.map((f) =>
        h(
          'li',
          { class: 'border-b border-ink-800 py-3' },
          h('p', { class: 'flex flex-wrap items-baseline justify-between gap-x-4' }, h('span', { class: 'text-bone-50' }, f.title), h('span', { class: `text-sm tabular-nums ${f.dueDate <= today() ? 'text-gold-400' : 'text-bone-400'}` }, f.dueDate <= today() ? 'Due now' : `Due ${shortDate(f.dueDate)}`)),
          f.message ? h('p', { class: 'mt-1 whitespace-pre-line text-sm text-bone-400' }, f.message) : null,
        ),
      ),
    ),
    h('button', { type: 'button', class: `${textButton} mt-3`, onclick: () => goTab('today') }, 'Open the Today list'),
  );
}

function jobsBlock(jobs: CalJob[]) {
  const upcoming = jobs.filter((j) => (j.status === 'scheduled' || j.status === 'in_progress') && j.date >= today());
  const ul = h('ul', { class: 'border-t border-ink-800' });
  const more = h('div', {});
  const row = (j: CalJob) =>
    h(
      'li',
      {},
      h(
        'button',
        {
          type: 'button',
          class: `grid w-full grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 border-b border-l-2 border-b-ink-800 ${STATUS_EDGE[j.status]} py-3 pl-3 pr-1 text-left transition-colors hover:bg-ink-900`,
          onclick: () => openJob(j.id),
        },
        h('span', { class: 'tabular-nums text-bone-50' }, `${dayFmt(j.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} · ${time(j.start)}`),
        h('span', { class: 'text-right tabular-nums text-bone-200' }, priceText(j)),
        h('span', { class: 'truncate text-sm text-bone-400' }, [serviceName(j), j.vehicle].filter(Boolean).join(' · ')),
        h('span', { class: `text-right text-xs uppercase tracking-[0.14em] ${STATUS_TEXT[j.status]}` }, STATUS[j.status]),
      ),
    );
  const draw = (all: boolean) => {
    ul.replaceChildren(...(all ? jobs : jobs.slice(0, 6)).map(row));
    more.replaceChildren(!all && jobs.length > 6 ? h('button', { type: 'button', class: `${textButton} mt-3`, onclick: () => draw(true) }, `Show all ${jobs.length} jobs`) : '');
  };
  draw(false);
  return block(
    upcoming.length ? `Jobs · ${upcoming.length} coming up` : 'Jobs',
    jobs.length ? h('div', {}, ul, more) : h('p', { class: 'text-sm text-bone-500' }, 'No jobs yet.'),
  );
}

const INVOICE_WORD: Record<ProfileInvoice['status'], [string, string]> = {
  draft: ['Not sent', 'text-bone-400'],
  sent: ['Not paid', 'text-gold-400'],
  paid: ['Paid', 'text-bone-400'],
  void: ['Void', 'text-bone-500'],
};

function invoicesBlock(invoices: ProfileInvoice[]) {
  return block(
    'Invoices',
    h(
      'ul',
      { class: 'border-t border-ink-800' },
      ...invoices.map((i) => {
        const [word, tone] = INVOICE_WORD[i.status];
        const open = i.status === 'draft' || i.status === 'sent';
        return h(
          'li',
          {},
          h(
            'button',
            { type: 'button', class: 'flex w-full items-baseline justify-between gap-4 border-b border-ink-800 px-1 py-3 text-left transition-colors hover:bg-ink-900', onclick: () => showInvoice(i.id) },
            h('span', { class: 'min-w-0' }, h('span', { class: 'text-bone-50' }, `#${i.number}`), h('span', { class: 'ml-3 text-sm text-bone-400' }, shortDate(localDay(i.sentAt ?? i.createdAt)))),
            h(
              'span',
              { class: 'shrink-0 text-right' },
              h('span', { class: `block tabular-nums ${i.status === 'void' ? 'text-bone-500 line-through' : 'text-bone-50'}` }, open && i.paid ? `${dollars(i.balance)} left` : dollars(i.total)),
              h('span', { class: `block text-xs uppercase tracking-[0.14em] ${tone}` }, word),
            ),
          ),
        );
      }),
    ),
  );
}

/* ------------------------------------------------------------ editors */

const saveCustomer = (id: string, body: Record<string, unknown>) => api<CrmCustomer>(`/crm/customers/${id}`, { method: 'PATCH', body });

function tagEditor(c: CrmCustomer, inUse: string[], changed: (tags: string[]) => void) {
  let tags = [...c.tags];
  const holder = h('div', {});
  const status = h('span', { class: 'text-sm text-bone-400', role: 'status' });
  const listId = `tags-${c.id}`;
  const box = h('input', { type: 'text', class: input, maxlength: 24, placeholder: 'VIP, boat owner, fleet…', list: listId, 'aria-label': 'New tag', autocomplete: 'off' }) as HTMLInputElement;
  const add = h('button', { type: 'button', class: 'border border-ink-700 px-3 py-2 text-sm text-bone-200 hover:border-gold-500 hover:text-bone-50' }, 'Add') as HTMLButtonElement;

  const commit = async (next: string[]) => {
    clearError();
    status.textContent = 'Saving…';
    try {
      const saved = await saveCustomer(c.id, { tags: next });
      tags = saved.tags;
      c.tags = saved.tags;
      status.textContent = 'Saved.';
      changed(tags);
      draw();
    } catch (err) {
      status.textContent = '';
      showError(err);
    }
  };
  const addTyped = () => {
    const t = box.value.trim();
    if (!t) return;
    box.value = '';
    void commit([...tags, t]);
  };
  add.addEventListener('click', addTyped);
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTyped();
    }
  });

  const draw = () =>
    holder.replaceChildren(
      tags.length
        ? h(
            'ul',
            { class: 'mb-3 flex flex-wrap gap-x-5 gap-y-2' },
            ...tags.map((t) =>
              h(
                'li',
                { class: 'flex items-baseline gap-1.5 border-b border-ink-600 pb-0.5' },
                h('span', { class: 'text-[0.72rem] uppercase tracking-[0.16em] text-gold-400' }, t),
                h('button', { type: 'button', class: 'px-1 text-bone-500 hover:text-bone-50', 'aria-label': `Remove the tag ${t}`, onclick: () => void commit(tags.filter((x) => x !== t)) }, '×'),
              ),
            ),
          )
        : h('p', { class: 'mb-3 text-sm text-bone-500' }, 'No tags. Tags help you find groups later, like everyone with a boat.'),
      h('div', { class: 'flex max-w-sm gap-2' }, box, add),
      h('datalist', { id: listId }, ...inUse.filter((t) => !tags.includes(t)).map((t) => h('option', { value: t }))),
      h('p', { class: 'mt-2 min-h-5' }, status),
    );
  draw();
  return holder;
}

function sourceEditor(c: CrmCustomer) {
  const sel = h('select', { class: input, 'aria-label': 'Where they heard about us' }, h('option', { value: '' }, 'Not known'), ...SOURCES.map(([v, l]) => h('option', { value: v }, l))) as HTMLSelectElement;
  sel.value = c.source ?? '';
  const detail = h('input', { type: 'text', class: input, maxlength: 120, placeholder: 'Which friend, which post, where they saw the van' }) as HTMLInputElement;
  detail.value = c.sourceDetail ?? '';
  const save = action('Save', async () => {
    const saved = await saveCustomer(c.id, { source: sel.value || null, sourceDetail: detail.value.trim() || null });
    Object.assign(c, { source: saved.source, sourceDetail: saved.sourceDetail });
    return 'Saved.';
  });
  const a = c.attribution;
  const seen = a
    ? [
        a.referrer ? `came from ${a.referrer}` : null,
        a.utmSource ? `link tagged "${[a.utmSource, a.utmMedium, a.utmCampaign].filter(Boolean).join(' / ')}"` : null,
        a.landing ? `first page ${a.landing}` : null,
        a.ref ? `used referral code ${a.ref}` : null,
        a.firstSeen ? `first visit ${shortDate(a.firstSeen.slice(0, 10))}` : null,
      ].filter(Boolean)
    : [];
  return h(
    'div',
    { class: 'flex flex-col gap-3' },
    labelled('Heard about us from', sel),
    labelled('More about it', detail),
    save.row,
    seen.length ? h('p', { class: 'text-sm text-bone-400' }, `The website saw: ${seen.join(', ')}.`) : null,
  );
}

function consent(c: CrmCustomer) {
  const status = h('span', { class: 'text-sm text-bone-400', role: 'status' });
  const set = (key: 'emailOk' | 'textOk') => async (v: boolean) => {
    clearError();
    status.textContent = 'Saving…';
    try {
      const saved = await saveCustomer(c.id, { [key]: v });
      c[key] = saved[key];
      status.textContent = 'Saved.';
    } catch (err) {
      status.textContent = '';
      showError(err);
    }
  };
  return h(
    'div',
    { class: 'flex flex-col gap-2' },
    checkbox(c.email ? 'Send them emails (reminders and deals)' : 'Send them emails (no email on file yet)', () => c.emailOk, (v) => void set('emailOk')(v)),
    checkbox(c.phone ? 'OK to text them' : 'OK to text them (no phone on file yet)', () => c.textOk, (v) => void set('textOk')(v)),
    h('p', { class: 'text-sm text-bone-500' }, 'Untick if they ask you to stop. Emails also have an unsubscribe link that unticks this for them.'),
    h('p', { class: 'min-h-5' }, status),
  );
}

function referrals(p: Profile, go: ProfileNav) {
  const c = p.customer;
  const r = p.referral;
  const first = c.name.split(' ')[0];
  const copied = h('span', { class: 'text-sm text-bone-400', role: 'status' });
  const linkText = h('p', { class: 'mt-1 break-all text-sm text-bone-200' }, r.url);
  const copyBtn = h('button', { type: 'button', class: 'border border-ink-700 px-3 py-1.5 text-sm text-bone-200 hover:border-gold-500 hover:text-bone-50' }, 'Copy link');
  copyBtn.addEventListener('click', async () => {
    copied.textContent = (await copy(r.url, linkText)) ? 'Copied.' : 'Selected. Press and hold to copy.';
  });
  const shareText = `Thanks for choosing Knock Em' Down! If a friend or neighbor needs a detail, send them this link so I know they came from you: ${r.url}`;
  const smsLink = c.phone
    ? h('a', { href: `sms:${c.phone.replace(/[^\d+]/g, '')}?&body=${encodeURIComponent(shareText)}`, class: 'text-sm text-gold-400 underline decoration-ink-600 underline-offset-4 hover:text-gold-500' }, `Text it to ${first}`)
    : null;

  const by = h('div', {});
  const drawBy = (who: { id: string; name: string } | null) => {
    by.replaceChildren(
      h(
        'p',
        { class: 'flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm' },
        h('span', { class: 'text-bone-400' }, 'Sent by'),
        who
          ? h('button', { type: 'button', class: 'text-bone-50 underline decoration-ink-600 underline-offset-4 hover:decoration-gold-500', onclick: () => go.open(who.id) }, who.name)
          : h('span', { class: 'text-bone-500' }, 'Nobody we know of'),
        h('button', { type: 'button', class: textButton, onclick: change }, who ? 'Change' : 'Pick who sent them'),
        who ? h('button', { type: 'button', class: textButton, onclick: () => void setBy(null) }, 'Remove') : null,
      ),
    );
  };
  const setBy = async (who: { id: string; name: string } | null) => {
    clearError();
    try {
      await saveCustomer(c.id, { referredBy: who?.id ?? null });
      r.referredBy = who;
      drawBy(who);
    } catch (err) {
      showError(err);
    }
  };
  function change() {
    const picker = customerPicker(c.id, (p) => void setBy({ id: p.id, name: p.name }), 'Who sent them? Name or phone');
    by.replaceChildren(picker.el, h('button', { type: 'button', class: `${textButton} mt-2`, onclick: () => drawBy(r.referredBy) }, 'Cancel'));
    picker.focus();
  }
  drawBy(r.referredBy);

  return h(
    'div',
    { class: 'flex flex-col gap-4' },
    h(
      'div',
      {},
      h('p', { class: 'text-sm text-bone-400' }, `${first}’s code`),
      h('p', { class: 'font-display text-2xl tracking-[0.2em] text-bone-50' }, r.code),
      linkText,
      h('div', { class: 'mt-2 flex flex-wrap items-center gap-4' }, copyBtn, smsLink, copied),
      h('p', { class: 'mt-2 text-sm text-bone-500' }, 'Anyone who books through this link shows up as sent by them.'),
    ),
    by,
    h(
      'div',
      {},
      h('p', { class: 'text-sm text-bone-400' }, r.referred.length ? `Sent you ${r.referred.length} ${r.referred.length === 1 ? 'person' : 'people'}` : `Hasn’t sent anyone yet.`),
      r.referred.length
        ? h(
            'ul',
            { class: 'mt-1 flex flex-col gap-1' },
            ...r.referred.map((x) =>
              h(
                'li',
                { class: 'flex items-baseline justify-between gap-4 border-b border-ink-800 py-1.5' },
                h('button', { type: 'button', class: 'text-left text-bone-50 underline decoration-ink-600 underline-offset-4 hover:decoration-gold-500', onclick: () => go.open(x.id) }, x.name),
                h('span', { class: 'text-sm tabular-nums text-bone-400' }, x.visits ? `${x.visits} ${x.visits === 1 ? 'visit' : 'visits'}` : 'not booked yet'),
              ),
            ),
          )
        : null,
    ),
  );
}

function details(c: CrmCustomer, jobs: CalJob[], renamed: (name: string) => void) {
  const make = (tag: 'input' | 'textarea', value: string | null, attrs: Record<string, unknown>) => {
    const el = h(tag, { class: tag === 'textarea' ? textArea : input, ...attrs }) as HTMLInputElement | HTMLTextAreaElement;
    el.value = value ?? '';
    return el;
  };
  const name = make('input', c.name, { type: 'text', maxlength: 100 });
  const phone = make('input', c.phone, { type: 'tel', maxlength: 30 });
  const email = make('input', c.email, { type: 'email', maxlength: 200 });
  const address = make('input', c.address, { type: 'text', maxlength: 200, placeholder: jobs[0] ? `Last job: ${jobs[0].address}` : '' });
  const notes = make('textarea', c.notes, { maxlength: 5000, rows: 4, placeholder: 'Gate codes, pets, how they like to be reached' });

  const save = action(
    'Save changes',
    async () => {
      if (!name.value.trim()) throw new Error("The name can't be empty.");
      const saved = await saveCustomer(c.id, {
        name: name.value.trim(),
        phone: phone.value.trim() || null,
        email: email.value.trim() || null,
        address: address.value.trim() || null,
        notes: notes.value.trim() || null,
      });
      Object.assign(c, { name: saved.name, phone: saved.phone, email: saved.email, address: saved.address, notes: saved.notes });
      renamed(saved.name);
      return 'Saved.';
    },
    goldSmall,
  );

  return h(
    'div',
    { class: 'flex flex-col gap-3' },
    labelled('Name', name),
    h('div', { class: 'grid gap-3 sm:grid-cols-2' }, labelled('Phone', phone), labelled('Email', email)),
    labelled('Address', address),
    labelled('Notes (only you see these)', notes),
    save.row,
  );
}
