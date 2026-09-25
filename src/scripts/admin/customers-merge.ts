/**
 * Cleaning up people who are in the list twice (a Housecall Pro import plus a
 * new booking from another number, say). The API keeps the older record and
 * moves everything onto it (POST /v1/crm/customers/:id/merge). Nothing merges
 * without a second, in-page "yes".
 */
import { h, api, small, sectionHead, dollars, clearError, showError } from './core';
import { backLink, goldSmall, textButton } from './calendar-shared';
import { customerPicker, dayText, localDay } from './customers-shared';

interface Who {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  createdAt: string;
  visits: number;
  spend?: number;
}

const older = (a: Who, b: Who) => (a.createdAt < b.createdAt || (a.createdAt === b.createdAt && a.id < b.id) ? a : b);

const WHAT_HAPPENS =
  'The older record stays. Jobs, invoices, notes and quote requests from the other one move onto it, and any blank phone, email or address is filled in. This can’t be undone.';

/** One person's card-free summary: a few ruled lines. */
function whoLines(w: Who, label: string) {
  return h(
    'div',
    { class: 'min-w-0 border-t border-ink-800 pt-3' },
    h('p', { class: `${small} ${label === 'Stays' ? 'text-gold-400' : ''}` }, label),
    h('p', { class: 'mt-1 font-semibold text-bone-50' }, w.name),
    h('p', { class: 'text-sm tabular-nums text-bone-200' }, w.phone ?? 'No phone'),
    h('p', { class: 'truncate text-sm text-bone-200' }, w.email ?? 'No email'),
    h('p', { class: 'text-sm text-bone-400' }, `${w.visits} ${w.visits === 1 ? 'visit' : 'visits'}${w.spend ? `, ${dollars(w.spend)}` : ''} · added ${dayText(localDay(w.createdAt))}`),
  );
}

/** The confirm step for two records. `merged` gets the id that stayed. */
function confirmMerge(a: Who, b: Who, merged: (keptId: string) => void, cancel: () => void) {
  const keep = older(a, b);
  const drop = keep === a ? b : a;
  const status = h('span', { class: 'text-sm text-bone-400', role: 'status' });
  const yes = h('button', { type: 'button', class: goldSmall }, 'Yes, merge them') as HTMLButtonElement;
  yes.addEventListener('click', async () => {
    clearError();
    yes.disabled = true;
    status.textContent = 'Merging…';
    try {
      const r = await api<{ kept: string }>(`/crm/customers/${keep.id}/merge`, { method: 'POST', body: { otherId: drop.id } });
      merged(r.kept);
    } catch (err) {
      status.textContent = '';
      yes.disabled = false;
      showError(err);
    }
  });
  return h(
    'div',
    { class: 'mt-3' },
    h('div', { class: 'grid gap-4 sm:grid-cols-2' }, whoLines(keep, 'Stays'), whoLines(drop, 'Merged in')),
    h('p', { class: 'mt-4 max-w-xl text-sm text-bone-200' }, WHAT_HAPPENS),
    h('div', { class: 'mt-3 flex flex-wrap items-center gap-4' }, yes, h('button', { type: 'button', class: textButton, onclick: cancel }, 'Cancel'), status),
  );
}

/** On a profile: "Same person twice?" with a search for the other record. */
export function mergeBlock(me: Who, merged: (keptId: string) => void) {
  const holder = h('div', {});
  const start = () =>
    holder.replaceChildren(
      h('p', { class: 'text-sm text-bone-400' }, 'If this person is in your list twice, merge the two into one.'),
      h('button', { type: 'button', class: `${textButton} mt-2`, onclick: pick }, 'Find their other record'),
    );
  const pick = () => {
    const picker = customerPicker(me.id, (p) => holder.replaceChildren(confirmMerge(me, p, merged, start)), 'Their other name, phone or email');
    holder.replaceChildren(picker.el, h('button', { type: 'button', class: `${textButton} mt-2`, onclick: start }, 'Cancel'));
    picker.focus();
  };
  start();
  return holder;
}

const REASON: Record<string, string> = { phone: 'same phone', email: 'same email', name: 'same name' };

/** Everyone who might be in the list twice, from GET /crm/customers/duplicates. */
export async function drawDuplicates(view: HTMLElement, go: { back: () => void; open: (id: string) => void }) {
  const { groups } = await api<{ groups: { reasons: string[]; customers: Who[] }[] }>('/crm/customers/duplicates');
  // Phone or email matches first: those are almost always the same person.
  groups.sort((a, b) => Number(a.reasons.length === 1 && a.reasons[0] === 'name') - Number(b.reasons.length === 1 && b.reasons[0] === 'name'));
  const redraw = () => void drawDuplicates(view, go).catch(showError);

  const group = (g: { reasons: string[]; customers: Who[] }) => {
    const li = h('li', { class: 'border-b border-ink-800 py-5' });
    const [first, ...rest] = [...g.customers].sort((a, b) => (older(a, b) === a ? -1 : 1));
    const draw = () =>
      li.replaceChildren(
        h('p', { class: `${small} text-gold-400` }, `Look alike: ${g.reasons.map((r) => REASON[r] ?? r).join(', ')}`),
        h(
          'ul',
          { class: 'mt-2 flex flex-col gap-1' },
          ...g.customers.map((c) =>
            h(
              'li',
              { class: 'flex flex-wrap items-baseline gap-x-4 gap-y-0.5' },
              h('button', { type: 'button', class: 'text-bone-50 underline decoration-ink-600 underline-offset-4 hover:decoration-gold-500', onclick: () => go.open(c.id) }, c.name),
              h('span', { class: 'text-sm tabular-nums text-bone-400' }, [c.phone, c.email, `${c.visits} ${c.visits === 1 ? 'visit' : 'visits'}`].filter(Boolean).join(' · ')),
            ),
          ),
        ),
        h(
          'div',
          { class: 'mt-3 flex flex-wrap gap-x-5 gap-y-2' },
          ...rest.map((r) =>
            h('button', { type: 'button', class: textButton, onclick: () => li.replaceChildren(confirmMerge(first!, r, redraw, draw)) }, rest.length > 1 ? `Merge ${r.name} (${r.phone ?? r.email ?? 'no phone'}) in` : 'Merge these two'),
          ),
        ),
      );
    draw();
    return li;
  };

  view.replaceChildren(
    backLink('All customers', go.back),
    sectionHead('Possible duplicates', 'People who share a phone number, email or name. Same phone or email is almost always one person. Same name might be two different people: open them to check first.'),
    groups.length ? h('ul', { class: 'border-t border-ink-800' }, ...groups.map(group)) : h('p', { class: 'text-bone-400' }, 'No duplicates found. Your list is clean.'),
  );
}
