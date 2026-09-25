/**
 * Books → Bank file: bring in a statement downloaded from the bank. The file
 * is read here first (readBankFile, the same reader the API uses) so Jacob
 * sees what's in it before anything is saved; then the API matches, files
 * and suggests, and the result is said in plain words.
 */
import { readBankFile, type BankRow } from '@ked/books';
import { h, api } from './core';
import type { BooksCtx } from './books';
import { button, kids, goldSmall, labelled, moneyAccounts, select, shortDate, statusLine, subHead, textBtn, usd } from './books-lib';

interface ImportResult {
  rows: number;
  added: number;
  duplicates: number;
  matched: number;
  filed: number;
  suggested: number;
  waiting: number;
  problems: string[];
}

export async function renderBank(host: HTMLElement, ctx: BooksCtx) {
  const accounts = moneyAccounts(ctx.books);
  const account = select(accounts.map((a) => [a.id, a.name]), accounts.some((a) => a.id === 'checking') ? 'checking' : accounts[0]?.id);
  const picker = h('input', { type: 'file', accept: '.qfx,.ofx,.qbo,.csv,text/csv', class: 'sr-only' }) as HTMLInputElement;
  const invertBox = h('input', { type: 'checkbox', class: 'size-4 accent-[#e8b14c]' }) as HTMLInputElement;
  const invert = h(
    'label',
    { class: 'flex items-start gap-2 text-sm text-bone-200', hidden: true },
    invertBox,
    h('span', {}, 'This is a credit card file where purchases show as plus numbers. (Only tick this if the preview below has money in and out backwards.)'),
  );
  const preview = h('div', { class: 'mt-4' });
  const result = h('div', { class: 'mt-6' });
  const status = statusLine();
  const bringIn = button('Bring it in', goldSmall) as HTMLButtonElement;
  bringIn.hidden = true;

  let file: { name: string; text: string } | null = null;

  const drop = h(
    'label',
    {
      class:
        'flex cursor-pointer flex-col items-start gap-1 border border-dashed border-ink-600 bg-ink-900 px-5 py-6 transition-colors hover:border-gold-500 focus-within:border-gold-500',
    },
    h('span', { class: 'font-semibold text-bone-50', 'data-file-name': true }, 'Choose the bank file'),
    h('span', { class: 'text-sm text-bone-400' }, 'Or drag it here. Files that end in .qfx, .ofx, .qbo or .csv.'),
    picker,
  );

  function showPreview() {
    if (!file) return;
    const { rows, problems } = readBankFile(file.text, { invert: invertBox.checked });
    const isCsv = !/<OFX>|OFXHEADER/i.test(file.text);
    invert.hidden = !isCsv;
    drop.querySelector('[data-file-name]')!.textContent = file.name;
    result.replaceChildren();
    if (!rows.length) {
      bringIn.hidden = true;
      preview.replaceChildren(
        h(
          'div',
          { class: 'border-l-2 border-red-400 pl-4 text-sm text-red-300' },
          h('p', {}, "The books can't read any money lines in that file. Try downloading it again as Quicken (.qfx)."),
          ...(problems.length ? [h('ul', { class: 'mt-1 list-disc pl-5' }, ...problems.slice(0, 5).map((p) => h('li', {}, p)))] : []),
        ),
      );
      return;
    }
    const inSum = rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);
    const outSum = rows.filter((r) => r.amount < 0).reduce((s, r) => s - r.amount, 0);
    const dates = rows.map((r) => r.date).sort();
    bringIn.hidden = false;
    preview.replaceChildren(
      ...kids(
      h(
        'p',
        { class: 'text-bone-50' },
        `${rows.length} lines, ${shortDate(dates[0]!)} to ${shortDate(dates.at(-1)!)}. `,
        h('span', { class: 'text-gold-400' }, `${usd(inSum)} in`),
        ', ',
        `${usd(outSum)} out.`,
      ),
      isCsv ? h('p', { class: 'mt-1 text-sm text-bone-400' }, 'This is a .csv file. A .qfx file is safer, because each line has its own number from the bank and nothing can come in twice.') : null,
      problems.length
        ? h('div', { class: 'mt-2 text-sm text-bone-400' }, `${problems.length} ${problems.length === 1 ? 'line' : 'lines'} couldn't be read and will be left out:`,
            h('ul', { class: 'list-disc pl-5' }, ...problems.slice(0, 5).map((p) => h('li', {}, p))))
        : null,
      previewTable(rows),
      ),
    );
  }

  async function take(f: File) {
    if (f.size > 2_000_000) {
      status.say('That file is too big. Download a shorter date range, like one month.', 'bad');
      return;
    }
    file = { name: f.name, text: await f.text() };
    status.say('');
    showPreview();
  }

  picker.addEventListener('change', () => picker.files?.[0] && take(picker.files[0]));
  invertBox.addEventListener('change', showPreview);
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('border-gold-500');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('border-gold-500'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('border-gold-500');
    const f = e.dataTransfer?.files?.[0];
    if (f) void take(f);
  });

  bringIn.addEventListener('click', () =>
    status.run(bringIn, async () => {
      if (!file) throw new Error('Choose the file first.');
      const r = await api<ImportResult>('/books/bank-imports', {
        method: 'POST',
        body: { accountId: account.value, file: file.text, filename: file.name, invert: invertBox.checked },
      });
      bringIn.hidden = true;
      preview.replaceChildren();
      result.replaceChildren(resultWords(r, account.selectedOptions[0]?.textContent ?? 'the account', ctx));
      picker.value = '';
      file = null;
      drop.querySelector('[data-file-name]')!.textContent = 'Choose another bank file';
      await ctx.recount();
    }),
  );

  host.replaceChildren(
    subHead(
      'Bring in your bank file',
      'Once a week (or once a month), download your transactions from the bank\'s website and bring the file in here. If the bank asks what kind, pick Quicken (.qfx). The books skip anything they already have, so bringing in the same days twice is fine.',
    ),
    h(
      'div',
      { class: 'flex max-w-2xl flex-col gap-4' },
      labelled('Which account is this file for?', account, 'sm:max-w-sm'),
      drop,
      invert,
      preview,
      h('div', { class: 'flex flex-wrap items-center gap-4' }, bringIn, status.el),
      result,
    ),
  );
}

function previewTable(rows: BankRow[]) {
  const shown = [...rows].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
  return h(
    'div',
    { class: 'mt-4' },
    h(
      'ul',
      { class: 'border-t border-ink-800 text-sm' },
      ...shown.map((r) =>
        h(
          'li',
          { class: 'grid grid-cols-[4rem_1fr_auto] gap-3 border-b border-ink-800 py-2' },
          h('span', { class: 'text-bone-400' }, shortDate(r.date)),
          h('span', { class: 'min-w-0 truncate text-bone-200' }, r.description),
          h('span', { class: `tabular-nums ${r.amount > 0 ? 'text-gold-400' : 'text-bone-50'}` }, r.amount > 0 ? `+${usd(r.amount)}` : usd(r.amount)),
        ),
      ),
    ),
    rows.length > shown.length ? h('p', { class: 'mt-2 text-xs text-bone-500' }, `And ${rows.length - shown.length} more.`) : null,
  );
}

function resultWords(r: ImportResult, accountName: string, ctx: BooksCtx) {
  const parts: string[] = [];
  if (r.matched) parts.push(`${r.matched} already in the books`);
  if (r.filed) parts.push(`${r.filed} filed by your rules`);
  const headline = r.added === 0 ? 'Nothing new in that file. The books already had every line.' : `${r.added} new ${r.added === 1 ? 'line' : 'lines'} for ${accountName}.`;
  return h(
    'div',
    { class: 'border-l-2 border-gold-500 bg-ink-900 py-4 pl-5 pr-4' },
    h('p', { class: 'text-lg text-bone-50' }, headline),
    parts.length ? h('p', { class: 'mt-1 text-bone-200' }, `${parts.join(', ')}.`) : null,
    r.duplicates ? h('p', { class: 'mt-1 text-sm text-bone-400' }, `${r.duplicates} ${r.duplicates === 1 ? 'was' : 'were'} already brought in before, so ${r.duplicates === 1 ? 'it was' : 'they were'} skipped.`) : null,
    r.waiting
      ? h(
          'div',
          { class: 'mt-4 flex flex-wrap items-center gap-x-5 gap-y-2' },
          h('p', { class: 'text-bone-50' }, `${r.waiting} ${r.waiting === 1 ? 'needs' : 'need'} you${r.suggested ? `. The books have a guess for ${r.suggested}` : ''}.`),
          button('Sort them now', goldSmall, () => ctx.go('todo')),
        )
      : h('p', { class: 'mt-3 text-bone-200' }, 'Nothing needs you. All done.'),
    r.problems.length ? h('p', { class: 'mt-2 text-sm text-bone-400' }, `${r.problems.length} lines couldn't be read and were left out.`) : null,
    h('p', { class: 'mt-3' }, button('See the entries', textBtn, () => ctx.go('entries'))),
  );
}
