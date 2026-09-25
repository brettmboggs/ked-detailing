import type { Quote, QuoteInput } from '@ked/pricing';
import { firstTouch } from './attribution';
import { slotPicker, type Day } from './slot-picker';

/**
 * The "When" and "Your details" half of /quote: fetches open times for the job
 * as currently priced, draws the calendar, and books it (or sends it to Jacob
 * as a quote request when it can't be booked online).
 *
 * The server decides everything that matters — the price, the job length and
 * whether a time is free. This only displays what it says.
 */

interface Availability {
  bookable: boolean;
  reason?: string;
  timezone: string;
  minutes: number;
  days: Day[];
}

interface Options {
  api: string;
  form: HTMLFormElement;
  readInput: () => QuoteInput;
  phone: string;
}

export function initBooking({ api, form, readInput, phone }: Options) {
  const $ = <T extends HTMLElement>(sel: string) => form.querySelector<T>(sel)!;
  const status = $('[data-when-status]');
  const calendar = $('[data-calendar]');
  const lengthEl = $('[data-length]');
  const bookBtn = $<HTMLButtonElement>('[data-book]');
  const leadBtn = $<HTMLButtonElement>('[data-send-lead]');
  const errorEl = $('[data-submit-error]');
  const done = $('[data-done]');
  const chosen = document.querySelector<HTMLElement>('[data-chosen]');
  const chosenText = document.querySelector<HTMLElement>('[data-chosen-text]');

  let avail: Availability | null = null;
  const picker = slotPicker(
    { days: $('[data-days]'), timesWrap: $('[data-times-wrap]'), timesLabel: $('[data-times-label]'), times: $('[data-times]') },
    (d, s) => choose(d, s),
  );
  let lastKey = '';
  let request = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let busy = false;

  /* ------------------------------------------------------ formatting */

  const { when } = picker;
  const hoursText = (minutes: number) => {
    const h = minutes / 60;
    return `${h} ${h === 1 ? 'hour' : 'hours'}`;
  };

  /* ------------------------------------------------------ fetching */

  /** Called on every quote change. Refetches only when the answers change. */
  function changed(q: Quote | null) {
    if (busy || !done.hidden) return;
    const input = readInput();
    const key = q ? JSON.stringify(input) : '';
    if (key === lastKey) return;
    lastKey = key;
    clearTimeout(timer);
    if (!q) {
      avail = null;
      showStatus("Finish the quote above to see open times.");
      return;
    }
    if (calendar.hidden) {
      showStatus('Finding open times…');
    } else {
      // Keep the calendar and the pick on screen while it refreshes; the pick
      // survives if the new answers still leave that time open.
      calendar.classList.add('opacity-50', 'pointer-events-none');
      bookBtn.disabled = true;
      bookBtn.textContent = 'Checking times…';
    }
    timer = setTimeout(() => load(input), 350);
  }

  async function load(input: QuoteInput) {
    const mine = ++request;
    try {
      const res = await fetch(`${api}/v1/availability`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as Availability;
      if (mine !== request) return; // a newer request is on its way
      avail = data;
      draw();
    } catch {
      if (mine !== request) return;
      avail = null;
      showStatus(`Couldn't load open times. Send the quote to Jacob instead, or call ${formatPhone(phone)}.`);
    }
  }

  /* ------------------------------------------------------ drawing */

  function showStatus(message: string) {
    calendar.classList.remove('opacity-50', 'pointer-events-none');
    status.textContent = message;
    status.hidden = false;
    calendar.hidden = true;
    choose(null, null);
  }

  function draw() {
    if (!avail) return;
    if (!avail.bookable) return showStatus(avail.reason ?? 'This one can’t be booked online.');
    const open = avail.days.filter((d) => d.slots.length);
    if (!open.length) return showStatus('Nothing open online in the next few weeks. Send the quote to Jacob and he’ll fit you in.');

    status.hidden = true;
    calendar.hidden = false;
    calendar.classList.remove('opacity-50', 'pointer-events-none');
    lengthEl.textContent = `Jacob holds ${hoursText(avail.minutes)} for this job.`;
    // Keeps the customer's pick if it's still open.
    picker.set(avail.days, avail.timezone);
  }

  /** Reflect the current pick in the book button and the summary panel. */
  function choose(d: string | null, s: string | null) {
    const ready = Boolean(d && s);
    bookBtn.disabled = !ready;
    bookBtn.textContent = ready ? `Book ${when(s!, d!)}` : 'Pick a time above';
    if (chosen && chosenText) {
      chosen.hidden = !ready;
      chosenText.textContent = ready ? when(s!, d!) : '';
    }
  }

  /* ------------------------------------------------------ submitting */

  const field = (name: string) => String(new FormData(form).get(name) ?? '').trim();

  function fail(message: string) {
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  function finish(title: string, body: string, manageUrl?: string) {
    form.querySelector<HTMLElement>('[data-when]')!.hidden = true;
    form.querySelector<HTMLElement>('[data-details]')!.hidden = true;
    done.querySelector('[data-done-title]')!.textContent = title;
    done.querySelector('[data-done-body]')!.textContent = body;
    const link = done.querySelector<HTMLAnchorElement>('[data-done-link]');
    if (link && manageUrl) {
      link.href = manageUrl;
      link.hidden = false;
    }
    done.hidden = false;
    done.focus();
  }

  /** Where they heard about Jacob, plus what the browser saw on their first visit. */
  const touch = () => ({ source: field('source') || undefined, attribution: firstTouch() ?? undefined });

  async function post(path: string, body: unknown) {
    const res = await fetch(`${api}/v1/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string }; manageUrl?: string } | null;
    return { res, error: json?.error, body: json };
  }

  async function run(button: HTMLButtonElement, working: string, task: () => Promise<void>) {
    errorEl.hidden = true;
    busy = true;
    const label = button.textContent;
    bookBtn.disabled = leadBtn.disabled = true;
    button.textContent = working;
    try {
      await task();
    } catch {
      fail(`Couldn't reach us. Check your signal, or call ${formatPhone(phone)}.`);
    } finally {
      busy = false;
      button.textContent = label;
      leadBtn.disabled = false;
      choose(picker.day, picker.slot);
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const slot = picker.slot;
    const day = picker.day;
    if (!slot || !day) return fail('Pick a day and a time first.');
    if (!field('name')) return fail('Add your name so Jacob knows who to ask for.');
    if (!field('phone')) return fail('Add a phone number so Jacob can reach you on the day.');
    if (!field('address')) return fail('Add the address where the vehicle will be.');
    const start = slot;
    const date = day;

    void run(bookBtn, 'Booking…', async () => {
      const input = readInput();
      const { res, error, body: booking } = await post('bookings', {
        name: field('name'),
        phone: field('phone'),
        email: field('email'),
        address: field('address'),
        notes: field('notes'),
        website: field('website'),
        vehicle: field('vehicle'),
        zip: input.zip,
        input,
        start,
        ...touch(),
      });
      if (res.status === 201) {
        finish(
          `Booked: ${when(start, date)}`,
          'Jacob has it on his calendar and will text you to confirm. Save the link below: it lets you move or cancel your booking.',
          booking?.manageUrl,
        );
        return;
      }
      fail(error?.message ?? `That didn't go through. Call or text ${formatPhone(phone)}.`);
      // Someone else got there first: show what's still open.
      if (res.status === 409) {
        picker.clearSlot();
        lastKey = '';
        await load(input);
      }
    });
  });

  leadBtn.addEventListener('click', () => {
    if (!field('name')) return fail('Add your name so Jacob knows who to ask for.');
    if (!field('phone') && !field('email')) return fail('Add a phone number or an email.');

    void run(leadBtn, 'Sending…', async () => {
      const input = readInput();
      const notes = [field('address') && `Address: ${field('address')}`, field('notes')].filter(Boolean).join('\n');
      const { res, error } = await post('leads', {
        name: field('name'),
        phone: field('phone'),
        email: field('email'),
        website: field('website'),
        vehicle: field('vehicle'),
        zip: input.zip,
        notes,
        input,
        ...touch(),
      });
      if (res.ok) {
        finish('Sent to Jacob', `He has your quote and will get back to you with a firm price and a time. If it's urgent, call ${formatPhone(phone)}.`);
        return;
      }
      fail(error?.message ?? `That didn't go through. Call or text ${formatPhone(phone)}.`);
    });
  });

  return { changed };
}

/** "+13142232988" → "(314) 223-2988". */
function formatPhone(e164: string) {
  const d = e164.replace(/\D/g, '').slice(-10);
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}
