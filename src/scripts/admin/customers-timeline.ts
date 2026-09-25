/**
 * A customer's timeline: everything that happened with them, newest first
 * (notes, calls, texts, emails the system sent, jobs, invoices, payments and
 * quote requests, merged by the API). Jacob adds notes and logs calls and
 * texts here, and can fix or delete his own.
 */
import { h, api, small, dollars, when, clearError, showError } from './core';
import { goldSmall, textArea, textButton } from './calendar-shared';
import { type TimelineItem, localDay, shortDate, tabBar } from './customers-shared';

type Kind = 'note' | 'call' | 'text';

const PAGE = 25;

/** Small capitals over each entry, and its left rule's colour. */
const LOOK: Record<string, [string, string]> = {
  note: ['Note', 'border-bone-400'],
  call: ['Call', 'border-bone-400'],
  text: ['Text', 'border-bone-400'],
  email: ['Email', 'border-ink-600'],
  review_request: ['Review', 'border-ink-600'],
  referral: ['Referral', 'border-gold-600'],
  system: ['Update', 'border-ink-600'],
  job: ['Job', 'border-gold-500'],
  invoice: ['Invoice', 'border-ink-600'],
  payment: ['Money in', 'border-spec-400'],
  quote: ['Quote', 'border-gold-600'],
};

const JOB_WORD: Record<string, string> = { scheduled: 'Booked', in_progress: 'Started', done: 'Done', cancelled: 'Cancelled' };
const QUOTE_WORD: Record<string, string> = { new: 'New', contacted: 'Contacted', booked: 'Booked', lost: 'Lost' };
const INVOICE_WORD: Record<string, string> = { draft: 'Not sent', sent: 'Not paid', paid: 'Paid', void: 'Void' };

export function timelineBlock(
  customerId: string,
  items: TimelineItem[],
  go: { job: (id: string) => void; invoice: (id: string) => void },
) {
  let list = [...items];
  let shown = PAGE;
  let kind: Kind = 'note';
  let direction: 'out' | 'in' = 'out';

  /* ---------------------------------------------------------- composer */

  const switcher = h('div', {});
  const body = h('textarea', { class: textArea, rows: 3, maxlength: 5000 }) as HTMLTextAreaElement;
  const dirRow = h('div', { class: 'flex flex-wrap gap-x-6 gap-y-2 text-sm text-bone-200', role: 'radiogroup' });
  const status = h('span', { class: 'text-sm text-bone-400', role: 'status' });
  const save = h('button', { type: 'button', class: goldSmall }, 'Save') as HTMLButtonElement;

  const drawComposer = () => {
    switcher.replaceChildren(
      tabBar<Kind>([['note', 'Add a note'], ['call', 'Log a call'], ['text', 'Log a text']], kind, (k) => ((kind = k), drawComposer()), 'What to add'),
    );
    body.placeholder = {
      note: 'Anything worth remembering: gate code, pets, how they like their car',
      call: 'What you talked about (optional)',
      text: 'What you texted about (optional)',
    }[kind];
    body.setAttribute('aria-label', { note: 'Note', call: 'About the call', text: 'About the text' }[kind]);
    dirRow.hidden = kind === 'note';
    const verb = kind === 'call' ? ['I called them', 'They called me'] : ['I texted them', 'They texted me'];
    dirRow.replaceChildren(
      ...(['out', 'in'] as const).map((d, i) => {
        const r = h('input', { type: 'radio', name: `dir-${customerId}`, class: 'size-4 accent-[#e8b14c]', value: d }) as HTMLInputElement;
        r.checked = direction === d;
        r.addEventListener('change', () => (direction = d));
        return h('label', { class: 'flex items-center gap-2' }, r, verb[i]!);
      }),
    );
  };
  drawComposer();

  save.addEventListener('click', async () => {
    clearError();
    if (kind === 'note' && !body.value.trim()) {
      status.textContent = 'Write something first.';
      body.focus();
      return;
    }
    save.disabled = true;
    status.textContent = 'Saving…';
    try {
      const item = await api<TimelineItem>(`/crm/customers/${customerId}/activities`, {
        method: 'POST',
        body: { kind, body: body.value.trim() || null, ...(kind === 'note' ? {} : { direction }) },
      });
      list = [item, ...list];
      body.value = '';
      status.textContent = { note: 'Note saved.', call: 'Call logged.', text: 'Text logged.' }[kind];
      drawList();
    } catch (err) {
      status.textContent = '';
      showError(err);
    } finally {
      save.disabled = false;
    }
  });

  /* ---------------------------------------------------------- list */

  const ul = h('ul', { class: 'mt-6 flex flex-col' });
  const more = h('div', { class: 'mt-4' });

  const drawList = () => {
    ul.replaceChildren(...(list.length ? list.slice(0, shown).map(entry) : [h('li', { class: 'text-sm text-bone-500' }, 'Nothing yet.')]));
    more.replaceChildren(
      list.length > shown
        ? h('button', { type: 'button', class: textButton, onclick: () => ((shown += PAGE), drawList()) }, `Show older (${list.length - shown} more)`)
        : '',
    );
  };

  function entry(t: TimelineItem): HTMLElement {
    const [word, edge] = LOOK[t.type] ?? ['Update', 'border-ink-600'];
    const li = h('li', { class: `border-l-2 ${edge} mb-4 pl-4` });
    const dateText = t.type === 'payment' && t.date ? shortDate(t.date) : `${shortDate(localDay(t.at))}${t.type === 'payment' ? '' : `, ${when(t.at, { hour: 'numeric', minute: '2-digit' })}`}`;
    const state =
      t.type === 'job' && t.status ? JOB_WORD[t.status] : t.type === 'quote' && t.status ? QUOTE_WORD[t.status] : t.type === 'invoice' && t.status ? INVOICE_WORD[t.status] : null;
    const range = t.type === 'quote' ? (t.meta?.range as [number, number] | null | undefined) : null;
    const amount = typeof t.amount === 'number' ? dollars(t.amount) : range ? `${dollars(range[0])} to ${dollars(range[1])}` : null;

    const titleText = h('span', { class: 'text-bone-50' }, t.title);
    const opens = t.type === 'job' && t.jobId ? () => go.job(t.jobId!) : t.type === 'invoice' && t.invoiceId ? () => go.invoice(t.invoiceId!) : null;
    const title = opens
      ? h('button', { type: 'button', class: 'text-left text-bone-50 underline decoration-ink-600 underline-offset-4 hover:decoration-gold-500', onclick: opens }, t.title)
      : titleText;

    const draw = () =>
      li.replaceChildren(
        h(
          'p',
          { class: 'flex flex-wrap items-baseline gap-x-3 gap-y-0.5' },
          h('span', { class: small }, word),
          h('span', { class: 'text-xs tabular-nums text-bone-500' }, dateText),
          state ? h('span', { class: 'text-xs uppercase tracking-[0.14em] text-bone-500' }, state) : null,
        ),
        h('p', { class: 'mt-1 flex items-baseline justify-between gap-4' }, title, amount ? h('span', { class: 'shrink-0 tabular-nums text-bone-200' }, amount) : null),
        t.body ? h('p', { class: 'mt-1 whitespace-pre-line break-words text-sm text-bone-200' }, t.body) : '',
        t.editable
          ? h(
              'p',
              { class: 'mt-2 flex gap-5' },
              h('button', { type: 'button', class: textButton, onclick: editing }, 'Edit'),
              h('button', { type: 'button', class: textButton, onclick: confirming }, 'Delete'),
              t.meta?.editedAt ? h('span', { class: 'text-xs text-bone-500' }, 'Edited') : null,
            )
          : '',
      );

    function editing() {
      const box = h('textarea', { class: textArea, rows: 3, maxlength: 5000, 'aria-label': 'Change the note' }) as HTMLTextAreaElement;
      box.value = t.body ?? '';
      const ok = h('button', { type: 'button', class: goldSmall }, 'Save') as HTMLButtonElement;
      ok.addEventListener('click', async () => {
        clearError();
        ok.disabled = true;
        try {
          const saved = await api<TimelineItem>(`/crm/customers/${customerId}/activities/${t.id}`, { method: 'PATCH', body: { body: box.value.trim() || null } });
          Object.assign(t, saved);
          draw();
        } catch (err) {
          showError(err);
          ok.disabled = false;
        }
      });
      li.replaceChildren(
        h('p', { class: small }, `Change this ${word.toLowerCase()}`),
        h('div', { class: 'mt-2' }, box),
        h('div', { class: 'mt-2 flex items-center gap-4' }, ok, h('button', { type: 'button', class: textButton, onclick: draw }, 'Cancel')),
      );
      box.focus();
    }

    function confirming() {
      const yes = h('button', { type: 'button', class: 'border border-red-400/60 px-3 py-1.5 text-sm text-red-300 hover:border-red-300 hover:text-red-200 disabled:opacity-40' }, 'Yes, delete it') as HTMLButtonElement;
      yes.addEventListener('click', async () => {
        clearError();
        yes.disabled = true;
        try {
          await api(`/crm/customers/${customerId}/activities/${t.id}`, { method: 'DELETE' });
          list = list.filter((x) => x.id !== t.id);
          drawList();
        } catch (err) {
          showError(err);
          yes.disabled = false;
        }
      });
      li.replaceChildren(
        h('p', { class: 'text-sm text-bone-200' }, `Delete this ${word.toLowerCase()}? You can't get it back.`),
        t.body ? h('p', { class: 'mt-1 line-clamp-2 text-sm italic text-bone-400' }, t.body) : '',
        h('div', { class: 'mt-2 flex items-center gap-4' }, yes, h('button', { type: 'button', class: textButton, onclick: draw }, 'Keep it')),
      );
    }

    draw();
    return li;
  }

  drawList();
  return h(
    'div',
    {},
    switcher,
    h('div', { class: 'mt-3 flex flex-col gap-3' }, body, dirRow, h('div', { class: 'flex flex-wrap items-center gap-3' }, save, status)),
    ul,
    more,
  );
}
