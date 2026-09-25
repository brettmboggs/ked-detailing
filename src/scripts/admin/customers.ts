/**
 * The Customers tab: find anyone who has booked, see and fix their details,
 * their jobs, and book them again. Customers are made by bookings (matched by
 * phone), so there's no "add customer" here: booking a new person adds them.
 */
import { $, h, api, input, small, heading, headingStyle, sectionHead, dollars } from './core';
import {
  type CalJob,
  type Customer,
  STATUS,
  STATUS_EDGE,
  STATUS_TEXT,
  action,
  backLink,
  block,
  contactLinks,
  dayFmt,
  goTab,
  goldSmall,
  labelled,
  pending,
  priceText,
  serviceName,
  textArea,
  time,
  toTop,
  today,
} from './calendar-shared';

/** The search box keeps its words while Jacob looks at someone. */
let query = '';

const view = () => $('[data-view="customers"]');

export async function renderCustomers() {
  if (pending.customer) {
    const id = pending.customer;
    pending.customer = null;
    return openCustomer(id);
  }
  return drawList();
}

async function drawList() {
  const search = h('input', {
    type: 'search',
    class: `${input} max-w-md`,
    placeholder: 'Name, phone or email',
    'aria-label': 'Find a customer',
    autocomplete: 'off',
  }) as HTMLInputElement;
  search.value = query;
  const results = h('div', {});

  const load = async () => {
    const q = search.value.trim();
    query = q;
    const { customers } = await api<{ customers: Customer[] }>(`/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    if (search.value.trim() !== q) return;
    results.replaceChildren(
      customers.length
        ? h('ul', { class: 'border-t border-ink-800' }, ...customers.map(row))
        : h('p', { class: 'py-4 text-bone-400' }, q ? `Nobody matches "${q}".` : 'No customers yet. They show up here once someone books.'),
      ...(customers.length === 100 ? [h('p', { class: 'mt-3 text-sm text-bone-500' }, 'Showing the first 100. Search to find someone else.')] : []),
    );
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => void load().catch(() => undefined), 250);
  });

  await load();
  view().replaceChildren(
    sectionHead('Customers', 'Newest first. Search by name, phone number or email.'),
    h('div', { class: 'mb-6' }, search),
    results,
  );
}

function row(c: Customer) {
  return h(
    'li',
    {},
    h(
      'button',
      {
        type: 'button',
        class: 'grid w-full gap-x-6 gap-y-0.5 border-b border-ink-800 px-1 py-3 text-left transition-colors hover:bg-ink-900 sm:grid-cols-[1fr_11rem_1.2fr]',
        onclick: () => void openCustomer(c.id),
      },
      h('span', { class: 'font-semibold text-bone-50' }, c.name),
      h('span', { class: 'text-sm tabular-nums text-bone-200' }, c.phone ?? h('span', { class: 'text-bone-500' }, 'No phone')),
      h('span', { class: 'truncate text-sm text-bone-400' }, c.address ?? c.email ?? ''),
    ),
  );
}

async function openCustomer(id: string) {
  toTop();
  const data = await api<Customer & { jobs: CalJob[] }>(`/customers/${id}`);
  const { jobs, ...c } = data;

  const done = jobs.filter((j) => j.status === 'done');
  const spent = done.reduce((s, j) => s + (j.finalPrice ?? j.quote.total ?? 0), 0);
  const upcoming = jobs.filter((j) => (j.status === 'scheduled' || j.status === 'in_progress') && j.date >= today());
  const first = jobs.length ? jobs[jobs.length - 1]! : null;

  const facts = [
    `${jobs.length} ${jobs.length === 1 ? 'job' : 'jobs'}`,
    done.length ? `${dollars(spent)} of finished work` : null,
    first ? `first booked ${dayFmt(first.date, { month: 'short', year: 'numeric' })}` : null,
  ].filter(Boolean);

  /* ---------------------------------------------------------- edit */

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
      const saved = await api<Customer>(`/customers/${id}`, {
        method: 'PATCH',
        body: {
          name: name.value.trim(),
          phone: phone.value.trim() || null,
          email: email.value.trim() || null,
          address: address.value.trim() || null,
          notes: notes.value.trim() || null,
        },
      });
      title.textContent = saved.name;
      return 'Saved.';
    },
    goldSmall,
  );

  const bookThem = () => {
    pending.newJobFor = { ...c, name: name.value.trim() || c.name, address: address.value.trim() || c.address };
    goTab('bookings');
  };

  const title = h('h2', { class: heading, style: headingStyle }, c.name);

  /* ---------------------------------------------------------- jobs */

  const jobRow = (j: CalJob) =>
    h(
      'li',
      {},
      h(
        'button',
        {
          type: 'button',
          class: `grid w-full grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 border-b border-l-2 border-b-ink-800 ${STATUS_EDGE[j.status]} py-3 pl-3 pr-1 text-left transition-colors hover:bg-ink-900`,
          onclick: () => {
            pending.job = j.id;
            goTab('bookings');
          },
        },
        h('span', { class: 'tabular-nums text-bone-50' }, `${dayFmt(j.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} · ${time(j.start)}`),
        h('span', { class: 'text-right tabular-nums text-bone-200' }, priceText(j)),
        h('span', { class: 'truncate text-sm text-bone-400' }, [serviceName(j), j.vehicle].filter(Boolean).join(' · ')),
        h('span', { class: `text-right text-xs uppercase tracking-[0.14em] ${STATUS_TEXT[j.status]}` }, STATUS[j.status]),
      ),
    );

  view().replaceChildren(
    backLink('All customers', () => void drawList()),
    h(
      'div',
      { class: 'flex flex-wrap items-end justify-between gap-4' },
      h('div', {}, title, h('p', { class: 'mt-1 text-sm text-bone-400' }, facts.join(' · '))),
      h('button', { type: 'button', class: goldSmall, onclick: bookThem }, 'Book a job'),
    ),
    h('div', { class: 'mt-4' }, contactLinks(c, c.address)),
    h(
      'div',
      { class: 'mt-6 grid gap-x-12 lg:grid-cols-2' },
      h(
        'div',
        {},
        block(
          'Details',
          h(
            'div',
            { class: 'flex flex-col gap-3' },
            labelled('Name', name),
            h('div', { class: 'grid gap-3 sm:grid-cols-2' }, labelled('Phone', phone), labelled('Email', email)),
            labelled('Address', address),
            labelled('Notes (only you see these)', notes),
            save.row,
          ),
        ),
      ),
      h(
        'div',
        {},
        block(
          upcoming.length ? `Jobs · ${upcoming.length} coming up` : 'Jobs',
          jobs.length ? h('ul', { class: 'border-t border-ink-800' }, ...jobs.map(jobRow)) : h('p', { class: 'text-sm text-bone-500' }, 'No jobs yet.'),
          jobs.length === 200 ? h('p', { class: `${small} mt-3` }, 'Showing the latest 200.') : null,
        ),
      ),
    ),
  );
}
