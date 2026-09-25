/**
 * Books → To do: the weekly check-in. Everything the books need from Jacob,
 * in the order the app walks it: bank lines to sort, receipts to snap,
 * drives to log, jobs not paid yet. Then, quieter: what his rules filed this
 * week, lines he skipped, and what the books have learned.
 *
 * Every choice on a bank line teaches the books that merchant (unless he
 * unticks it), so each answer is worth saying out loud: "Next time AutoZone
 * files itself."
 */
import { type Child, h, api, small } from './core';
import type { BooksCtx } from './books';
import {
  type BankLine,
  type Books,
  type Inbox,
  type Payee,
  type Rule,
  askFirst,
  button,
  categoryOptions,
  goldSmall,
  kids,
  labelled,
  moneyInput,
  moneyOptions,
  moneyAccounts,
  parseCents,
  rowRule,
  select,
  shortDate,
  signed,
  statusLine,
  subHead,
  textBtn,
  textInput,
  today,
  uploadReceipt,
  receiptPicker,
  usd,
  accountName,
} from './books-lib';

/** Title-case a bank merchant key for reading: "AUTOZONE" → "Autozone". */
const nice = (m: string | null) => (m ?? '').toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) || 'This one';

export async function renderTodo(host: HTMLElement, ctx: BooksCtx) {
  const { books } = ctx;
  const [inbox, { lines }, { lines: skipped }, { rules }, { payees }] = await Promise.all([
    api<Inbox>('/books/inbox'),
    api<{ lines: BankLine[] }>('/books/bank-lines?status=unmatched'),
    api<{ lines: BankLine[] }>('/books/bank-lines?status=ignored'),
    api<{ rules: Rule[] }>('/books/rules'),
    api<{ payees: Payee[] }>('/books/payees'),
  ]);
  const payeeList = h('datalist', { id: 'books-payees' }, ...payees.map((p) => h('option', { value: p.name })));
  const reload = () => renderTodo(host, ctx).then(ctx.recount);

  const summary =
    inbox.total === 0
      ? "You're all caught up. Nothing needs you right now."
      : `${inbox.total} ${inbox.total === 1 ? 'thing needs' : 'things need'} you. Start at the top.`;

  host.replaceChildren(
    ...kids(
    payeeList,
    h('p', { class: 'max-w-2xl text-lg text-bone-50' }, summary),
    h(
      'p',
      { class: 'mt-1 max-w-2xl text-sm text-bone-400' },
      'Do this once a week: download your bank file, bring it in under ',
      button('Bank file', textBtn, () => ctx.go('bank')),
      ', then come back here.',
    ),
    bankSection(lines, inbox, books, ctx, reload),
    receiptsSection(inbox, ctx),
    drivesSection(inbox, ctx),
    unpaidSection(inbox, books, ctx),
    autoFiledSection(inbox, ctx, reload),
    skippedSection(skipped, books, reload),
    rulesSection(rules),
    ),
  );
}

/* ------------------------------------------------------- bank lines */

function bankSection(lines: BankLine[], inbox: Inbox, books: Books, ctx: BooksCtx, reload: () => Promise<void>) {
  if (!lines.length) {
    return h('div', {}, subHead('Bank lines to sort'), h('p', { class: 'text-sm text-bone-400' }, 'None waiting.'));
  }
  const rows = new Map<string, HTMLElement>();
  const list = h('ul', { class: 'border-t border-ink-800' });

  /** After any answer: lines that filed themselves by the new rule get a note instead of their buttons. */
  async function afterAnswer() {
    const { lines: still } = await api<{ lines: BankLine[] }>('/books/bank-lines?status=unmatched');
    const waiting = new Set(still.map((l) => l.id));
    for (const [id, row] of rows) {
      if (waiting.has(id) || row.dataset.done) continue;
      row.dataset.done = '1';
      const line = lines.find((l) => l.id === id)!;
      row.replaceChildren(doneNote(line, 'Filed itself, by the rule you just taught it.'));
    }
    count.textContent = still.length ? `${still.length} left.` : 'All sorted.';
    await ctx.recount();
  }

  for (const line of lines) {
    const row = h('li', { class: `${rowRule} py-4` });
    rows.set(line.id, row);
    row.append(...kids(...lineRow(line, inbox, books, row, afterAnswer)));
    list.append(row);
  }

  const count = h('span', { class: 'text-sm text-bone-400' }, `${lines.length} waiting.`);
  const withSuggestion = lines.filter((l) => l.suggestion);
  const all = statusLine();
  const takeAll =
    withSuggestion.length >= 2
      ? button(`Yes to all ${withSuggestion.length} guesses`, textBtn, (b) =>
          askFirst(
            b.parentElement!,
            `File all ${withSuggestion.length} lines the way the books guessed? You can still fix any of them later under All entries.`,
            'Yes, file them',
            'No',
            (yes) =>
              all.run(yes, async () => {
                let done = 0;
                for (const l of withSuggestion) {
                  await api(`/books/bank-lines/${l.id}`, { method: 'POST', body: { action: 'accept' } }).then(
                    () => done++,
                    () => undefined, // already filed by a rule a moment ago, or no longer fits
                  );
                }
                await reload();
                return `Filed ${done}.`;
              }),
          ),
        )
      : null;

  return h(
    'div',
    {},
    subHead(
      'Bank lines to sort',
      'Tell the books what each one was. When the books have a guess, it shows in gold: tap Yes if it\'s right. Whatever you pick, the books remember that store for next time.',
    ),
    h('div', { class: 'mb-3 flex flex-wrap items-center gap-x-6 gap-y-2' }, count, takeAll ? h('span', {}, takeAll) : null, all.el),
    list,
  );
}

function doneNote(line: BankLine, msg: Child) {
  return h(
    'div',
    { class: 'flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 text-sm' },
    h('p', { class: 'text-bone-400' }, h('span', { class: 'text-bone-200' }, nice(line.merchant)), ' · ', msg),
    h('p', { class: 'tabular-nums text-bone-500' }, signed(line.amount)),
  );
}

function lineRow(line: BankLine, inbox: Inbox, books: Books, row: HTMLElement, after: () => Promise<void>): Child[] {
  const out = line.amount < 0;
  const merchant = nice(line.merchant);
  const status = statusLine();
  const form = h('div', { class: 'mt-3', hidden: true });

  async function answer(btn: HTMLButtonElement | null, body: Record<string, unknown>, said: string) {
    await status.run(btn, async () => {
      await api(`/books/bank-lines/${line.id}`, { method: 'POST', body });
      row.dataset.done = '1';
      const learns = body.remember !== false && ['categorize', 'transfer', 'personal'].includes(String(body.action));
      row.replaceChildren(doneNote(line, h('span', {}, said, learns ? ` Next time ${merchant} files itself.` : '')));
      await after();
    });
  }

  const openForm = (...children: Child[]) => {
    form.replaceChildren(
      h('div', { class: 'flex flex-col gap-3 border-l-2 border-ink-700 pl-4' }, ...children),
    );
    form.hidden = false;
  };
  const remember = () => {
    const box = h('input', { type: 'checkbox', class: 'size-4 accent-[#e8b14c]', checked: true }) as HTMLInputElement;
    return { box, el: h('label', { class: 'flex items-center gap-2 text-sm text-bone-200' }, box, `Next time, file ${merchant} like this by itself`) };
  };

  const pickCategory = () => {
    const cat = select(categoryOptions(books, out ? 'expense' : 'income'), out ? 'supplies' : 'income-detailing');
    const who = textInput({ list: 'books-payees', placeholder: out ? 'Store or person (optional)' : 'Who paid (optional)' });
    const rem = remember();
    const save = button('Save', goldSmall, (b) => {
      const name = who.value.trim();
      void answer(
        b,
        { action: 'categorize', categoryId: cat.value, ...(name ? { payee: { name } } : {}), remember: rem.box.checked },
        `Filed as ${accountName(books, cat.value)}.`,
      );
    });
    openForm(
      h('div', { class: 'grid gap-3 sm:grid-cols-2' }, labelled(out ? 'What was it for?' : 'What kind of money?', cat), labelled(out ? 'Paid to' : 'From', who)),
      rem.el,
      h('div', { class: 'flex items-center gap-4' }, save, button('Cancel', textBtn, () => (form.hidden = true))),
    );
  };

  const pickTransfer = () => {
    const others = moneyOptions(books).filter(([id]) => id !== line.accountId);
    const other = select(others);
    const rem = remember();
    openForm(
      h(
        'p',
        { class: 'text-sm text-bone-400' },
        out ? 'Money you moved to another of your accounts, like paying off the business card.' : 'Money that came from another of your accounts.',
      ),
      labelled(out ? 'Moved to' : 'Came from', other, 'sm:max-w-sm'),
      rem.el,
      h(
        'div',
        { class: 'flex items-center gap-4' },
        button('Save', goldSmall, (b) =>
          answer(b, { action: 'transfer', otherAccountId: other.value, remember: rem.box.checked }, `Moved ${out ? 'to' : 'from'} ${accountName(books, other.value)}.`),
        ),
        button('Cancel', textBtn, () => (form.hidden = true)),
      ),
    );
  };

  const pickJob = () => {
    const jobs = inbox.unpaidJobs;
    if (!jobs.length) {
      openForm(
        h(
          'p',
          { class: 'text-sm text-bone-400' },
          'No finished jobs are waiting to be paid. Mark the job done on the Calendar first, or use "Pick what it was" and choose Detailing.',
        ),
        button('Close', textBtn, () => (form.hidden = true)),
      );
      return;
    }
    const job = select(jobs.map((j) => [j.jobId, `${j.customer}, ${shortDate(j.date)}${j.amount ? ` (${usd(j.amount)})` : ''}`]));
    openForm(
      labelled('Which job?', job, 'sm:max-w-md'),
      h(
        'div',
        { class: 'flex items-center gap-4' },
        button('Save', goldSmall, (b) => {
          const j = jobs.find((x) => x.jobId === job.value)!;
          void answer(b, { action: 'job', jobId: job.value }, `Payment for ${j.customer}'s job.`);
        }),
        button('Cancel', textBtn, () => (form.hidden = true)),
      ),
    );
  };

  const s = line.suggestion;
  // The API writes dates as 2026-09-23; say "Sep 23".
  const label = s ? s.label.replace(/\b\d{4}-\d{2}-\d{2}\b/g, (d) => shortDate(d)) : '';
  const guess = s
    ? h(
        'div',
        { class: 'mt-3 flex flex-wrap items-center gap-x-4 gap-y-2' },
        h('p', { class: 'text-sm text-gold-400' }, `${label}.`),
        button('Yes', goldSmall, (b) => answer(b, { action: 'accept' }, label.replace(/^Looks like /, 'Filed as ').replace(/^Looks /, 'Filed as ') + '.')),
      )
    : null;

  const actions = h(
    'div',
    { class: 'mt-3 flex flex-wrap gap-x-5 gap-y-2' },
    button(s ? 'No, pick what it was' : 'Pick what it was', textBtn, pickCategory),
    !out ? button('A customer paid for a job', textBtn, pickJob) : null,
    button('That was personal', textBtn, (b) =>
      answer(b, { action: 'personal' }, out ? 'Counted as money you took for yourself.' : 'Counted as your own money put in.'),
    ),
    button(out ? 'Moved to my other account' : 'Came from my other account', textBtn, pickTransfer),
    button('Skip it', textBtn, (b) => answer(b, { action: 'ignore' }, 'Skipped. It stays out of the books.')),
  );

  return [
    h(
      'div',
      { class: 'grid grid-cols-[1fr_auto] gap-x-4 sm:grid-cols-[5rem_1fr_auto]' },
      h('p', { class: 'col-span-2 text-xs text-bone-500 sm:col-span-1 sm:pt-0.5 sm:text-sm sm:text-bone-400' }, shortDate(line.date)),
      h(
        'div',
        { class: 'min-w-0' },
        h('p', { class: 'font-semibold text-bone-50' }, merchant),
        h('p', { class: 'break-words text-xs text-bone-500' }, line.description),
      ),
      h('p', { class: `text-right text-lg tabular-nums ${out ? 'text-bone-50' : 'text-gold-400'}` }, signed(line.amount)),
    ),
    h('div', { class: 'sm:pl-[6rem]' }, guess, actions, form, h('div', { class: 'mt-2' }, status.el)),
  ];
}

/* ----------------------------------------------------------- receipts */

function receiptsSection(inbox: Inbox, ctx: BooksCtx) {
  if (!inbox.receiptsMissing.length) return null;
  const over = usd(ctx.books.settings.receiptPromptOver);
  return h(
    'div',
    {},
    subHead('Receipts to snap', `Spending of ${over} or more should have a picture of the receipt, in case the IRS asks.`),
    h(
      'ul',
      { class: 'border-t border-ink-800' },
      ...inbox.receiptsMissing.map((r) => {
        const row = h('li', { class: `${rowRule} flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3` });
        const status = statusLine();
        const pick = receiptPicker();
        pick.addEventListener('change', () => {
          const file = pick.files?.[0];
          if (!file) return;
          void status.run(null, async () => {
            const photoId = await uploadReceipt(file);
            await api(`/books/entries/${r.entryId}/receipt`, { method: 'POST', body: { photoId } });
            row.replaceChildren(h('p', { class: 'text-sm text-bone-400' }, `${r.payee ?? r.memo ?? 'Receipt'} · Receipt saved.`));
            await ctx.recount();
          });
        });
        row.append(
          h(
            'div',
            { class: 'min-w-0' },
            h('p', { class: 'text-bone-50' }, r.payee ?? r.memo ?? 'Money out'),
            h('p', { class: 'text-sm text-bone-400' }, `${shortDate(r.date)} · ${usd(r.amount)}`),
          ),
          h(
            'div',
            { class: 'flex flex-col items-start gap-1 sm:items-end' },
            h('label', { class: `${goldSmall} cursor-pointer` }, 'Add the photo', pick),
            status.el,
          ),
        );
        return row;
      }),
    ),
  );
}

/* ------------------------------------------------------------- drives */

function drivesSection(inbox: Inbox, ctx: BooksCtx) {
  if (!inbox.tripsToLog.length) return null;
  const rate = ctx.books.settings.mileageRates[today().slice(0, 4)];
  return h(
    'div',
    {},
    subHead(
      'Drives to log',
      rate
        ? `Every mile you drive for work takes ${rate}¢ off your taxes. Type the miles for each job, there and back.`
        : 'Every mile you drive for work lowers your taxes. Type the miles for each job, there and back.',
    ),
    h(
      'ul',
      { class: 'border-t border-ink-800' },
      ...inbox.tripsToLog.map((t) => {
        const row = h('li', { class: `${rowRule} grid gap-3 py-3 sm:grid-cols-[1fr_auto] sm:items-end` });
        const miles = textInput({ inputmode: 'decimal', placeholder: 'Miles' });
        miles.classList.add('w-28');
        const status = statusLine();
        const log = button('Log it', goldSmall, (b) =>
          status.run(b, async () => {
            const n = Number(miles.value.trim());
            if (!(n > 0)) throw new Error('Type how many miles, like 24.');
            await api('/books/trips', {
              method: 'POST',
              body: { date: t.date, miles: n, purpose: `Drive to ${t.customer}'s job`, to: t.address, jobId: t.jobId },
            });
            row.replaceChildren(h('p', { class: 'text-sm text-bone-400' }, `${t.customer} · ${n} miles logged.`));
            await ctx.recount();
          }),
        );
        row.append(
          h('div', { class: 'min-w-0' }, h('p', { class: 'text-bone-50' }, t.customer), h('p', { class: 'text-sm text-bone-400' }, `${shortDate(t.date)} · ${t.address}`)),
          h('div', { class: 'flex flex-col gap-1' }, h('div', { class: 'flex items-end gap-3' }, labelled('Miles', miles), log), status.el),
        );
        return row;
      }),
    ),
  );
}

/* --------------------------------------------------------- unpaid jobs */

const METHODS: [string, string][] = [
  ['cash', 'Cash'],
  ['check', 'Check'],
  ['zelle', 'Zelle'],
  ['venmo', 'Venmo'],
  ['card', 'Card'],
  ['other', 'Other'],
];

function unpaidSection(inbox: Inbox, books: Books, ctx: BooksCtx) {
  if (!inbox.unpaidJobs.length) return null;
  return h(
    'div',
    {},
    subHead('Jobs not paid yet', 'Finished jobs with no payment in the books. If the money is in your bank file, sort that line instead: it will match the job.'),
    h(
      'ul',
      { class: 'border-t border-ink-800' },
      ...inbox.unpaidJobs.map((j) => {
        const row = h('li', { class: `${rowRule} py-3` });
        const form = h('div', { class: 'mt-3', hidden: true });
        const status = statusLine();
        const open = () => {
          const amount = moneyInput(j.amount);
          const method = select(METHODS, 'cash');
          const money = moneyAccounts(books);
          const to = select(moneyOptions(books), money.some((a) => a.id === 'cash') ? 'cash' : money[0]?.id);
          method.addEventListener('change', () => {
            const want = method.value === 'cash' ? 'cash' : method.value === 'card' ? 'stripe' : 'checking';
            if (money.some((a) => a.id === want)) to.value = want;
          });
          form.replaceChildren(
            h(
              'div',
              { class: 'flex flex-col gap-3 border-l-2 border-ink-700 pl-4' },
              h('div', { class: 'grid grid-cols-2 gap-3 sm:grid-cols-3' }, labelled('Amount ($)', amount), labelled('How', method), labelled('Where it went', to, 'col-span-2 sm:col-span-1')),
              h(
                'div',
                { class: 'flex items-center gap-4' },
                button('Save payment', goldSmall, (b) =>
                  status.run(b, async () => {
                    const cents = parseCents(amount.value);
                    if (!cents) throw new Error('Type the amount, like 165.00.');
                    await api('/books/income', {
                      method: 'POST',
                      body: { date: today(), amount: cents, depositToId: to.value, jobId: j.jobId, method: method.value },
                    });
                    row.replaceChildren(h('p', { class: 'text-sm text-bone-400' }, `${j.customer} · Paid ${usd(cents)}.`));
                    await ctx.recount();
                  }),
                ),
                button('Cancel', textBtn, () => (form.hidden = true)),
              ),
            ),
          );
          form.hidden = false;
        };
        row.append(
          h(
            'div',
            { class: 'flex flex-wrap items-center justify-between gap-x-6 gap-y-2' },
            h('div', {}, h('p', { class: 'text-bone-50' }, j.customer), h('p', { class: 'text-sm text-bone-400' }, `${shortDate(j.date)}${j.amount ? ` · ${usd(j.amount)}` : ''}`)),
            button('Mark paid', textBtn, open),
          ),
          form,
          h('div', { class: 'mt-2' }, status.el),
        );
        return row;
      }),
    ),
  );
}

/* ---------------------------------------------------------- auto-filed */

function autoFiledSection(inbox: Inbox, ctx: BooksCtx, reload: () => Promise<void>) {
  if (!inbox.autoFiled.length) return null;
  return h(
    'div',
    {},
    subHead('Filed for you this week', 'Your rules filed these by themselves. Glance down the list. If one is wrong, undo it and it comes back up top to sort.'),
    h(
      'ul',
      { class: 'border-t border-ink-800' },
      ...inbox.autoFiled.map((a) => {
        const status = statusLine();
        const actions = h(
          'div',
          { class: 'flex flex-wrap items-center gap-x-5 gap-y-2' },
          button('Open', textBtn, () => ctx.go('entries', { entryId: a.entryId })),
          button("That's wrong", textBtn, () =>
            askFirst(actions, 'Undo this one? It goes back to the top of this page so you can say what it was.', 'Yes, undo it', 'No', (b) =>
              status.run(b, async () => {
                await api(`/books/entries/${a.entryId}/void`, { method: 'POST', body: {} });
                await reload();
              }),
            ),
          ),
        );
        return h(
          'li',
          { class: `${rowRule} grid gap-2 py-3 sm:grid-cols-[5rem_1fr_auto_auto] sm:items-center sm:gap-6` },
          h('p', { class: 'text-sm text-bone-400' }, shortDate(a.date)),
          h('p', { class: 'min-w-0 break-words text-sm text-bone-200' }, a.description),
          h('p', { class: 'tabular-nums text-bone-200' }, signed(a.amount)),
          h('div', {}, actions, status.el),
        );
      }),
    ),
  );
}

/* ------------------------------------------------------------- skipped */

function skippedSection(skipped: BankLine[], books: Books, reload: () => Promise<void>) {
  if (!skipped.length) return null;
  return h(
    'details',
    { class: 'mt-10 border-t border-ink-800 pt-4' },
    h('summary', { class: `${small} cursor-pointer select-none hover:text-bone-200` }, `Lines you skipped (${skipped.length})`),
    h(
      'ul',
      { class: 'mt-3' },
      ...skipped.slice(0, 50).map((l) => {
        const status = statusLine();
        return h(
          'li',
          { class: `${rowRule} flex flex-wrap items-center justify-between gap-x-6 gap-y-1 py-2 text-sm` },
          h('span', { class: 'text-bone-400' }, `${shortDate(l.date)} · ${nice(l.merchant)} · ${accountName(books, l.accountId)}`),
          h(
            'span',
            { class: 'flex items-center gap-4' },
            h('span', { class: 'tabular-nums text-bone-200' }, signed(l.amount)),
            button('Bring it back', textBtn, (b) =>
              status.run(b, async () => {
                await api(`/books/bank-lines/${l.id}`, { method: 'POST', body: { action: 'unignore' } });
                await reload();
              }),
            ),
            status.el,
          ),
        );
      }),
    ),
  );
}

/* --------------------------------------------------------------- rules */

function ruleWords(r: Rule) {
  if (r.action === 'personal') return r.direction === 'out' ? 'Money you took for yourself' : 'Your own money put in';
  if (r.action === 'transfer') return `${r.direction === 'out' ? 'Moved to' : 'Came from'} ${r.otherAccountName ?? 'another account'}`;
  return `${r.categoryName ?? 'A category'}${r.payee?.name ? `, paid to ${r.payee.name}` : ''}`;
}

function rulesSection(rules: Rule[]) {
  return h(
    'details',
    { class: 'mt-6 border-t border-ink-800 pt-4' },
    h('summary', { class: `${small} cursor-pointer select-none hover:text-bone-200` }, `What the books have learned (${rules.length})`),
    h(
      'p',
      { class: 'mt-3 max-w-2xl text-sm text-bone-400' },
      rules.length
        ? 'Each time you sort a bank line, the books remember that store. Forget one and its lines wait for you again. Lines it already filed stay filed.'
        : 'Nothing yet. Each time you sort a bank line, the books remember that store, and it shows here.',
    ),
    h(
      'ul',
      { class: 'mt-3 border-t border-ink-800' },
      ...rules.map((r) => {
        const status = statusLine();
        const right = h(
          'div',
          { class: 'flex items-center gap-4' },
          h('span', { class: 'text-xs text-bone-500 tabular-nums' }, r.hits === 0 ? 'Hasn\'t filed any yet' : r.hits === 1 ? 'Filed 1 by itself' : `Filed ${r.hits} by itself`),
          button('Forget', textBtn, () =>
            askFirst(right, `Forget ${nice(r.merchant)}? Next time it waits for you to sort it.`, 'Yes, forget it', 'No', (b) =>
              status.run(b, async () => {
                await api(`/books/rules/${r.id}`, { method: 'DELETE' });
                right.closest('li')?.remove();
              }),
            ),
          ),
        );
        return h(
          'li',
          { class: `${rowRule} flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3` },
          h(
            'div',
            { class: 'min-w-0' },
            h('p', { class: 'text-bone-50' }, nice(r.merchant), h('span', { class: 'ml-2 text-xs text-bone-500' }, r.direction === 'out' ? 'money out' : 'money in')),
            h('p', { class: 'text-sm text-bone-400' }, ruleWords(r)),
          ),
          h('div', {}, right, status.el),
        );
      }),
    ),
  );
}
