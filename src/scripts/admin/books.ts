/**
 * The Books tab: Jacob's replacement for QuickBooks. Built so the weekly
 * habit is one screen ("To do") and a bank file, not bookkeeping. Each part
 * lives in its own books-*.ts file; this one draws the switcher between them.
 *
 * Jacob never sees debits or credits. Entries are never edited or deleted:
 * a mistake is voided (the API posts the exact opposite) and entered again.
 */
import { $, h, api, heading, headingStyle } from './core';
import { loadBooks, type Books, type Inbox } from './books-lib';
import { renderTodo } from './books-todo';
import { renderBank } from './books-bank';
import { renderAdd } from './books-add';
import { renderEntries } from './books-entries';
import { renderReports } from './books-reports';
import { renderSettings } from './books-settings';

export type BooksPart = 'todo' | 'bank' | 'add' | 'entries' | 'reports' | 'settings';

export interface BooksCtx {
  books: Books;
  /** Switch to another part, e.g. after a bank file: go('todo'). */
  go: (part: BooksPart, opts?: { entryId?: string; addKind?: string }) => void;
  /** Re-count the To do list after something is dealt with. */
  recount: () => Promise<void>;
}

const PARTS: [BooksPart, string][] = [
  ['todo', 'To do'],
  ['bank', 'Bank file'],
  ['add', 'Add'],
  ['entries', 'All entries'],
  ['reports', 'Reports'],
  ['settings', 'Settings'],
];

/** Remembered while the page is open, so switching tabs comes back to the same place. */
let current: BooksPart = 'todo';

export async function renderBooks() {
  const view = $('[data-view="books"]');
  const books = await loadBooks();
  const body = h('div', { class: 'mt-6' });
  const badges = new Map<BooksPart, HTMLElement>();

  const nav = h(
    'div',
    { role: 'tablist', 'aria-label': 'Books', class: 'grid grid-cols-3 border-l border-t border-ink-700 sm:flex sm:w-fit' },
    ...PARTS.map(([key, label]) => {
      const count = h('span', { class: 'ml-1.5 tabular-nums text-gold-400' });
      badges.set(key, count);
      const b = h(
        'button',
        {
          type: 'button',
          role: 'tab',
          'data-part': key,
          class:
            'border-b border-r border-ink-700 px-3 py-2.5 text-left text-sm text-bone-400 transition-colors hover:text-bone-50 sm:px-5 ' +
            'aria-selected:bg-ink-900 aria-selected:text-bone-50 aria-selected:shadow-[inset_0_-2px_0_var(--color-gold-500)] ' +
            'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold-400',
        },
        label,
        count,
      );
      b.addEventListener('click', () => go(key));
      return b;
    }),
  );

  const recount = async () => {
    const inbox = await api<Inbox>('/books/inbox').catch(() => null);
    badges.get('todo')!.textContent = inbox && inbox.total ? String(inbox.total) : '';
  };

  const ctx: BooksCtx = { books, go, recount };

  function go(part: BooksPart, opts: { entryId?: string; addKind?: string } = {}) {
    current = part;
    for (const b of nav.querySelectorAll<HTMLElement>('[data-part]')) b.setAttribute('aria-selected', String(b.dataset.part === part));
    body.replaceChildren(h('p', { class: 'text-bone-400' }, 'Loading…'));
    const draw = {
      todo: () => renderTodo(body, ctx),
      bank: () => renderBank(body, ctx),
      add: () => renderAdd(body, ctx, opts.addKind),
      entries: () => renderEntries(body, ctx, opts.entryId),
      reports: () => renderReports(body, ctx),
      settings: () => renderSettings(body, ctx),
    }[part];
    draw().catch((err: Error) => {
      body.replaceChildren(h('p', { class: 'border-l-2 border-red-400 pl-4 text-red-300', role: 'alert' }, err.message));
    });
  }

  view.replaceChildren(
    h(
      'div',
      { class: 'flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1' },
      h('h2', { class: heading, style: headingStyle }, 'Books'),
      h('p', { class: 'text-sm text-bone-400' }, 'Money in, money out, and what the tax man needs.'),
    ),
    h('div', { class: 'mt-5' }, nav),
    body,
  );
  go(current);
  void recount();
}
