/**
 * One invoice, opened: what it's for, who owes it, and the four things Jacob
 * does with it (text it, record money, change it, void it). Every change goes
 * to the API and the page redraws from what comes back.
 */
import { type Job, type Child, h, api, dayTitle, when, heading, headingStyle, input, showError, clearError } from './core';
import {
  type Invoice,
  type InvoiceLine,
  type Entry,
  type Account,
  money,
  moneyText,
  parseMoney,
  today,
  shortDay,
  shortWhen,
  stateOf,
  unpaid,
  label,
  gold,
  plain,
  danger,
  textLink,
  action,
  copy,
  isPhone,
  smsHref,
  row,
  phoneText,
} from './invoices-shared';

export interface Nav {
  back: () => Promise<void>;
  open: (id: string, flash?: string) => Promise<void>;
}

/** The last text made for each invoice, so it survives the redraw after sending. */
const sentTexts = new Map<string, { message: string; emailed: boolean; balance: number }>();

export async function renderDetail(view: HTMLElement, id: string, nav: Nav, flash?: string) {
  const inv = await api<Invoice>(`/invoices/${id}`);
  const [job, entries, accounts] = await Promise.all([
    api<Job>(`/jobs/${inv.jobId}`).catch(() => null),
    api<{ entries: Entry[] }>(`/books/entries?jobId=${inv.jobId}`).then((r) => r.entries).catch(() => [] as Entry[]),
    api<{ accounts: Account[] }>('/books/accounts').then((r) => r.accounts).catch(() => [] as Account[]),
  ]);
  const redraw = (note?: string) => renderDetail(view, id, nav, note);
  const { word, tone } = stateOf(inv);

  const back = h('button', { type: 'button', class: `${textLink} no-underline` }, '← All invoices');
  back.addEventListener('click', () => nav.back().catch(showError));

  view.replaceChildren(
    h(
      'div',
      { class: 'max-w-3xl' },
      back,
      h(
        'div',
        { class: 'mt-6 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1' },
        h('h2', { class: heading, style: headingStyle }, `Invoice ${inv.number}`),
        h('p', { class: `text-sm uppercase tracking-[0.14em] ${tone}` }, word),
      ),
      h('p', { class: 'mt-1 text-sm text-bone-400' }, history(inv)),
      flash ? h('p', { role: 'status', class: 'mt-6 border-l-2 border-gold-500 pl-4 text-bone-200' }, flash) : null,

      balance(inv),
      inv.status === 'void' ? voided(inv, nav) : actions(inv, accounts, redraw),

      section('Customer', h('dl', { class: 'border-t border-ink-800' }, ...customer(inv))),
      job ? section('The job', h('dl', { class: 'border-t border-ink-800' }, ...jobRows(job))) : null,
      lines(inv, redraw),
      payments(inv, entries, accounts, redraw),
      inv.status !== 'void' ? payLink(inv) : null,
      inv.status !== 'void' ? voidBox(inv, entries, redraw) : null,
    ),
  );
}

/* ------------------------------------------------------------ top */

function history(inv: Invoice) {
  const bits = [`Made ${shortWhen(inv.createdAt)}`];
  if (inv.sentAt) bits.push(`sent ${shortWhen(inv.sentAt)}`);
  if (inv.viewedAt) bits.push(`customer opened it ${shortWhen(inv.viewedAt)}`);
  else if (inv.sentAt && inv.status !== 'void') bits.push('customer hasn’t opened it yet');
  if (inv.voidedAt) bits.push(`voided ${shortWhen(inv.voidedAt)}`);
  return bits.join(' · ');
}

function balance(inv: Invoice) {
  const big = "font-variation-settings:'wdth' 80,'wght' 800;font-size:clamp(2rem,6vw,2.75rem);line-height:1";
  const title = inv.status === 'void' ? 'Void, nothing owed' : inv.status === 'paid' ? 'Paid in full' : 'Still owed';
  return h(
    'div',
    { class: 'mt-8 flex flex-wrap items-end justify-between gap-6 border-l-2 border-gold-500 pl-5' },
    h(
      'div',
      {},
      h('p', { class: label }, title),
      h('p', { class: `mt-1 font-display tabular-nums ${inv.status === 'void' ? 'text-bone-500 line-through' : 'text-bone-50'}`, style: big }, money(inv.status === 'paid' ? inv.total : inv.status === 'void' ? inv.total : inv.balance)),
    ),
    h(
      'dl',
      { class: 'grid grid-cols-[auto_auto] gap-x-4 text-sm tabular-nums' },
      h('dt', { class: 'text-bone-400' }, 'Total'),
      h('dd', { class: 'text-right text-bone-200' }, money(inv.total)),
      h('dt', { class: 'text-bone-400' }, 'Paid'),
      h('dd', { class: 'text-right text-bone-200' }, money(inv.paid)),
      inv.dueDate && unpaid(inv) ? h('dt', { class: 'text-bone-400' }, 'Due') : null,
      inv.dueDate && unpaid(inv) ? h('dd', { class: 'text-right text-bone-200' }, shortDay(inv.dueDate)) : null,
    ),
  );
}

const section = (title: string, ...children: Child[]) =>
  h('section', { class: 'mt-12' }, h('h3', { class: 'mb-3 font-display text-sm uppercase tracking-[0.14em] text-gold-400' }, title), ...children);

function customer(inv: Invoice) {
  const c = inv.customer;
  return [
    row('Name', c.name),
    c.phone ? row('Phone', h('a', { class: 'text-gold-400 hover:text-gold-500', href: `tel:${c.phone}` }, phoneText(c.phone))) : row('Phone', h('span', { class: 'text-bone-400' }, 'None saved')),
    c.email ? row('Email', h('a', { class: 'break-all text-gold-400 hover:text-gold-500', href: `mailto:${c.email}` }, c.email)) : null,
  ];
}

function jobRows(j: Job) {
  return [
    row('Date', `${dayTitle(j.date)}, ${when(j.start, { hour: 'numeric', minute: '2-digit' })}`),
    j.quote.lines[0] ? row('Service', j.quote.lines[0].label) : null,
    j.vehicle ? row('Vehicle', j.vehicle) : null,
    row('Address', j.address),
  ];
}

/* ------------------------------------------------------------ send and get paid */

function actions(inv: Invoice, accounts: Account[], redraw: (note?: string) => Promise<void>) {
  const panel = h('div');
  const sent = sentTexts.get(inv.id);
  // Only while it still matches: after a payment or a change, the old text has the wrong amount.
  if (sent && sent.balance === inv.balance && unpaid(inv)) panel.replaceChildren(textPanel(inv, sent));

  const buttons: Child[] = [];
  if (unpaid(inv)) {
    buttons.push(
      action(inv.status === 'draft' ? 'Text it to the customer' : 'Text it again', gold, async () => {
        const r = await api<{ invoice: Invoice; message: string; emailed: boolean }>(`/invoices/${inv.id}/send`, { method: 'POST' });
        sentTexts.set(inv.id, { message: r.message, emailed: r.emailed, balance: r.invoice.balance });
        await redraw();
      }),
    );
  }
  const payBtn = h('button', { type: 'button', class: 'btn-ghost' }, inv.status === 'paid' ? 'Add a tip or payment' : 'They paid me');
  payBtn.addEventListener('click', () => {
    clearError();
    panel.replaceChildren(payForm(inv, accounts, redraw, () => panel.replaceChildren()));
  });
  buttons.push(payBtn);

  return h('div', { class: 'mt-8' }, h('div', { class: 'flex flex-wrap gap-3' }, ...buttons), panel);
}

/** The text message to send, with Copy and (on a phone) Messages. */
function textPanel(inv: Invoice, sent: { message: string; emailed: boolean }) {
  const body = h('p', { class: 'whitespace-pre-wrap break-words text-bone-50' }, sent.message);
  const copied = h('span', { class: 'text-sm text-bone-400', role: 'status' });
  const copyBtn = action('Copy text', gold, async () => {
    copied.textContent = (await copy(sent.message, body)) ? 'Copied. Paste it in a text to them.' : 'Your browser blocked copying. The text is selected: copy it by hand.';
  });
  const phone = inv.customer.phone;
  return h(
    'div',
    { class: 'mt-5 border border-ink-700 bg-ink-900 p-4 sm:p-5' },
    h('p', { class: `${label} mb-2` }, phone ? `Send this to ${phoneText(phone)}` : 'Send this to the customer'),
    body,
    h(
      'div',
      { class: 'mt-4 flex flex-wrap items-center gap-3' },
      phone && isPhone() ? h('a', { class: gold, href: smsHref(phone, sent.message) }, 'Open in Messages') : null,
      copyBtn,
      copied,
    ),
    !phone ? h('p', { class: 'mt-3 text-sm text-bone-400' }, 'There’s no phone number for this customer. Add one on the Customers tab.') : null,
    sent.emailed ? h('p', { class: 'mt-3 text-sm text-bone-400' }, `It was also emailed to ${inv.customer.email}.`) : null,
  );
}

const METHODS: [string, string][] = [
  ['Cash', 'cash'],
  ['Check', 'checking'],
  ['Card', 'checking'],
  ['Venmo', 'checking'],
  ['Cash App', 'checking'],
  ['Zelle', 'checking'],
  ['Other', 'checking'],
];

function payForm(inv: Invoice, accounts: Account[], redraw: (note?: string) => Promise<void>, close: () => void) {
  // Only places money can land: his bank, cash, Stripe. Not the credit card.
  const places = accounts.filter((a) => a.moneyAccount && a.type === 'asset' && !a.archived);
  if (!places.length) places.push({ id: 'checking', name: 'Business checking', type: 'asset', moneyAccount: true, archived: false }, { id: 'cash', name: 'Cash on hand', type: 'asset', moneyAccount: true, archived: false });

  const method = h('select', { class: input, 'aria-label': 'How they paid' }, ...METHODS.map(([m]) => h('option', { value: m }, m))) as HTMLSelectElement;
  const place = h('select', { class: input, 'aria-label': 'Where the money went' }, ...places.map((a) => h('option', { value: a.id }, a.name))) as HTMLSelectElement;
  let placeTouched = false;
  const suggest = () => {
    const want = METHODS.find(([m]) => m === method.value)?.[1] ?? 'checking';
    if (!placeTouched && places.some((a) => a.id === want)) place.value = want;
  };
  method.addEventListener('change', suggest);
  place.addEventListener('change', () => (placeTouched = true));
  suggest();

  const moneyBox = (value: string, name: string) =>
    h('input', { class: input, type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0', value, 'aria-label': name }) as HTMLInputElement;
  const amount = moneyBox(inv.balance ? moneyText(inv.balance) : '', 'Amount');
  const tip = moneyBox('', 'Tip');
  const date = h('input', { class: input, type: 'date', value: today(), max: today(), 'aria-label': 'Day they paid' }) as HTMLInputElement;

  const note = h('p', { class: 'text-sm text-bone-400', role: 'status' });
  const check = () => {
    const a = parseMoney(amount.value) ?? 0;
    note.textContent = a > inv.balance && inv.balance > 0 ? `That’s more than the ${money(inv.balance)} they owe. Put the extra in Tip if it was a tip.` : '';
  };
  amount.addEventListener('input', check);

  const labelled = (name: string, el: HTMLElement, hint?: string) =>
    h('label', { class: 'flex flex-col gap-1' }, h('span', { class: label }, name), el, hint ? h('span', { class: 'text-xs text-bone-500' }, hint) : null);

  const save = action('Save payment', gold, async () => {
    const a = parseMoney(amount.value);
    const t = parseMoney(tip.value);
    if (amount.value.trim() && a === null) throw new Error('The amount should be a number, like 150 or 150.50.');
    if (tip.value.trim() && t === null) throw new Error('The tip should be a number, like 20.');
    if (!a && !t) throw new Error('Type how much they paid.');
    if (!date.value) throw new Error('Pick the day they paid.');
    await api(`/invoices/${inv.id}/payments`, {
      method: 'POST',
      body: { depositToId: place.value, method: method.value, date: date.value, amount: a ?? 0, ...(t ? { tip: t } : {}) },
    });
    const parts = [a ? money(a) : null, t ? `${money(t)} tip` : null].filter(Boolean).join(' and ');
    await redraw(`Saved ${parts}. It’s in the books too.`);
  });
  const cancel = h('button', { type: 'button', class: 'btn-ghost' }, 'Cancel');
  cancel.addEventListener('click', close);

  return h(
    'div',
    { class: 'mt-5 border border-ink-700 bg-ink-900 p-4 sm:p-5' },
    h('p', { class: 'mb-4 font-semibold text-bone-50' }, 'Record money you got'),
    h(
      'div',
      { class: 'grid gap-4 sm:grid-cols-2' },
      labelled('How they paid', method),
      labelled('Where the money went', place),
      labelled('Amount', amount, inv.balance ? `They owe ${money(inv.balance)}.` : 'Nothing is owed. Leave empty for a tip only.'),
      labelled('Tip (if any)', tip, 'Tips are kept apart from the bill.'),
      labelled('Day they paid', date),
    ),
    h('div', { class: 'mt-5 flex flex-wrap items-center gap-3' }, save, cancel, note),
  );
}

/* ------------------------------------------------------------ lines */

interface Draft {
  label: string;
  amount: string;
  discount: boolean;
}

function lines(inv: Invoice, redraw: (note?: string) => Promise<void>) {
  const holder = h('div');
  const showRead = () => holder.replaceChildren(readLines(inv, unpaid(inv) ? edit : null));
  const edit = () => holder.replaceChildren(editor(inv, redraw, showRead));
  showRead();
  return section('What they’re paying for', holder);
}

function readLines(inv: Invoice, edit: (() => void) | null) {
  return h(
    'div',
    {},
    h(
      'table',
      { class: 'w-full border-collapse text-left' },
      h('thead', { class: 'sr-only' }, h('tr', {}, h('th', { scope: 'col' }, 'Item'), h('th', { scope: 'col' }, 'Amount'))),
      h(
        'tbody',
        { class: 'border-t border-ink-800' },
        ...inv.lines.map((l) =>
          h('tr', { class: 'border-b border-ink-800' }, h('td', { class: 'py-3 pr-4 text-bone-200' }, l.label), h('td', { class: `py-3 text-right tabular-nums ${l.amount < 0 ? 'text-gold-400' : 'text-bone-50'}` }, money(l.amount))),
        ),
      ),
      h(
        'tfoot',
        {},
        h('tr', { class: 'border-b border-ink-800' }, h('th', { scope: 'row', class: 'py-3 font-semibold text-bone-50' }, 'Total'), h('td', { class: 'py-3 text-right font-semibold tabular-nums text-bone-50' }, money(inv.total))),
      ),
    ),
    h(
      'dl',
      { class: 'mt-4' },
      row('Due', inv.dueDate ? dayTitle(inv.dueDate) : 'When they get it'),
      row('Note to the customer', inv.notes ? h('span', { class: 'whitespace-pre-wrap' }, inv.notes) : h('span', { class: 'text-bone-400' }, 'None')),
    ),
    edit
      ? h('div', { class: 'mt-4' }, (() => {
          const b = h('button', { type: 'button', class: plain }, 'Change the lines, due date or note');
          b.addEventListener('click', edit);
          return b;
        })())
      : inv.status === 'paid'
        ? h('p', { class: 'mt-4 text-sm text-bone-400' }, 'It’s paid, so it can’t be changed.')
        : null,
  );
}

function editor(inv: Invoice, redraw: (note?: string) => Promise<void>, cancel: () => void) {
  const drafts: Draft[] = inv.lines.map((l) => ({ label: l.label, amount: moneyText(Math.abs(l.amount)), discount: l.amount < 0 }));
  let notes = inv.notes ?? '';
  let due = inv.dueDate ?? '';

  const list = h('div', { class: 'border-t border-ink-800' });
  const totalEl = h('p', { class: 'font-semibold tabular-nums text-bone-50' });
  const sum = () => drafts.reduce((s, d) => s + (parseMoney(d.amount) ?? 0) * (d.discount ? -1 : 1), 0);
  const refreshTotal = () => (totalEl.textContent = money(sum()));

  const drawLines = () => {
    list.replaceChildren(
      ...drafts.map((d, i) => {
        const name = h('input', { class: input, type: 'text', value: d.label, maxlength: '120', 'aria-label': `Line ${i + 1}, what it’s for` }) as HTMLInputElement;
        name.addEventListener('input', () => (d.label = name.value));
        const amt = h('input', { class: `${input} text-right`, type: 'text', inputmode: 'decimal', autocomplete: 'off', value: d.amount, 'aria-label': `Line ${i + 1}, amount` }) as HTMLInputElement;
        amt.addEventListener('input', () => ((d.amount = amt.value), refreshTotal()));
        const remove = h('button', { type: 'button', class: 'text-sm text-bone-400 underline underline-offset-4 hover:text-red-300 disabled:opacity-40', disabled: drafts.length === 1 }, 'Remove');
        remove.addEventListener('click', () => (drafts.splice(i, 1), drawLines(), refreshTotal()));
        return h(
          'div',
          { class: 'grid grid-cols-[1fr_7.5rem] items-center gap-x-3 gap-y-2 border-b border-ink-800 py-3 sm:grid-cols-[1fr_8rem_auto]' },
          h('div', { class: 'col-span-2 sm:col-span-1' }, d.discount ? h('span', { class: `${label} mb-1 block text-gold-400` }, 'Discount (comes off the total)') : null, name),
          h('div', { class: 'flex items-center gap-1' }, h('span', { class: 'shrink-0 whitespace-nowrap text-bone-400', 'aria-hidden': 'true' }, d.discount ? '−$' : '$'), amt),
          h('div', { class: 'text-right' }, remove),
        );
      }),
    );
  };
  drawLines();
  refreshTotal();

  const addLine = h('button', { type: 'button', class: plain }, 'Add a line');
  addLine.addEventListener('click', () => {
    drafts.push({ label: '', amount: '', discount: false });
    drawLines();
    list.querySelectorAll<HTMLInputElement>('input[type="text"]')[(drafts.length - 1) * 2]?.focus();
  });
  const addDiscount = h('button', { type: 'button', class: plain }, 'Add a discount');
  addDiscount.addEventListener('click', () => {
    drafts.push({ label: 'Discount', amount: '', discount: true });
    drawLines();
    list.querySelectorAll<HTMLInputElement>('input[type="text"]')[(drafts.length - 1) * 2 + 1]?.focus();
  });

  const notesEl = h('textarea', { class: `${input} min-h-24`, maxlength: '1000', rows: 3, 'aria-label': 'Note to the customer' }) as HTMLTextAreaElement;
  notesEl.value = notes;
  notesEl.addEventListener('input', () => (notes = notesEl.value));
  const dueEl = h('input', { class: input, type: 'date', value: due, 'aria-label': 'Due date' }) as HTMLInputElement;
  dueEl.addEventListener('input', () => (due = dueEl.value));

  const save = action('Save changes', gold, async () => {
    const out: InvoiceLine[] = [];
    for (const [i, d] of drafts.entries()) {
      const cents = parseMoney(d.amount);
      if (!d.label.trim()) throw new Error(`Line ${i + 1} needs to say what it’s for.`);
      if (!cents) throw new Error(`Line ${i + 1} needs an amount, like 150 or 150.50.`);
      out.push({ label: d.label.trim(), amount: d.discount ? -cents : cents });
    }
    if (sum() <= 0) throw new Error('The total has to be more than $0.');
    await api(`/invoices/${inv.id}`, { method: 'PATCH', body: { lines: out, notes: notes.trim() || null, dueDate: due || null } });
    await redraw(inv.sentAt ? 'Saved. Their link shows the new version. Text it again if the amount changed.' : 'Saved.');
  });
  const back = h('button', { type: 'button', class: 'btn-ghost' }, 'Cancel');
  back.addEventListener('click', cancel);

  return h(
    'div',
    {},
    list,
    h('div', { class: 'mt-3 flex flex-wrap gap-3' }, addLine, addDiscount),
    h('div', { class: 'mt-5 flex items-baseline justify-between border-b border-ink-800 pb-3' }, h('p', { class: 'font-semibold text-bone-50' }, 'New total'), totalEl),
    h(
      'div',
      { class: 'mt-6 grid gap-4 sm:grid-cols-2' },
      h('label', { class: 'flex flex-col gap-1' }, h('span', { class: label }, 'Due date'), dueEl, h('span', { class: 'text-xs text-bone-500' }, 'Leave it empty if they pay when they get it.')),
      h('label', { class: 'flex flex-col gap-1 sm:col-span-2' }, h('span', { class: label }, 'Note to the customer'), notesEl, h('span', { class: 'text-xs text-bone-500' }, 'They see this on their invoice.')),
    ),
    h('div', { class: 'mt-6 flex flex-wrap gap-3' }, save, back),
  );
}

/* ------------------------------------------------------------ payments */

/** Money in for this job: the income entries still standing. */
function payments(inv: Invoice, entries: Entry[], accounts: Account[], redraw: (note?: string) => Promise<void>) {
  const got = entries.filter((e) => e.kind === 'income' && !e.voidedBy);
  if (!got.length) return inv.status === 'void' ? null : section('Payments', h('p', { class: 'text-bone-400' }, 'No money recorded yet.'));
  const names = new Map(accounts.map((a) => [a.id, a.name]));
  return section(
    'Payments',
    h(
      'ul',
      { class: 'border-t border-ink-800' },
      ...got.map((e) => {
        const tip = e.lines.some((l) => l.accountId === 'income-tips');
        const into = e.lines.find((l) => l.amount > 0);
        const amount = into?.amount ?? 0;
        const confirmBox = h('div');
        const takeBack = h('button', { type: 'button', class: 'text-sm text-bone-400 underline underline-offset-4 hover:text-red-300' }, 'Take back');
        takeBack.addEventListener('click', () => {
          takeBack.hidden = true;
          const no = h('button', { type: 'button', class: plain }, 'No, keep it');
          no.addEventListener('click', () => (confirmBox.replaceChildren(), (takeBack.hidden = false)));
          confirmBox.replaceChildren(
            h(
              'div',
              { class: 'mt-3 border-l-2 border-red-400 pl-4' },
              h('p', { class: 'text-sm text-bone-200' }, `Take back this ${money(amount)}${tip ? ' tip' : ''}? Only do this if it was saved by mistake. The books keep a note that it was taken back.`),
              h(
                'div',
                { class: 'mt-3 flex flex-wrap gap-3' },
                action('Yes, take it back', danger, async () => {
                  await api(`/books/entries/${e.id}/void`, { method: 'POST', body: {} });
                  await redraw(`Took back ${money(amount)}.`);
                }),
                no,
              ),
            ),
          );
        });
        return h(
          'li',
          { class: 'border-b border-ink-800 py-3' },
          h(
            'div',
            { class: 'flex items-baseline justify-between gap-4' },
            h(
              'div',
              { class: 'min-w-0' },
              h('p', { class: 'text-bone-50' }, [tip ? 'Tip' : 'Payment', e.method].filter(Boolean).join(', ')),
              h('p', { class: 'text-sm text-bone-400' }, [shortDay(e.date), into ? names.get(into.accountId) : null].filter(Boolean).join(' · ')),
            ),
            h('div', { class: 'flex shrink-0 items-baseline gap-4' }, h('p', { class: 'tabular-nums text-bone-50' }, money(amount)), takeBack),
          ),
          confirmBox,
        );
      }),
    ),
  );
}

/* ------------------------------------------------------------ pay link */

function payLink(inv: Invoice) {
  const url = h('p', { class: 'break-all text-sm text-bone-200' }, inv.payUrl);
  const copied = h('span', { class: 'text-sm text-bone-400', role: 'status' });
  return section(
    'The customer’s page',
    h('p', { class: 'mb-3 text-sm text-bone-400' }, 'Their own copy of this invoice. Only people with this link can see it.'),
    h('div', { class: 'border border-ink-800 bg-ink-900 px-4 py-3' }, url),
    h(
      'div',
      { class: 'mt-3 flex flex-wrap items-center gap-3' },
      action('Copy link', plain, async () => {
        copied.textContent = (await copy(inv.payUrl, url)) ? 'Copied.' : 'Copy it by hand; it’s selected.';
      }),
      h('a', { class: plain, href: inv.payUrl, target: '_blank', rel: 'noopener noreferrer' }, 'See what they see'),
      copied,
    ),
  );
}

/* ------------------------------------------------------------ void */

function voidBox(inv: Invoice, entries: Entry[], redraw: (note?: string) => Promise<void>) {
  const holder = h('div');
  const standing = entries.some((e) => e.kind === 'income' && !e.voidedBy && !e.lines.some((l) => l.accountId === 'income-tips'));
  if (inv.paid > 0 || standing) {
    holder.replaceChildren(h('p', { class: 'text-sm text-bone-400' }, 'Money is saved on this job. To void the invoice, first take back those payments above.'));
  } else {
    const start = h('button', { type: 'button', class: danger }, 'Void this invoice');
    start.addEventListener('click', () => {
      const no = h('button', { type: 'button', class: plain }, 'No, keep it');
      no.addEventListener('click', () => holder.replaceChildren(start));
      holder.replaceChildren(
        h(
          'div',
          { class: 'border-l-2 border-red-400 pl-4' },
          h('p', { class: 'text-bone-50' }, `Void invoice ${inv.number}?`),
          h('p', { class: 'mt-1 text-sm text-bone-400' }, 'The customer’s link will say it’s cancelled, and they won’t owe this anymore. You can’t undo it, but you can make a new invoice for the job.'),
          h(
            'div',
            { class: 'mt-3 flex flex-wrap gap-3' },
            action('Yes, void it', danger, async () => {
              await api(`/invoices/${inv.id}/void`, { method: 'POST' });
              sentTexts.delete(inv.id);
              await redraw(`Invoice ${inv.number} is void.`);
            }),
            no,
          ),
        ),
      );
    });
    holder.replaceChildren(start);
  }
  return section('Cancel this bill', holder);
}

function voided(inv: Invoice, nav: Nav) {
  return h(
    'div',
    { class: 'mt-8' },
    h('p', { class: 'text-sm text-bone-400' }, 'This invoice is void. If the job still needs a bill, make a new one.'),
    h(
      'div',
      { class: 'mt-3' },
      action('Make a new invoice for this job', gold, async () => {
        const next = await api<Invoice>(`/jobs/${inv.jobId}/invoice`, { method: 'POST', body: {} });
        await nav.open(next.id, `Invoice ${next.number} is made.`);
      }),
    ),
  );
}
