/**
 * Books → Add: record something by hand. Money out (with a receipt photo),
 * money in, money moved between his own accounts, and a work drive. Each form
 * says what it saved in plain words, then clears for the next one.
 */
import { type Child, type Job, h, api } from './core';
import type { BooksCtx } from './books';
import {
  type Books,
  type Payee,
  accountName,
  button,
  categoryOptions,
  dateInput,
  goldSmall,
  kids,
  labelled,
  moneyInput,
  moneyOptions,
  parseCents,
  receiptPicker,
  select,
  statusLine,
  subHead,
  textBtn,
  textInput,
  today,
  uploadReceipt,
  usd,
} from './books-lib';

type Kind = 'out' | 'in' | 'moved' | 'drive';

const KINDS: [Kind, string][] = [
  ['out', 'Money out'],
  ['in', 'Money in'],
  ['moved', 'Moved money'],
  ['drive', 'Work drive'],
];

let kind: Kind = 'out';

export async function renderAdd(host: HTMLElement, ctx: BooksCtx, start?: string) {
  if (start && KINDS.some(([k]) => k === start)) kind = start as Kind;
  const [{ payees }, { jobs }] = await Promise.all([
    api<{ payees: Payee[] }>('/books/payees'),
    api<{ jobs: Job[] }>(`/jobs?from=${new Date(Date.now() - 60 * 864e5).toISOString()}&to=${new Date(Date.now() + 2 * 864e5).toISOString()}`).catch(() => ({ jobs: [] as Job[] })),
  ]);
  const recentJobs = jobs.filter((j) => j.status !== 'cancelled').sort((a, b) => b.start.localeCompare(a.start));
  const body = h('div', { class: 'mt-6 max-w-2xl' });
  const switcher = h(
    'div',
    { role: 'tablist', 'aria-label': 'What to add', class: 'grid grid-cols-2 border-l border-t border-ink-700 sm:flex sm:w-fit' },
    ...KINDS.map(([k, label]) => {
      const b = h(
        'button',
        {
          type: 'button',
          role: 'tab',
          'data-kind': k,
          class:
            'border-b border-r border-ink-700 px-4 py-2 text-sm text-bone-400 transition-colors hover:text-bone-50 ' +
            'aria-selected:bg-ink-900 aria-selected:text-bone-50 aria-selected:shadow-[inset_0_-2px_0_var(--color-gold-500)]',
        },
        label,
      );
      b.addEventListener('click', () => pick(k));
      return b;
    }),
  );

  function pick(k: Kind) {
    kind = k;
    for (const b of switcher.querySelectorAll<HTMLElement>('[data-kind]')) b.setAttribute('aria-selected', String(b.dataset.kind === k));
    const draw = { out: moneyOut, in: moneyIn, moved, drive }[k];
    body.replaceChildren(...kids(...draw(ctx.books, payees, recentJobs, ctx)));
  }

  host.replaceChildren(
    subHead('Add by hand', 'For cash, a receipt in your pocket, or anything the bank file won\'t have. Money that went through the bank shows up when you bring in the bank file, so you don\'t need to add it here too.'),
    switcher,
    body,
  );
  pick(kind);
}

/* -------------------------------------------------------------- shared */

const grid = (...c: Child[]) => h('div', { class: 'grid gap-4 sm:grid-cols-2' }, ...c);

function payeeField(payees: Payee[], placeholder: string) {
  const id = `books-add-payees-${Math.random().toString(36).slice(2, 8)}`;
  const el = textInput({ list: id, placeholder });
  return { el, list: h('datalist', { id }, ...payees.map((p) => h('option', { value: p.name }))) };
}

function jobSelect(jobs: Job[]) {
  const when = (j: Job) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(`${j.date}T12:00:00Z`));
  return select([['', 'No job'], ...jobs.map((j): [string, string] => [j.id, `${j.customer.name}, ${when(j)}`])], '');
}

/** A receipt picker that shows the chosen photo's name. */
function receiptField() {
  const pick = receiptPicker();
  const name = h('span', { class: 'text-sm text-bone-400' }, 'No photo yet');
  pick.addEventListener('change', () => (name.textContent = pick.files?.[0]?.name ?? 'No photo yet'));
  const el = h(
    'div',
    { class: 'flex flex-col gap-1' },
    h('span', { class: 'text-xs uppercase tracking-[0.14em] text-bone-500' }, 'Receipt photo (optional)'),
    h(
      'div',
      { class: 'flex flex-wrap items-center gap-4' },
      h('label', { class: 'cursor-pointer border border-ink-700 px-3 py-2 text-sm text-bone-200 hover:border-gold-500 hover:text-bone-50' }, 'Take or choose a photo', pick),
      name,
    ),
  );
  const clear = () => {
    pick.value = '';
    name.textContent = 'No photo yet';
  };
  return { el, file: () => pick.files?.[0] ?? null, clear };
}

function amountOrThrow(el: HTMLInputElement) {
  const c = parseCents(el.value);
  if (!c) throw new Error('Type the amount, like 45.99.');
  return c;
}

/* ----------------------------------------------------------- money out */

function moneyOut(books: Books, payees: Payee[], jobs: Job[], ctx: BooksCtx): Child[] {
  const amount = moneyInput();
  const date = dateInput();
  const cat = select(categoryOptions(books, 'expense'), 'supplies');
  const from = select(moneyOptions(books), 'checking');
  const who = payeeField(payees, 'Store or person');
  const helperBox = h('input', { type: 'checkbox', class: 'size-4 accent-[#e8b14c]' }) as HTMLInputElement;
  const job = jobSelect(jobs);
  const memo = textInput({ placeholder: 'Anything to remember (optional)' });
  const receipt = receiptField();
  const status = statusLine();
  const after = h('div');

  // Paying a helper usually means Contract labor, and the 1099 needs them marked.
  cat.addEventListener('change', () => {
    if (cat.value === 'contract-labor') helperBox.checked = true;
  });

  const save = button('Save', goldSmall, (b) =>
    status.run(b, async () => {
      const cents = amountOrThrow(amount);
      const file = receipt.file();
      const photoId = file ? await uploadReceipt(file) : null;
      const name = who.el.value.trim();
      const entry = await api<{ id: string }>('/books/expenses', {
        method: 'POST',
        body: {
          date: date.value || today(),
          amount: cents,
          categoryId: cat.value,
          paidFromId: from.value,
          ...(name ? { payee: { name, kind: helperBox.checked ? 'contractor' : 'vendor' } } : {}),
          ...(job.value ? { jobId: job.value } : {}),
          ...(memo.value.trim() ? { memo: memo.value.trim() } : {}),
          ...(photoId ? { receiptKey: photoId } : {}),
        },
      });
      const said = `Saved: ${usd(cents)} for ${accountName(books, cat.value)}${name ? ` at ${name}` : ''}, paid with ${accountName(books, from.value)}.`;
      after.replaceChildren(!photoId && cents >= books.settings.receiptPromptOver ? snapPrompt(entry.id, ctx) : '');
      amount.value = '';
      who.el.value = '';
      memo.value = '';
      job.value = '';
      helperBox.checked = false;
      receipt.clear();
      await ctx.recount();
      return said;
    }),
  );

  return [
    who.list,
    h(
      'div',
      { class: 'flex flex-col gap-4' },
      grid(labelled('Amount ($)', amount), labelled('Date', date)),
      grid(labelled('What was it for?', cat), labelled('Paid with', from)),
      grid(
        h('div', { class: 'flex flex-col gap-2' }, labelled('Paid to', who.el), h('label', { class: 'flex items-center gap-2 text-sm text-bone-200' }, helperBox, 'This is a helper I pay (for the 1099 tax form)')),
        labelled('For a job? (optional)', job),
      ),
      labelled('Note', memo),
      receipt.el,
      h('div', { class: 'flex flex-wrap items-center gap-4 pt-2' }, save, status.el),
      after,
    ),
  ];
}

/** After a big expense with no photo: "Snap the receipt?" */
function snapPrompt(entryId: string, ctx: BooksCtx) {
  const pick = receiptPicker();
  const status = statusLine();
  const box = h(
    'div',
    { class: 'flex flex-wrap items-center gap-4 border-l-2 border-gold-500 bg-ink-900 py-3 pl-4 pr-3' },
    h('p', { class: 'text-sm text-bone-200' }, 'That\'s a big one. Snap the receipt?'),
    h('label', { class: `${goldSmall} cursor-pointer` }, 'Add the photo', pick),
    status.el,
  );
  pick.addEventListener('change', () => {
    const f = pick.files?.[0];
    if (!f) return;
    void status.run(null, async () => {
      const photoId = await uploadReceipt(f);
      await api(`/books/entries/${entryId}/receipt`, { method: 'POST', body: { photoId } });
      box.replaceChildren(h('p', { class: 'text-sm text-bone-200' }, 'Receipt saved.'));
      await ctx.recount();
    });
  });
  return box;
}

/* ------------------------------------------------------------ money in */

const METHODS: [string, string][] = [
  ['cash', 'Cash'],
  ['check', 'Check'],
  ['zelle', 'Zelle'],
  ['venmo', 'Venmo'],
  ['card', 'Card'],
  ['other', 'Other'],
];

function moneyIn(books: Books, payees: Payee[], jobs: Job[], ctx: BooksCtx): Child[] {
  const amount = moneyInput();
  const date = dateInput();
  const cat = select(categoryOptions(books, 'income'), 'income-detailing');
  const to = select(moneyOptions(books), 'checking');
  const method = select(METHODS, 'cash');
  const job = jobSelect(jobs);
  const who = payeeField(payees, 'Customer or company (optional)');
  const memo = textInput({ placeholder: 'Anything to remember (optional)' });
  const status = statusLine();

  method.addEventListener('change', () => {
    const want = method.value === 'cash' ? 'cash' : method.value === 'card' ? 'stripe' : 'checking';
    if (books.byId.get(want)?.moneyAccount) to.value = want;
  });
  job.addEventListener('change', () => {
    const j = jobs.find((x) => x.id === job.value);
    if (!j) return;
    if (!amount.value && j.finalPrice) amount.value = (j.finalPrice / 100).toFixed(2);
    if (!who.el.value) who.el.value = j.customer.name;
  });

  const save = button('Save', goldSmall, (b) =>
    status.run(b, async () => {
      const cents = amountOrThrow(amount);
      const name = who.el.value.trim();
      await api('/books/income', {
        method: 'POST',
        body: {
          date: date.value || today(),
          amount: cents,
          depositToId: to.value,
          categoryId: cat.value,
          method: method.value,
          ...(job.value ? { jobId: job.value } : {}),
          ...(name ? { payee: { name } } : {}),
          ...(memo.value.trim() ? { memo: memo.value.trim() } : {}),
        },
      });
      amount.value = '';
      who.el.value = '';
      memo.value = '';
      job.value = '';
      await ctx.recount();
      return `Saved: ${usd(cents)} in, to ${accountName(books, to.value)}.`;
    }),
  );

  return [
    who.list,
    h(
      'div',
      { class: 'flex flex-col gap-4' },
      grid(labelled('Amount ($)', amount), labelled('Date', date)),
      grid(labelled('For a job? (optional)', job), labelled('What kind of money?', cat)),
      grid(labelled('How they paid', method), labelled('Where it went', to)),
      grid(labelled('From', who.el), labelled('Note', memo)),
      h('div', { class: 'flex flex-wrap items-center gap-4 pt-2' }, save, status.el),
    ),
  ];
}

/* --------------------------------------------------------- moved money */

function moved(books: Books, _p: Payee[], _j: Job[], _ctx: BooksCtx): Child[] {
  const amount = moneyInput();
  const date = dateInput();
  const money = moneyOptions(books);
  const from = select([...money, ['owner-contributions', 'My own pocket (putting my money in)']], 'checking');
  const to = select([...money, ['owner-draws', 'Me (taking money for myself)']], 'owner-draws');
  const memo = textInput({ placeholder: 'Anything to remember (optional)' });
  const status = statusLine();

  const save = button('Save', goldSmall, (b) =>
    status.run(b, async () => {
      const cents = amountOrThrow(amount);
      if (from.value === to.value) throw new Error('Pick two different places.');
      await api('/books/transfers', {
        method: 'POST',
        body: { date: date.value || today(), amount: cents, fromId: from.value, toId: to.value, ...(memo.value.trim() ? { memo: memo.value.trim() } : {}) },
      });
      amount.value = '';
      memo.value = '';
      return `Saved: ${usd(cents)} from ${from.selectedOptions[0]?.textContent} to ${to.selectedOptions[0]?.textContent}.`;
    }),
  );

  return [
    h(
      'p',
      { class: 'mb-4 text-sm text-bone-400' },
      'Money that moved between your own accounts: paying off the business card, a Stripe payout to the bank, cash you took for yourself, or your own money you put in. None of this is profit or spending.',
    ),
    h(
      'div',
      { class: 'flex flex-col gap-4' },
      grid(labelled('Amount ($)', amount), labelled('Date', date)),
      grid(labelled('From', from), labelled('To', to)),
      labelled('Note', memo),
      h('div', { class: 'flex flex-wrap items-center gap-4 pt-2' }, save, status.el),
    ),
  ];
}

/* ---------------------------------------------------------------- drive */

function drive(books: Books, _p: Payee[], jobs: Job[], ctx: BooksCtx): Child[] {
  const date = dateInput();
  const miles = textInput({ inputmode: 'decimal', placeholder: 'Like 24' });
  const job = jobSelect(jobs);
  const purpose = textInput({ placeholder: 'Like: drive to a job in Fenton' });
  const from = textInput({ placeholder: 'Optional' });
  const to = textInput({ placeholder: 'Optional' });
  const status = statusLine();
  const rate = books.settings.mileageRates[today().slice(0, 4)];

  job.addEventListener('change', () => {
    const j = jobs.find((x) => x.id === job.value);
    if (!j) return;
    purpose.value = `Drive to ${j.customer.name}'s job`;
    to.value = j.address;
    date.value = j.date;
  });

  const save = button('Save', goldSmall, (b) =>
    status.run(b, async () => {
      const n = Number(miles.value.trim());
      if (!(n > 0)) throw new Error('Type how many miles, like 24.');
      if (!purpose.value.trim()) throw new Error('Say what the drive was for. The IRS asks.');
      await api('/books/trips', {
        method: 'POST',
        body: {
          date: date.value || today(),
          miles: n,
          purpose: purpose.value.trim(),
          ...(from.value.trim() ? { from: from.value.trim() } : {}),
          ...(to.value.trim() ? { to: to.value.trim() } : {}),
          ...(job.value ? { jobId: job.value } : {}),
        },
      });
      miles.value = '';
      purpose.value = '';
      from.value = '';
      to.value = '';
      job.value = '';
      date.value = today();
      await ctx.recount();
      return `Saved: ${n} miles${rate ? `. That takes about ${usd(Math.round(n * rate))} off your taxable profit` : ''}.`;
    }),
  );

  return [
    h(
      'p',
      { class: 'mb-4 text-sm text-bone-400' },
      'Log every drive for work: to jobs, to buy supplies, to the bank. Count there and back. See them all under Reports.',
    ),
    h(
      'div',
      { class: 'flex flex-col gap-4' },
      grid(labelled('Date', date), labelled('Miles', miles)),
      grid(labelled('For a job? (optional)', job), labelled('What was it for?', purpose)),
      grid(labelled('From', from), labelled('To', to)),
      h('div', { class: 'flex flex-wrap items-center gap-4 pt-2' }, save, status.el),
      h('p', {}, button('See this year\'s drives', textBtn, () => ctx.go('reports'))),
    ),
  ];
}
