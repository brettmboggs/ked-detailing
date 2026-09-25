/**
 * On a job: add-ons Jacob finds at the car. He picks one from his price list
 * (priced for this vehicle) or types his own, adds what he found and a photo,
 * and texts the customer a link where they tap yes or no. A yes goes on the
 * job's price and invoice by itself (api/src/extras.ts). If they tell him in
 * person, he marks it here instead.
 */
import { API, Failed, h, api, token, dollars, input, ghost, small } from './core';
import { action, block, goldSmall, labelled, textArea, textButton } from './calendar-shared';
import { shrink } from './website-photos';

interface Extra {
  id: string;
  label: string;
  amount: number;
  note: string | null;
  photoId: string | null;
  status: 'offered' | 'approved' | 'declined' | 'withdrawn';
  decidedBy: 'customer' | 'owner' | null;
  sentAt: string | null;
}

export interface Listing {
  extras: Extra[];
  suggestions: { id: string; label: string; amount: number }[];
  url: string | null;
}

const WORDS: Record<Extra['status'], string> = {
  offered: 'Waiting on them',
  approved: 'Yes, added',
  declined: 'They said no',
  withdrawn: 'You took it back',
};

/**
 * The block. `first` is the list the job screen already fetched (null if it
 * failed); later changes reload just this block, and a yes redraws the whole
 * job through `changed`, since its price moved.
 */
export function extrasBlock(jobId: string, canOffer: boolean, first: Listing | null, changed: () => Promise<void>) {
  const wrap = h('div', {});
  const show = (l: Listing) => draw(wrap, jobId, canOffer, l, load, changed);
  const load = async () => {
    try {
      show(await api<Listing>(`/jobs/${jobId}/extras`));
    } catch (err) {
      wrap.replaceChildren(h('p', { class: 'text-sm text-bone-500' }, (err as Error).message));
    }
  };
  if (first) show(first);
  else void load();
  return block('Add-ons found at the car', wrap);
}

function draw(wrap: HTMLElement, jobId: string, canOffer: boolean, l: Listing, reload: () => Promise<void>, changed: () => Promise<void>) {
  const shown = l.extras.filter((e) => e.status !== 'withdrawn');
  const waiting = shown.filter((e) => e.status === 'offered');

  const set = (e: Extra, status: Extra['status'], after: () => Promise<void>) =>
    action(
      status === 'approved' ? 'They said yes' : status === 'declined' ? 'They said no' : 'Take it back',
      async () => {
        await api(`/extras/${e.id}`, { method: 'PATCH', body: { status } });
        await after();
      },
      status === 'withdrawn' ? textButton : ghost,
    ).btn;

  const rows = shown.length
    ? h(
        'ul',
        { class: 'mb-5 max-w-xl border-t border-ink-800' },
        ...shown.map((e) =>
          h(
            'li',
            { class: 'border-b border-ink-800 py-3' },
            h(
              'div',
              { class: 'flex items-baseline justify-between gap-4' },
              h('p', { class: 'text-bone-50' }, e.label),
              h('p', { class: 'tabular-nums text-bone-50' }, dollars(e.amount)),
            ),
            h(
              'p',
              { class: `mt-0.5 text-xs uppercase tracking-[0.14em] ${e.status === 'approved' ? 'text-gold-400' : 'text-bone-500'}` },
              WORDS[e.status],
              e.status === 'offered' && !e.sentAt ? ' · not sent yet' : '',
              e.decidedBy === 'owner' && e.status !== 'offered' ? ' · you marked it' : '',
              e.photoId ? ' · photo' : '',
            ),
            e.note ? h('p', { class: 'mt-1 text-sm text-bone-400' }, e.note) : null,
            e.status === 'offered' && canOffer
              ? h(
                  'div',
                  { class: 'mt-2 flex flex-wrap items-center gap-3' },
                  set(e, 'approved', changed),
                  set(e, 'declined', reload),
                  set(e, 'withdrawn', reload),
                )
              : null,
          ),
        ),
      )
    : null;

  /* ---------------------------------------------------------- send */

  const text = h('p', { class: 'mt-3 select-all whitespace-pre-wrap border-l-2 border-ink-700 pl-4 text-sm text-bone-200', hidden: true });
  const send = action(
    waiting.some((e) => e.sentAt) ? 'Copy the text again' : 'Copy the text for them',
    async () => {
      const { message, emailed } = await api<{ message: string; emailed: boolean }>(`/jobs/${jobId}/extras/send`, { method: 'POST' });
      const also = emailed ? ' It was emailed to them too.' : '';
      try {
        await navigator.clipboard.writeText(message);
        void reload();
        return `Copied. Paste it in a text to them.${also}`;
      } catch {
        text.textContent = message;
        text.hidden = false;
        return `Copy the text below.${also}`;
      }
    },
    goldSmall,
  );
  const sendRow = waiting.length && canOffer ? h('div', { class: 'mb-6' }, send.row, text) : null;

  /* ---------------------------------------------------------- offer */

  const OTHER = '__other';
  const pick = h(
    'select',
    { class: input },
    ...l.suggestions.map((s) => h('option', { value: s.id }, `${s.label} · ${dollars(s.amount)}`)),
    h('option', { value: OTHER }, 'Something else'),
  ) as HTMLSelectElement;
  const label = h('input', { type: 'text', class: input, maxlength: 120, placeholder: 'Pet hair removal' }) as HTMLInputElement;
  const price = h('input', { type: 'number', class: input, step: '0.01', min: '0', inputmode: 'decimal' }) as HTMLInputElement;
  const note = h('textarea', { class: textArea, maxlength: 500, rows: 3, placeholder: 'Your headlights are yellowed and hazy. This makes them clear again.' }) as HTMLTextAreaElement;
  const photo = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'text-sm text-bone-300 file:mr-3 file:border file:border-ink-700 file:bg-transparent file:px-3 file:py-1.5 file:text-bone-200' }) as HTMLInputElement;
  const labelRow = labelled('What is it', label);

  const sync = () => {
    const s = l.suggestions.find((x) => x.id === pick.value);
    labelRow.hidden = Boolean(s);
    price.value = s ? String(s.amount / 100) : '';
  };
  pick.addEventListener('change', sync);
  sync();

  const add = action(
    'Add it',
    async () => {
      const s = l.suggestions.find((x) => x.id === pick.value);
      const cents = Math.round(Number(price.value) * 100);
      if (!(cents > 0)) throw new Failed('Put a price on it.');
      if (!s && !label.value.trim()) throw new Failed('Say what it is.');
      let photoId: string | null = null;
      const file = photo.files?.[0];
      if (file) {
        const res = await fetch(`${API}/v1/photos?kind=job&jobId=${encodeURIComponent(jobId)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: await shrink(file),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Failed(body?.error?.message ?? `The photo didn't upload (${res.status}).`);
        photoId = body.id;
      }
      await api(`/jobs/${jobId}/extras`, {
        method: 'POST',
        body: {
          ...(s ? { addOnId: s.id } : { label: label.value.trim() }),
          amount: cents,
          note: note.value.trim() || null,
          photoId,
        },
      });
      await reload();
    },
    ghost,
  );

  const form = canOffer
    ? h(
        'div',
        { class: 'flex max-w-xl flex-col gap-3' },
        h('p', { class: small }, shown.length ? 'Offer another' : 'Offer one'),
        labelled('From your prices', pick),
        labelRow,
        labelled('Price ($)', price, 'w-40'),
        labelled('What you found (they see this)', note),
        labelled('Photo (optional, they see it)', photo),
        add.row,
      )
    : null;

  wrap.replaceChildren(
    ...(shown.length || !canOffer
      ? []
      : [h('p', { class: 'mb-4 max-w-xl text-sm text-bone-400' }, 'Spot cloudy headlights or pet hair? Offer the fix here with a photo. They tap yes or no on their phone, and a yes goes on the invoice by itself.')]),
    ...(rows ? [rows] : []),
    ...(sendRow ? [sendRow] : []),
    ...(form ? [form] : []),
    ...(!canOffer && !shown.length ? [h('p', { class: 'text-sm text-bone-500' }, 'None offered.')] : []),
  );
}
