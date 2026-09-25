/**
 * One job, opened from the calendar or a customer: everything about it, and
 * the things Jacob does to it (start, finish, cancel, move, price, add-ons
 * found at the car, notes, invoice, confirmation text). Photos are owner-only, so they're fetched with
 * the session and shown through object URLs.
 */
import { zonedToUtc } from '@ked/scheduling';
import { formatRange } from '@ked/pricing';
import { type Listing, extrasBlock } from './calendar-extras';
import { openInvoice } from './invoices';
import { API, TZ, Failed, h, api, showError, token, dollars, input, ghost, small, heading, headingStyle } from './core';
import {
  type CalJob,
  type InvoiceLite,
  STATUS,
  STATUS_TEXT,
  action,
  backLink,
  block,
  contactLinks,
  dayFmt,
  goTab,
  goldSmall,
  hhmm,
  hoursBetween,
  labelled,
  link,
  mapHref,
  pending,
  serviceName,
  span,
  textArea,
  textButton,
} from './calendar-shared';

interface Photo {
  id: string;
  stage: 'before' | 'after' | null;
  caption: string | null;
  url: string;
}

/** Object URLs from the last job shown, released when the next one draws. */
let objectUrls: string[] = [];

export async function renderJob(
  view: HTMLElement,
  id: string,
  opts: { back: (date?: string) => void; warnings?: string[] },
) {
  for (const u of objectUrls) URL.revokeObjectURL(u);
  objectUrls = [];

  const [job, { invoices }, extras] = await Promise.all([
    api<CalJob>(`/jobs/${id}`),
    api<{ invoices: InvoiceLite[] }>(`/invoices?jobId=${id}`).catch(() => ({ invoices: [] as InvoiceLite[] })),
    api<Listing>(`/jobs/${id}/extras`).catch(() => null),
  ]);
  const redraw = async (warnings: string[] = []) => renderJob(view, id, { ...opts, warnings });
  const j = job;
  const live = j.status !== 'cancelled';
  const imported = j.service === 'imported';

  /* ---------------------------------------------------------- top */

  const warn = opts.warnings?.length
    ? h(
        'div',
        { class: 'mb-6 border-l-2 border-gold-500 pl-4 text-sm text-bone-200', role: 'status' },
        h('p', { class: 'font-semibold text-bone-50' }, 'Booked. A heads-up:'),
        h('ul', { class: 'mt-1 list-disc pl-5' }, ...opts.warnings.map((w) => h('li', {}, w))),
      )
    : null;

  const setStatus = async (status: CalJob['status'], extra: Record<string, unknown> = {}) => {
    await api(`/jobs/${id}`, { method: 'PATCH', body: { status, ...extra } });
    await redraw();
  };

  const next =
    j.status === 'scheduled'
      ? action('Start the job', () => setStatus('in_progress'), goldSmall)
      : j.status === 'in_progress'
        ? action('Mark it done', () => setStatus('done'), goldSmall)
        : null;

  const confirm = action('Copy confirmation text', async () => {
    const { message } = await api<{ message: string }>(`/jobs/${id}/confirmation`, { method: 'POST' });
    try {
      await navigator.clipboard.writeText(message);
      return 'Copied. Paste it in a text to them.';
    } catch {
      // No clipboard (older phone, or no permission): show it to copy by hand.
      confirmText.textContent = message;
      confirmText.hidden = false;
      return 'Copy the text below.';
    }
  });
  const confirmText = h('p', { class: 'mt-3 max-w-xl select-all whitespace-pre-wrap border-l-2 border-ink-700 pl-4 text-sm text-bone-200', hidden: true });

  const top = h(
    'div',
    { class: 'mb-2' },
    h('p', { class: `${small} mb-2` }, `${dayFmt(j.date, { weekday: 'long', month: 'long', day: 'numeric' })} · ${span(j.start, j.end)}`),
    h('h2', { class: heading, style: headingStyle }, j.customer.name),
    h('p', { class: 'mt-1 text-bone-200' }, [serviceName(j), j.vehicle].filter(Boolean).join(' · ')),
    h(
      'p',
      { class: 'mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm' },
      h('span', { class: `font-display uppercase tracking-[0.16em] ${STATUS_TEXT[j.status]}` }, STATUS[j.status]),
      j.source === 'web' ? h('span', { class: 'text-bone-400' }, 'The customer booked this online.') : null,
      j.history ? h('span', { class: 'text-bone-400' }, 'Past job from Housecall Pro.') : null,
    ),
    j.status === 'cancelled'
      ? h(
          'p',
          { class: 'mt-3 max-w-xl border-l-2 border-ink-600 pl-4 text-sm text-bone-200' },
          j.cancelledBy === 'customer' ? 'The customer cancelled this through their link.' : 'You cancelled this job.',
          j.cancelReason ? (j.cancelledBy === 'customer' ? ` Their reason: "${j.cancelReason}"` : ` Why: ${j.cancelReason}`) : '',
        )
      : null,
    h(
      'div',
      { class: 'mt-5 flex flex-wrap items-center gap-3' },
      next?.btn ?? null,
      j.status === 'scheduled' && !j.history ? confirm.btn : null,
      next?.status ?? null,
      confirm.status,
    ),
    confirmText,
  );

  /* ---------------------------------------------------------- customer */

  const customer = block(
    'Customer',
    h(
      'div',
      { class: 'flex flex-col gap-1' },
      j.customer.phone ? h('p', { class: 'tabular-nums text-bone-50' }, j.customer.phone) : h('p', { class: 'text-bone-500' }, 'No phone number'),
      j.customer.email ? h('p', { class: 'text-bone-200' }, j.customer.email) : null,
      h('p', { class: 'text-bone-200' }, j.address),
    ),
    h('div', { class: 'mt-3' }, contactLinks(j.customer, j.address)),
    h(
      'button',
      {
        type: 'button',
        class: `${textButton} mt-4`,
        onclick: () => {
          pending.customer = j.customer.id;
          goTab('customers');
        },
      },
      `All of ${j.customer.name.split(' ')[0]}'s jobs and details`,
    ),
  );

  /* ---------------------------------------------------------- when */

  const date = h('input', { type: 'date', class: input, value: j.date }) as HTMLInputElement;
  const start = h('input', { type: 'time', class: input, value: hhmm(j.start), step: 900 }) as HTMLInputElement;
  const length = h('input', {
    type: 'number',
    class: input,
    value: String(Math.round(hoursBetween(j.start, j.end) * 100) / 100),
    step: '0.5',
    min: '0.5',
    inputmode: 'decimal',
  }) as HTMLInputElement;
  const move = action(
    'Move it',
    async () => {
      if (!date.value || !start.value) throw new Error('Pick a day and a start time.');
      const hours = Number(length.value);
      if (!(hours > 0)) throw new Error('How many hours should it take?');
      const s = zonedToUtc(date.value, start.value, TZ);
      const e = new Date(s.getTime() + Math.round(hours * 60) * 60_000);
      await api(`/jobs/${id}`, { method: 'PATCH', body: { start: s.toISOString(), end: e.toISOString() } });
      await redraw();
    },
    ghost,
  );
  const when = block(
    'When',
    h('div', { class: 'grid max-w-xl grid-cols-2 gap-3 sm:grid-cols-3' }, labelled('Day', date), labelled('Start', start), labelled('Hours', length)),
    h('div', { class: 'mt-4' }, move.row),
    j.status === 'scheduled' && !j.history
      ? h('p', { class: 'mt-3 text-sm text-bone-500' }, "Moving a job doesn't tell the customer. Send them the confirmation text again after.")
      : null,
  );

  /* ---------------------------------------------------------- price */

  // The quote, then any add-on the customer said yes to at the car.
  const quoted = [
    ...j.quote.lines.filter((l) => l.amount !== 0),
    ...(extras?.extras ?? []).filter((e) => e.status === 'approved').map((e) => ({ label: `${e.label} (added at the car)`, amount: e.amount })),
  ];
  const final = h('input', {
    type: 'number',
    class: input,
    step: '0.01',
    min: '0',
    inputmode: 'decimal',
    value: j.finalPrice !== null ? String(j.finalPrice / 100) : '',
  }) as HTMLInputElement;
  const savePrice = action(
    'Save price',
    async () => {
      const v = final.value.trim();
      const cents = v === '' ? null : Math.round(Number(v) * 100);
      if (cents !== null && !(Number.isFinite(cents) && cents >= 0)) throw new Error('The price should be a dollar amount.');
      const saved = await api<CalJob>(`/jobs/${id}`, { method: 'PATCH', body: { finalPrice: cents } });
      j.finalPrice = saved.finalPrice;
      return cents === null ? 'Cleared.' : `Saved: ${dollars(cents)}.`;
    },
    ghost,
  );
  const price = block(
    'Price',
    quoted.length
      ? h(
          'table',
          { class: 'w-full max-w-xl border-collapse text-sm' },
          h(
            'tbody',
            {},
            ...quoted.map((l) => h('tr', { class: 'border-b border-ink-800' }, h('td', { class: 'py-2 pr-4 text-bone-200' }, l.label), h('td', { class: 'py-2 text-right tabular-nums text-bone-50' }, dollars(l.amount)))),
          ),
        )
      : null,
    h(
      'p',
      { class: 'mt-3 text-sm text-bone-400' },
      imported
        ? 'Brought over from Housecall Pro.'
        : j.quote.range
          ? `The customer was quoted ${formatRange(j.quote.range)}.`
          : 'This one gets priced after you see it.',
    ),
    h(
      'div',
      { class: 'mt-4 flex max-w-xl flex-wrap items-end gap-3' },
      labelled('Final price ($)', final, 'w-40'),
      savePrice.btn,
      savePrice.status,
    ),
    h('p', { class: 'mt-2 text-sm text-bone-500' }, 'What you and the customer settled on. The invoice uses it.'),
  );

  /* ---------------------------------------------------------- invoice */

  const current = invoices.find((i) => i.status !== 'void') ?? null;
  const toInvoice = (inv: InvoiceLite) =>
    h('button', { type: 'button', class: textButton, onclick: () => void showInvoice(inv.id) }, `Open invoice ${inv.number} to send it or mark it paid`);
  const invoiceWords: Record<InvoiceLite['status'], string> = { draft: 'Not sent yet', sent: 'Sent', paid: 'Paid', void: 'Void' };
  const makeInvoice = action(
    'Make an invoice',
    async () => {
      await api(`/jobs/${id}/invoice`, { method: 'POST', body: {} });
      await redraw();
    },
    goldSmall,
  );
  const invoice = block(
    'Invoice',
    current
      ? h(
          'div',
          { class: 'flex flex-col gap-2' },
          h(
            'p',
            { class: 'text-bone-50' },
            `Invoice ${current.number} · `,
            h('span', { class: current.status === 'paid' ? 'text-gold-400' : 'text-bone-200' }, invoiceWords[current.status]),
            current.viewedAt && current.status === 'sent' ? h('span', { class: 'text-bone-400' }, ' · Seen') : null,
          ),
          h(
            'p',
            { class: 'text-sm tabular-nums text-bone-400' },
            `${dollars(current.total)} total`,
            current.status !== 'paid' ? ` · ${dollars(current.balance)} still owed` : '',
          ),
          h('div', { class: 'mt-1' }, toInvoice(current)),
        )
      : live && !j.history
        ? h(
            'div',
            {},
            h('p', { class: 'mb-3 text-sm text-bone-400' }, 'No invoice yet. This makes one from the price above. Then you can send it.'),
            makeInvoice.row,
          )
        : h('p', { class: 'text-sm text-bone-500' }, j.history ? 'Past jobs from Housecall Pro are already settled.' : 'Cancelled jobs don’t get an invoice.'),
  );

  /* ---------------------------------------------------------- details */

  const vehicle = h('input', { type: 'text', class: input, value: j.vehicle ?? '', maxlength: 120 }) as HTMLInputElement;
  const address = h('input', { type: 'text', class: input, value: j.address, maxlength: 200 }) as HTMLInputElement;
  const notes = h('textarea', { class: textArea, maxlength: 5000, rows: 4 }) as HTMLTextAreaElement;
  notes.value = j.notes ?? '';
  const saveDetails = action(
    'Save details',
    async () => {
      if (!address.value.trim()) throw new Error("The address can't be empty.");
      await api(`/jobs/${id}`, {
        method: 'PATCH',
        body: { vehicle: vehicle.value.trim() || null, address: address.value.trim(), notes: notes.value.trim() || null },
      });
      return 'Saved.';
    },
    ghost,
  );
  const details = block(
    'Details',
    h(
      'div',
      { class: 'flex max-w-xl flex-col gap-3' },
      labelled('Vehicle', vehicle),
      labelled('Job address', address),
      h('p', { class: '-mt-1 text-sm' }, link('Open in Maps', mapHref(j.address), true)),
      labelled('Notes (only you see these)', notes),
      saveDetails.row,
    ),
  );

  /* ---------------------------------------------------------- photos */

  const photoWrap = h('div', {}, h('p', { class: 'text-sm text-bone-500' }, 'Loading photos…'));
  const photos = block('Photos', photoWrap);
  void loadPhotos(id, photoWrap);

  /* ---------------------------------------------------------- cancel / undo */

  const reason = h('input', { type: 'text', class: input, maxlength: 200, placeholder: 'Rained out, customer asked…' }) as HTMLInputElement;
  const doCancel = action(
    'Yes, cancel it',
    async () => {
      const why = reason.value.trim();
      await setStatus('cancelled', why ? { cancelReason: why } : {});
    },
    'border border-red-400/60 px-3 py-1.5 text-sm text-red-300 transition-colors hover:border-red-400 hover:text-red-200',
  );
  const confirmBox = h(
    'div',
    { class: 'mt-4 flex max-w-xl flex-col gap-3 border-l-2 border-red-400/60 pl-4', hidden: true },
    labelled('Why? (optional, only you see it)', reason),
    h(
      'div',
      { class: 'flex flex-wrap items-center gap-3' },
      doCancel.btn,
      h('button', { type: 'button', class: ghost, onclick: () => (confirmBox.hidden = true) }, 'Keep it'),
      doCancel.status,
    ),
  );
  const reopen = action('Put it back on the calendar', () => setStatus('scheduled'), ghost);
  const undoDone = action('Not done yet? Move it back to Started', () => setStatus('in_progress'), ghost);
  const restart = action('Move it back to Booked', () => setStatus('scheduled'), ghost);

  const endBlock =
    j.status === 'cancelled'
      ? block('Cancelled', h('p', { class: 'mb-3 text-sm text-bone-400' }, 'Put it back if the customer still wants it. Check the day and time first.'), reopen.row)
      : j.status === 'done'
        ? block('Change your mind', undoDone.row)
        : block(
            'Cancel',
            j.status === 'in_progress' ? h('div', { class: 'mb-3' }, restart.row) : null,
            h(
              'button',
              {
                type: 'button',
                class: textButton,
                onclick: () => {
                  confirmBox.hidden = false;
                  reason.focus();
                },
              },
              'Cancel this job',
            ),
            confirmBox,
            h('p', { class: 'mt-3 text-sm text-bone-500' }, "Cancelling doesn't tell the customer. Call or text them."),
          );

  view.replaceChildren(
    backLink('Back to the calendar', () => opts.back(j.date)),
    ...(warn ? [warn] : []),
    top,
    h(
      'div',
      { class: 'mt-6 grid gap-x-12 lg:grid-cols-2' },
      h('div', {}, customer, when, details),
      h('div', {}, price, extrasBlock(id, live && !j.history, extras, () => redraw()), invoice, photos, endBlock),
    ),
  );
}

/**
 * Open the job's invoice on the Invoices tab. The tab draws its list when it
 * opens, so wait for that before drawing the invoice over it.
 */
async function showInvoice(id: string) {
  goTab('invoices');
  const v = document.querySelector<HTMLElement>('[data-view="invoices"]');
  for (let i = 0; i < 80 && v?.textContent === 'Loading…'; i++) await new Promise((r) => setTimeout(r, 100));
  await openInvoice(id).catch(showError);
}

async function loadPhotos(jobId: string, wrap: HTMLElement) {
  try {
    const { photos } = await api<{ photos: Photo[] }>(`/jobs/${jobId}/photos`);
    if (!photos.length) {
      wrap.replaceChildren(h('p', { class: 'text-sm text-bone-500' }, 'No photos yet. Take before and after shots in the app.'));
      return;
    }
    const tiles = await Promise.all(
      photos.map(async (p) => {
        const res = await fetch(`${API}${p.url}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        if (!res.ok) throw new Failed("Some photos didn't load.");
        const url = URL.createObjectURL(await res.blob());
        objectUrls.push(url);
        return h(
          'a',
          { href: url, target: '_blank', rel: 'noopener', class: 'group relative block aspect-square overflow-hidden bg-ink-900' },
          h('img', { src: url, alt: p.caption ?? `${p.stage ?? 'Job'} photo`, class: 'size-full object-cover transition-opacity group-hover:opacity-80', loading: 'lazy' }),
          p.stage ? h('span', { class: 'absolute bottom-0 left-0 bg-ink-950/85 px-2 py-0.5 text-[0.65rem] uppercase tracking-[0.14em] text-bone-200' }, p.stage) : null,
        );
      }),
    );
    wrap.replaceChildren(h('div', { class: 'grid grid-cols-3 gap-1 sm:grid-cols-4' }, ...tiles));
  } catch (err) {
    wrap.replaceChildren(h('p', { class: 'text-sm text-bone-500' }, (err as Error).message || "Photos didn't load."));
  }
}
