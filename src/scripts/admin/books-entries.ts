/**
 * Books → All entries: everything in the books for a stretch of time, newest
 * first, with filters. Open one to see it in plain words, its receipt, or to
 * void it. There is no edit and no delete: a void posts the exact opposite
 * (the history stays), and he enters it again the right way.
 */
import { h, api, small } from './core';
import type { BooksCtx } from './books';
import {
  type Books,
  type Entry,
  askFirst,
  button,
  describe,
  kindWord,
  labelled,
  periods,
  photoUrl,
  receiptPicker,
  rowRule,
  select,
  shortDate,
  statusLine,
  subHead,
  textBtn,
  textInput,
  uploadReceipt,
  usd,
} from './books-lib';

/** Filters survive switching parts while the page is open. */
const filters = { period: '30d', account: '', kind: '', q: '', hideVoids: true };

export async function renderEntries(host: HTMLElement, ctx: BooksCtx, openId?: string) {
  const { books } = ctx;
  const ps = periods();
  const period = select(ps.map((p) => [p.key, p.label]), filters.period);
  const account = select(
    [
      ['', 'Every account'],
      { group: 'Bank, card and cash', options: books.accounts.filter((a) => a.moneyAccount).map((a) => [a.id, a.name]) },
      { group: 'Money out', options: books.accounts.filter((a) => a.type === 'expense').map((a) => [a.id, a.name]) },
      { group: 'Money in', options: books.accounts.filter((a) => a.type === 'income').map((a) => [a.id, a.name]) },
      { group: 'Owner', options: books.accounts.filter((a) => a.type === 'equity').map((a) => [a.id, a.name]) },
    ],
    filters.account,
  );
  const kind = select(
    [
      ['', 'Everything'],
      ['expense', 'Money out'],
      ['income', 'Money in'],
      ['transfer', 'Moved money'],
    ],
    filters.kind,
  );
  const search = textInput({ value: filters.q, placeholder: 'Store, note or amount' });
  const hideBox = h('input', { type: 'checkbox', class: 'size-4 accent-[#e8b14c]', checked: filters.hideVoids }) as HTMLInputElement;
  const list = h('div', { class: 'mt-6' });
  const opened = h('div');

  let entries: Entry[] = [];

  async function load() {
    const p = ps.find((x) => x.key === period.value) ?? ps[0]!;
    list.replaceChildren(h('p', { class: 'text-bone-400' }, 'Loading…'));
    const q = new URLSearchParams({ from: p.from, to: p.to });
    if (account.value) q.set('accountId', account.value);
    entries = (await api<{ entries: Entry[] }>(`/books/entries?${q}`)).entries;
    draw();
  }

  function draw() {
    const words = search.value.trim().toLowerCase();
    const shown = entries.filter((e) => {
      if (filters.hideVoids && (e.voidedBy || e.kind === 'reversal')) return false;
      if (kind.value && e.kind !== kind.value) return false;
      if (!words) return true;
      const d = describe(books, e);
      return [d.title, d.category, e.memo ?? '', usd(Math.abs(d.amount)), (Math.abs(d.amount) / 100).toFixed(2)].some((s) => s.toLowerCase().includes(words));
    });
    if (!shown.length) {
      list.replaceChildren(h('p', { class: 'border-t border-ink-800 pt-4 text-bone-400' }, entries.length ? 'Nothing matches. Try fewer filters.' : 'Nothing in the books for these dates yet.'));
      return;
    }
    const inSum = shown.filter((e) => e.kind === 'income').reduce((s, e) => s + describe(books, e).amount, 0);
    const outSum = shown.filter((e) => e.kind === 'expense').reduce((s, e) => s - describe(books, e).amount, 0);
    list.replaceChildren(
      h(
        'p',
        { class: 'mb-3 text-sm text-bone-400' },
        `${shown.length} ${shown.length === 1 ? 'entry' : 'entries'}`,
        inSum ? ` · ${usd(inSum)} in` : '',
        outSum ? ` · ${usd(outSum)} out` : '',
        entries.length >= 1000 ? ' · Showing the newest 1,000. Pick a shorter time.' : '',
      ),
      h('ul', { class: 'border-t border-ink-800' }, ...shown.map((e) => entryRow(e, books, ctx, load))),
    );
  }

  for (const el of [period, account]) el.addEventListener('change', () => ((filters.period = period.value), (filters.account = account.value), load()));
  kind.addEventListener('change', () => ((filters.kind = kind.value), draw()));
  search.addEventListener('input', () => ((filters.q = search.value), draw()));
  hideBox.addEventListener('change', () => ((filters.hideVoids = hideBox.checked), draw()));

  host.replaceChildren(
    subHead('All entries', 'Everything in the books, newest first. Tap one to see it, add its receipt, or void it.'),
    opened,
    h(
      'div',
      { class: 'grid grid-cols-2 gap-3 sm:grid-cols-4' },
      labelled('When', period),
      labelled('Account', account),
      labelled('Kind', kind),
      labelled('Search', search),
    ),
    h('label', { class: 'mt-3 flex items-center gap-2 text-sm text-bone-200' }, hideBox, 'Hide voided entries'),
    list,
  );

  if (openId) {
    const e = await api<Entry>(`/books/entries/${encodeURIComponent(openId)}`);
    const row = entryRow(e, books, ctx, load, true);
    opened.replaceChildren(
      h('p', { class: `${small} mb-2` }, 'The one you opened'),
      h('ul', { class: 'mb-8 border-t border-ink-800' }, row),
    );
  }
  await load();
}

function entryRow(e: Entry, books: Books, ctx: BooksCtx, reload: () => Promise<void>, startOpen = false) {
  const d = describe(books, e);
  const dead = !!e.voidedBy || e.kind === 'reversal';
  const detail = h('div', { class: 'pb-4', hidden: true });
  const head = h(
    'button',
    {
      type: 'button',
      'aria-expanded': 'false',
      class:
        'grid w-full grid-cols-[1fr_auto] gap-x-4 py-3 text-left transition-colors hover:bg-ink-900 sm:grid-cols-[5rem_1fr_auto] ' +
        'aria-expanded:shadow-[inset_2px_0_0_var(--color-gold-500)] aria-expanded:pl-3',
    },
    h('span', { class: 'col-span-2 text-xs text-bone-500 sm:col-span-1 sm:pt-0.5 sm:text-sm sm:text-bone-400' }, shortDate(e.date)),
    h(
      'span',
      { class: 'min-w-0' },
      h('span', { class: `block truncate ${dead ? 'text-bone-400 line-through' : 'text-bone-50'}` }, d.title),
      h(
        'span',
        { class: 'block truncate text-sm text-bone-400' },
        e.kind === 'reversal' ? 'Cancels out an earlier entry' : e.voidedBy ? `Voided · ${d.category}` : d.category,
        e.receiptKey ? ' · Receipt' : '',
      ),
    ),
    h(
      'span',
      { class: `text-right tabular-nums ${dead ? 'text-bone-500' : e.kind === 'income' ? 'text-gold-400' : 'text-bone-50'}` },
      e.kind === 'transfer' ? usd(d.amount) : d.amount > 0 ? `+${usd(d.amount)}` : usd(d.amount),
    ),
  );
  const toggle = () => {
    const open = detail.hidden;
    detail.hidden = !open;
    head.setAttribute('aria-expanded', String(open));
    if (open && !detail.childNodes.length) detail.append(...entryDetail(e, books, ctx, reload));
  };
  head.addEventListener('click', toggle);
  const li = h('li', { class: rowRule }, head, detail);
  if (startOpen) toggle();
  return li;
}

function entryDetail(e: Entry, books: Books, ctx: BooksCtx, _reload: () => Promise<void>) {
  const d = describe(books, e);
  const status = statusLine();
  const facts: [string, string][] = [
    ['Kind', kindWord[e.kind]],
    ['Date', new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', dateStyle: 'long' }).format(new Date(`${e.date}T12:00:00Z`))],
    ['Amount', usd(Math.abs(d.amount))],
  ];
  if (e.kind === 'expense') facts.push(['For', d.category], ['Paid with', d.from]);
  else if (e.kind === 'income') facts.push(['Kind of money', d.category], ['Went into', d.from]);
  else facts.push(['Moved', d.category]);
  if (e.payee?.name) facts.push([e.kind === 'income' ? 'From' : 'Paid to', e.payee.name]);
  if (e.method) facts.push(['How', e.method.charAt(0).toUpperCase() + e.method.slice(1)]);
  if (e.jobId) facts.push(['Job', 'Linked to a job']);
  if (e.memo) facts.push(['Note', e.memo]);

  const receiptBox = h('div', { class: 'flex flex-col items-start gap-2' });
  if (e.receiptKey) {
    receiptBox.append(
      button('Show the receipt', textBtn, (b) =>
        status.run(b, async () => {
          const url = await photoUrl(e.receiptKey!);
          receiptBox.replaceChildren(
            h('a', { href: url, target: '_blank', rel: 'noopener' }, h('img', { src: url, alt: 'Receipt', class: 'max-h-96 w-auto border border-ink-700' })),
          );
        }),
      ),
    );
  } else if (e.kind === 'expense' && !e.voidedBy) {
    const pick = receiptPicker();
    pick.addEventListener('change', () => {
      const f = pick.files?.[0];
      if (!f) return;
      void status.run(null, async () => {
        const photoId = await uploadReceipt(f);
        await api(`/books/entries/${e.id}/receipt`, { method: 'POST', body: { photoId } });
        e.receiptKey = photoId;
        receiptBox.replaceChildren(h('p', { class: 'text-sm text-bone-200' }, 'Receipt saved.'));
        await ctx.recount();
      });
    });
    receiptBox.append(h('label', { class: `${textBtn} cursor-pointer` }, 'Add a receipt photo', pick));
  }

  const actions = h('div', { class: 'flex flex-wrap items-center gap-x-5 gap-y-2' });
  if (e.kind === 'reversal') {
    actions.append(h('p', { class: 'text-sm text-bone-400' }, 'This is a void. It cancels out an earlier entry, so together they count as zero.'));
    if (e.reverses) actions.append(button('Open the entry it cancels', textBtn, () => ctx.go('entries', { entryId: e.reverses! })));
  } else if (e.voidedBy) {
    actions.append(h('p', { class: 'text-sm text-bone-400' }, 'Voided. A matching entry cancels it out, so it counts as zero.'));
  } else {
    actions.append(
      button('Void this', textBtn, () =>
        askFirst(
          actions,
          h(
            'span',
            {},
            'Void this entry? The books keep it, and add the exact opposite next to it, so it counts as zero. To fix a mistake: void it, then add it again the right way. If it came from your bank file, that bank line goes back to To do.',
          ),
          'Yes, void it',
          'Keep it',
          (b) =>
            status.run(b, async () => {
              await api(`/books/entries/${e.id}/void`, { method: 'POST', body: {} });
              await ctx.recount();
              ctx.go('entries', { entryId: e.id }); // show it again, now marked void
            }),
        ),
      ),
    );
  }

  return [
    h(
      'dl',
      { class: 'grid grid-cols-[7rem_1fr] gap-x-4 gap-y-1.5 border-l border-ink-700 py-1 pl-4 text-sm sm:ml-[5rem]' },
      ...facts.flatMap(([k, v]) => [h('dt', { class: 'text-bone-500' }, k), h('dd', { class: 'min-w-0 break-words text-bone-200' }, v)]),
    ),
    h('div', { class: 'mt-4 flex flex-col gap-3 sm:ml-[5rem] sm:pl-4' }, receiptBox, actions, status.el),
  ];
}
