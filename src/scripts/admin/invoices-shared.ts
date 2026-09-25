/**
 * Pieces the Invoices tab's files share: the invoice shape (docs/mobile-app.md,
 * "Invoice shape"), money in and out of text boxes, and small button helpers.
 */
import { type Child, h, showError, clearError, TZ } from './core';

export interface InvoiceLine {
  label: string;
  amount: number;
}

export interface Invoice {
  id: string;
  number: number;
  jobId: string;
  customer: { id: string; name: string; phone: string | null; email: string | null };
  status: 'draft' | 'sent' | 'paid' | 'void';
  lines: InvoiceLine[];
  total: number;
  paid: number;
  balance: number;
  paidOn: string | null;
  dueDate: string | null;
  notes: string | null;
  payUrl: string;
  sentAt: string | null;
  viewedAt: string | null;
  voidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A books entry, as GET /books/entries returns it. */
export interface Entry {
  id: string;
  date: string;
  kind: string;
  memo: string | null;
  jobId: string | null;
  method: string | null;
  voidedBy: string | null;
  lines: { accountId: string; amount: number }[];
}

export interface Account {
  id: string;
  name: string;
  type: string;
  moneyAccount: boolean;
  archived: boolean;
  hint?: string;
}

/** Always two decimals when there are cents: $150.50, never $150.5. */
export const money = (c: number) => {
  const abs = Math.abs(c);
  const s = `$${(abs / 100).toLocaleString('en-US', { minimumFractionDigits: abs % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
  return c < 0 ? `−${s}` : s;
};

/** "$1,234.50", "1234.5" or "20" → cents. Null when it isn't a number. */
export function parseMoney(text: string): number | null {
  const t = text.replace(/[$,\s]/g, '');
  if (t === '') return null;
  if (!/^\d*(\.\d{0,2})?$/.test(t) || t === '.') return null;
  return Math.round(Number(t) * 100);
}

/** Cents → what goes in a text box: 31625 → "316.25", 15000 → "150". */
export const moneyText = (c: number) => (c % 100 ? (c / 100).toFixed(2) : String(c / 100));

/** Today in Jacob's time zone, YYYY-MM-DD. */
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** "Sep 24" for a YYYY-MM-DD day (read as a plain date, not a moment). */
export const shortDay = (d: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(`${d}T12:00:00Z`));

/** "Sep 24" for an ISO moment, in Jacob's time zone. */
export const shortWhen = (iso: string) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric' }).format(new Date(iso));

export const unpaid = (inv: Invoice) => inv.status === 'draft' || inv.status === 'sent';
export const pastDue = (inv: Invoice) => unpaid(inv) && !!inv.dueDate && inv.dueDate < today();

/** The one-word state Jacob reads, and its colour. */
export function stateOf(inv: Invoice): { word: string; tone: string } {
  if (inv.status === 'void') return { word: 'Void', tone: 'text-bone-500' };
  if (inv.status === 'paid') return { word: 'Paid', tone: 'text-bone-200' };
  if (pastDue(inv)) return { word: 'Past due', tone: 'text-red-300' };
  if (inv.paid > 0) return { word: 'Part paid', tone: 'text-gold-400' };
  if (inv.status === 'sent') return { word: 'Sent, not paid', tone: 'text-gold-400' };
  return { word: 'Not sent yet', tone: 'text-gold-400' };
}

export const label = 'text-xs uppercase tracking-[0.14em] text-bone-500';
export const gold = 'btn-gold';
export const plain =
  'border border-ink-700 px-4 py-2 text-sm text-bone-200 transition-colors hover:border-gold-500 hover:text-bone-50 disabled:opacity-40';
export const danger = 'border border-red-400/60 px-4 py-2 text-sm text-red-300 transition-colors hover:border-red-300 hover:text-red-200 disabled:opacity-40';
export const textLink = 'text-sm text-gold-400 underline decoration-gold-600 underline-offset-4 hover:text-gold-500';

/** A button that disables itself while its work runs, and shows any error. */
export function action(text: string, cls: string, run: (btn: HTMLButtonElement) => Promise<void> | void, attrs: Record<string, unknown> = {}) {
  const btn = h('button', { type: 'button', class: cls, ...attrs }, text) as HTMLButtonElement;
  btn.addEventListener('click', async () => {
    clearError();
    btn.disabled = true;
    try {
      await run(btn);
    } catch (err) {
      showError(err);
    } finally {
      if (btn.isConnected) btn.disabled = false;
    }
  });
  return btn;
}

/** Copy text; if the browser won't allow it, select it so a long-press copies. */
export async function copy(text: string, fallback?: HTMLElement) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (fallback) {
      const range = document.createRange();
      range.selectNodeContents(fallback);
      const sel = getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    return false;
  }
}

/** Phones get a "Open in Messages" link; a desktop can't send a text. */
export const isPhone = () => matchMedia('(pointer: coarse)').matches || /iPhone|iPad|Android/i.test(navigator.userAgent);

/** sms: link with a body. `?&body=` works on both iPhone and Android. */
export const smsHref = (phone: string, body: string) => `sms:${phone.replace(/[^\d+]/g, '')}?&body=${encodeURIComponent(body)}`;

/** A ruled label/value row. */
export const row = (name: string, ...value: Child[]) =>
  h('div', { class: 'flex items-baseline justify-between gap-6 border-b border-ink-800 py-3' }, h('dt', { class: 'shrink-0 text-sm text-bone-400' }, name), h('dd', { class: 'min-w-0 text-right text-bone-50' }, ...value));

/** Scroll the page (Lenis-aware, see motion.ts) so `el` is in view. */
export function bringIntoView(el: HTMLElement) {
  if (el.getBoundingClientRect().top >= 0) return;
  const ev = new CustomEvent('ked:scroll-to', { detail: el, cancelable: true });
  document.dispatchEvent(ev);
  if (!ev.defaultPrevented) el.scrollIntoView({ block: 'start' });
}

/** 3145551212 → (314) 555-1212; anything else as saved. */
export function phoneText(p: string) {
  const d = p.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p;
}
