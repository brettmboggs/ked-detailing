/**
 * Shared pieces for the Books tab (books.ts and the books-*.ts views): types
 * for what the books API returns, plain-word labels, money and date helpers,
 * inline status lines, and the raw fetches (photos, CSV downloads) that don't
 * go through core's JSON `api()`.
 */
import type { Account, BooksSettings } from '@ked/books';
import { API, Failed, type Child, TZ, h, api, token, remember, showSignIn, input, small } from './core';

/* -------------------------------------------------------------- types */

export type BooksAccount = Account & { archived: boolean };

export interface Line {
  accountId: string;
  amount: number;
}

export interface Entry {
  id: string;
  date: string;
  kind: 'expense' | 'income' | 'transfer' | 'reversal';
  memo: string | null;
  payee: { id: string; name: string | null } | null;
  jobId: string | null;
  method: string | null;
  receiptKey: string | null;
  reverses: string | null;
  voidedBy: string | null;
  lines: Line[];
  createdAt: string;
}

export interface Suggestion {
  action: 'categorize' | 'transfer' | 'personal' | 'job';
  categoryId?: string;
  otherAccountId?: string;
  jobId?: string;
  source: 'starter' | 'job';
  label: string;
}

export interface BankLine {
  id: string;
  accountId: string;
  date: string;
  description: string;
  merchant: string | null;
  amount: number;
  status: 'unmatched' | 'matched' | 'ignored';
  entryId: string | null;
  suggestion: Suggestion | null;
  auto: boolean;
}

export interface Inbox {
  bankLines: { waiting: number; withSuggestion: number };
  autoFiled: { id: string; date: string; description: string; amount: number; entryId: string }[];
  receiptsMissing: { entryId: string; date: string; memo: string | null; payee: string | null; amount: number }[];
  tripsToLog: { jobId: string; date: string; address: string; customer: string }[];
  unpaidJobs: { jobId: string; date: string; customer: string; amount: number | null }[];
  total: number;
}

export interface Rule {
  id: string;
  merchant: string;
  direction: 'in' | 'out';
  action: 'categorize' | 'transfer' | 'personal';
  categoryName: string | null;
  otherAccountName: string | null;
  payee: { id: string; name: string | null } | null;
  hits: number;
}

export interface Payee {
  id: string;
  name: string;
  kind: 'vendor' | 'contractor';
  taxFormOnFile: boolean;
}

export interface Trip {
  id: string;
  date: string;
  miles: number;
  purpose: string;
  from: string | null;
  to: string | null;
  jobId: string | null;
}

/* ---------------------------------------------------- shared lookups */

/** The chart, loaded once per render of the tab and shared by every view. */
export interface Books {
  accounts: BooksAccount[];
  byId: Map<string, BooksAccount>;
  settings: BooksSettings;
}

export async function loadBooks(): Promise<Books> {
  const [{ accounts }, { settings }] = await Promise.all([
    api<{ accounts: BooksAccount[] }>('/books/accounts?archived=true'),
    api<{ settings: BooksSettings }>('/settings/books'),
  ]);
  return { accounts, byId: new Map(accounts.map((a) => [a.id, a])), settings };
}

export const moneyAccounts = (b: Books) => b.accounts.filter((a) => a.moneyAccount && !a.archived);
export const categories = (b: Books, type: 'income' | 'expense') => b.accounts.filter((a) => a.type === type && !a.archived);
export const accountName = (b: Books, id: string) => b.byId.get(id)?.name ?? id;

/* -------------------------------------------------------------- money */

/** "$1,234.50" from cents. Always two decimals in the books. */
export const usd = (c: number) =>
  `${c < 0 ? '−' : ''}$${(Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Money in gets a plus; money out a minus. */
export const signed = (c: number) => (c > 0 ? `+${usd(c)}` : usd(c));

/** "$1,234.56", "1234.5", "12" → cents; null when it isn't a number above zero. */
export function parseCents(raw: string): number | null {
  const s = raw.replace(/[$,\s]/g, '');
  if (!/^\d*\.?\d{0,2}$/.test(s) || s === '' || s === '.') return null;
  const c = Math.round(Number(s) * 100);
  return c > 0 ? c : null;
}

/* -------------------------------------------------------------- dates */

/** Today in Jacob's time zone, as YYYY-MM-DD. */
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());

export const shiftDay = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

/** "Sep 21" (and the year when it isn't this one). */
export function shortDate(d: string) {
  const sameYear = d.slice(0, 4) === today().slice(0, 4);
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) }).format(
    new Date(`${d}T12:00:00Z`),
  );
}

/* ------------------------------------------------------------ styling */

export const goldSmall =
  'rounded-sm bg-gold-500 px-3 py-2 text-sm font-semibold text-ink-950 transition-colors hover:bg-gold-400 disabled:opacity-40';
export const textBtn = 'py-1 text-left text-sm text-bone-200 underline decoration-ink-600 underline-offset-4 hover:text-bone-50 hover:decoration-gold-500 disabled:opacity-40';
export const sub = 'mb-3 mt-10 font-display text-sm uppercase tracking-[0.14em] text-gold-400';
export const rowRule = 'border-b border-ink-800';

/** A small heading inside a view, with an optional plain-words note. */
export const subHead = (title: string, note?: Child) =>
  h('div', {}, h('h3', { class: sub }, title), note ? h('p', { class: '-mt-1 mb-3 max-w-2xl text-sm text-bone-400' }, note) : null);

/** A label over any control. */
export const labelled = (label: string, control: HTMLElement, extra = '') =>
  h('label', { class: `flex min-w-0 flex-col gap-1 ${extra}` }, h('span', { class: small }, label), control);

export function textInput(opts: { value?: string; placeholder?: string; type?: string; list?: string; inputmode?: string } = {}) {
  const el = h('input', {
    class: input,
    type: opts.type ?? 'text',
    placeholder: opts.placeholder,
    list: opts.list,
    inputmode: opts.inputmode,
    autocomplete: 'off',
  }) as HTMLInputElement;
  if (opts.value !== undefined) el.value = opts.value;
  return el;
}

export const moneyInput = (cents?: number | null) =>
  textInput({ value: cents ? (cents / 100).toFixed(2) : '', placeholder: '0.00', inputmode: 'decimal' });

export const dateInput = (value = today()) => textInput({ type: 'date', value });

/** A select from [value, label] pairs, grouped when given groups. */
export function select(options: ([string, string] | { group: string; options: [string, string][] })[], value?: string) {
  const el = h(
    'select',
    { class: input },
    ...options.map((o) =>
      Array.isArray(o)
        ? h('option', { value: o[0] }, o[1])
        : h('optgroup', { label: o.group }, ...o.options.map(([v, l]) => h('option', { value: v }, l))),
    ),
  ) as HTMLSelectElement;
  if (value !== undefined) el.value = value;
  return el;
}

/** Categories with their hint, e.g. "Supplies (chemicals, towels, pads, brushes)". */
export const categoryOptions = (b: Books, type: 'income' | 'expense'): [string, string][] =>
  categories(b, type).map((a) => [a.id, a.hint ? `${a.name} (${a.hint.charAt(0).toLowerCase()}${a.hint.slice(1)})` : a.name]);

export const moneyOptions = (b: Books): [string, string][] => moneyAccounts(b).map((a) => [a.id, a.name]);

/**
 * A status line under an action. `run` shows "Saving…", then the result, or
 * the error (with any details) right there instead of at the top of the page.
 */
export function statusLine() {
  const el = h('div', { class: 'text-sm', role: 'status' });
  const say = (msg: Child, tone: 'ok' | 'bad' | 'quiet' = 'ok') => {
    el.className = `text-sm ${tone === 'bad' ? 'border-l-2 border-red-400 pl-3 text-red-300' : tone === 'quiet' ? 'text-bone-400' : 'border-l-2 border-gold-500 pl-3 text-bone-200'}`;
    el.replaceChildren(...kids(msg));
    if (!msg) el.className = 'text-sm';
  };
  const fail = (err: unknown) => {
    if (err instanceof Failed && err.message === 'Signed out.') return;
    say(
      h(
        'span',
        {},
        (err as Error).message,
        ...(err instanceof Failed && err.details.length ? [h('ul', { class: 'mt-1 list-disc pl-5' }, ...err.details.map((d) => h('li', {}, d)))] : []),
      ),
      'bad',
    );
  };
  async function run(btn: HTMLButtonElement | null, work: () => Promise<Child | void>) {
    if (btn) btn.disabled = true;
    say('Working on it…', 'quiet');
    try {
      const msg = await work();
      if (msg) say(msg);
      else el.replaceChildren();
    } catch (err) {
      fail(err);
    } finally {
      if (btn) btn.disabled = false;
    }
  }
  return { el, say, fail, run };
}

export const button = (label: string, cls: string, onclick?: (btn: HTMLButtonElement) => void) => {
  const b = h('button', { type: 'button', class: cls }, label) as HTMLButtonElement;
  if (onclick) b.addEventListener('click', () => onclick(b));
  return b;
};

/**
 * An in-page "are you sure": swaps `host`'s contents for a question and two
 * buttons, and puts them back on "No". Never window.confirm.
 */
export function askFirst(host: HTMLElement, question: Child, yes: string, no: string, onYes: (btn: HTMLButtonElement) => void) {
  const before = [...host.childNodes];
  const restore = () => host.replaceChildren(...before);
  host.replaceChildren(
    h(
      'div',
      { class: 'flex flex-col gap-3 border-l-2 border-gold-500 bg-ink-900 py-3 pl-4 pr-3' },
      h('p', { class: 'text-sm text-bone-200' }, question),
      h('div', { class: 'flex flex-wrap items-center gap-4' }, button(yes, goldSmall, onYes), button(no, textBtn, restore)),
    ),
  );
  return restore;
}

/* ------------------------------------------------------- raw fetches */

async function rawFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${API}/v1${path}`, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (res.status === 401 && token) {
    remember(null);
    showSignIn('Your session ended. Sign in again.');
    throw new Failed('Signed out.');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    if (body?.error?.code === 'photos_off') throw new Failed("Photo storage isn't on yet. Save it without the photo for now.");
    throw new Failed(body?.error?.message ?? `Something went wrong (${res.status}).`, body?.error?.details ?? []);
  }
  return res;
}

/** Make a phone photo small (about 1600px, JPEG) before sending it. Falls back to the original. */
async function shrink(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.7));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file; // e.g. HEIC in a browser that can't draw it; the API takes HEIC as is.
  }
}

/** Upload a receipt photo; returns its photo id. */
export async function uploadReceipt(file: File): Promise<string> {
  const body = await shrink(file);
  const res = await rawFetch('/photos?kind=receipt', { method: 'POST', body, headers: { 'Content-Type': body.type || 'application/octet-stream' } });
  return ((await res.json()) as { id: string }).id;
}

/** A photo as a local URL an <img> can show (the API needs the Authorization header). */
export async function photoUrl(id: string) {
  const res = await rawFetch(`/photos/${encodeURIComponent(id)}`);
  return URL.createObjectURL(await res.blob());
}

/**
 * Fetch a CSV export and hand it to the browser as a download. The name is
 * given here because a cross-origin response hides Content-Disposition
 * unless the API exposes it.
 */
export async function download(path: string, fallbackName: string) {
  const res = await rawFetch(path);
  const name = res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = h('a', { href: url, download: name, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return name;
}

/** A file picker for a receipt photo: the camera on a phone, files on a computer. */
export function receiptPicker() {
  const el = h('input', { type: 'file', accept: 'image/*', class: 'sr-only' }) as HTMLInputElement;
  return el;
}

/** Everything the books need to know about one entry, in Jacob's words. */
export function describe(b: Books, e: Entry) {
  const acct = (id: string) => b.byId.get(id);
  const money = e.lines.filter((l) => acct(l.accountId)?.moneyAccount);
  const other = e.lines.filter((l) => !acct(l.accountId)?.moneyAccount);
  const plLine = e.lines.find((l) => ['income', 'expense'].includes(acct(l.accountId)?.type ?? ''));
  let category = plLine ? accountName(b, plLine.accountId) : '';
  let amount = 0;
  if (e.kind === 'transfer' || (e.kind === 'reversal' && !plLine)) {
    const from = e.lines.find((l) => l.amount < 0);
    const to = e.lines.find((l) => l.amount > 0);
    category = from && to ? `${accountName(b, from.accountId)} → ${accountName(b, to.accountId)}` : 'Moved money';
    amount = Math.abs(e.lines[0]?.amount ?? 0);
  } else {
    // Seen from the money account (a debit there is money in, card or bank): + came in, − went out.
    amount = money[0]?.amount ?? -(other[0]?.amount ?? 0);
  }
  const title = e.payee?.name ?? e.memo ?? { expense: 'Money out', income: 'Money in', transfer: 'Moved money', reversal: 'Void' }[e.kind];
  const from = money[0] ? accountName(b, money[0].accountId) : '';
  return { title, category, amount, from };
}

export const kindWord: Record<Entry['kind'], string> = {
  expense: 'Money out',
  income: 'Money in',
  transfer: 'Moved money',
  reversal: 'Void',
};

/* ------------------------------------------------------------ periods */

export interface Period {
  key: string;
  label: string;
  from: string;
  to: string;
}

/** The date ranges Jacob picks from, worked out from today in his time zone. */
export function periods(): Period[] {
  const t = today();
  const y = Number(t.slice(0, 4));
  const m = Number(t.slice(5, 7));
  const pad = (n: number) => String(n).padStart(2, '0');
  const monthEnd = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10);
  const [ly, lm] = m === 1 ? [y - 1, 12] : [y, m - 1];
  const monthName = (yy: number, mm: number) =>
    new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long' }).format(new Date(Date.UTC(yy, mm - 1, 15)));
  return [
    { key: '30d', label: 'Last 30 days', from: shiftDay(t, -30), to: t },
    { key: 'month', label: `This month (${monthName(y, m)})`, from: `${y}-${pad(m)}-01`, to: monthEnd(y, m) },
    { key: 'last-month', label: `Last month (${monthName(ly, lm)})`, from: `${ly}-${pad(lm)}-01`, to: monthEnd(ly, lm) },
    { key: 'year', label: `This year (${y})`, from: `${y}-01-01`, to: `${y}-12-31` },
    { key: 'last-year', label: `Last year (${y - 1})`, from: `${y - 1}-01-01`, to: `${y - 1}-12-31` },
  ];
}

/** Drop the empty children (null, false) that `h()` accepts but replaceChildren doesn't. */
export const kids = (...c: Child[]) => c.filter((x): x is Node | string => x !== null && x !== undefined && x !== false);
