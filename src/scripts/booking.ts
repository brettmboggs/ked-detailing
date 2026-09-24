import type { Quote, QuoteInput } from '@ked/pricing';

/**
 * The "When" and "Your details" half of /quote: fetches open times for the job
 * as currently priced, draws the calendar, and books it (or sends it to Jacob
 * as a quote request when it can't be booked online).
 *
 * The server decides everything that matters — the price, the job length and
 * whether a time is free. This only displays what it says.
 */

interface Day {
  date: string;
  slots: string[];
}

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

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function initBooking({ api, form, readInput, phone }: Options) {
  const $ = <T extends HTMLElement>(sel: string) => form.querySelector<T>(sel)!;
  const status = $('[data-when-status]');
  const calendar = $('[data-calendar]');
  const daysEl = $('[data-days]');
  const timesWrap = $('[data-times-wrap]');
  const timesLabel = $('[data-times-label]');
  const timesEl = $('[data-times]');
  const lengthEl = $('[data-length]');
  const bookBtn = $<HTMLButtonElement>('[data-book]');
  const leadBtn = $<HTMLButtonElement>('[data-send-lead]');
  const errorEl = $('[data-submit-error]');
  const done = $('[data-done]');
  const chosen = document.querySelector<HTMLElement>('[data-chosen]');
  const chosenText = document.querySelector<HTMLElement>('[data-chosen-text]');

  let avail: Availability | null = null;
  let day: string | null = null;
  let slot: string | null = null;
  let lastKey = '';
  let request = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let busy = false;

  /* ------------------------------------------------------ formatting */

  const tz = () => avail?.timezone ?? 'America/Chicago';
  const time = (iso: string) =>
    new Intl.DateTimeFormat('en-US', { timeZone: tz(), hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
  // Dates are plain calendar days: format at noon UTC so no zone can shift them.
  const dayName = (date: string, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }).format(new Date(`${date}T12:00:00Z`));
  const longDay = (date: string) => dayName(date, { weekday: 'long', month: 'long', day: 'numeric' });
  const when = (iso: string, date: string) => `${dayName(date, { weekday: 'short', month: 'short', day: 'numeric' })} at ${time(iso)}`;
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

    // Keep the customer's pick if it's still open; otherwise the first open day.
    if (!day || !open.some((d) => d.date === day)) day = open[0]!.date;
    if (slot && !avail.days.find((d) => d.date === day)?.slots.includes(slot)) slot = null;
    drawDays();
    drawTimes();
    choose(day, slot);
  }

  function drawDays() {
    const cells: HTMLElement[] = WEEKDAYS.map((w) => cell('py-2 text-xs uppercase tracking-[0.15em] text-bone-500', w));
    let column = 0;
    const pad = (to: number) => {
      while (column < to) {
        cells.push(cell('py-3'));
        column++;
      }
    };
    avail!.days.forEach((d, i) => {
      const weekday = new Date(`${d.date}T12:00:00Z`).getUTCDay();
      if (i === 0 || d.date.endsWith('-01')) {
        if (column !== 0) pad(7);
        column = 0;
        const month = cell(
          'col-span-7 px-3 py-2 text-left font-display text-sm uppercase tracking-[0.1em] text-bone-200',
          dayName(d.date, { month: 'long', year: 'numeric' }),
        );
        cells.push(month);
        pad(weekday);
      }
      cells.push(d.slots.length ? dayOption(d) : cell('py-3 text-sm text-ink-600', String(Number(d.date.slice(8)))));
      column = (column + 1) % 7;
    });
    if (column !== 0) pad(7);
    daysEl.replaceChildren(...cells);
  }

  function dayOption(d: Day) {
    const label = cell(
      'relative cursor-pointer py-3 text-sm font-semibold text-bone-50 transition-colors hover:bg-ink-900 ' +
        'has-[:checked]:bg-gold-500 has-[:checked]:text-ink-950 ' +
        'has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-gold-400',
      String(Number(d.date.slice(8))),
      'label',
    );
    label.title = longDay(d.date);
    const input = radio('day', d.date, d.date === day, longDay(d.date));
    input.addEventListener('change', () => {
      day = d.date;
      slot = null;
      drawTimes();
      choose(day, slot);
    });
    label.prepend(input);
    return label;
  }

  function drawTimes() {
    const d = avail!.days.find((x) => x.date === day);
    if (!d) return void (timesWrap.hidden = true);
    timesWrap.hidden = false;
    timesLabel.textContent = longDay(d.date);
    timesEl.replaceChildren(
      ...d.slots.map((iso) => {
        const label = cell(
          'cursor-pointer py-3 text-sm tabular-nums text-bone-200 transition-colors hover:bg-ink-900 hover:text-bone-50 ' +
            'has-[:checked]:bg-gold-500 has-[:checked]:font-semibold has-[:checked]:text-ink-950 ' +
            'has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-gold-400',
          time(iso),
          'label',
        );
        const input = radio('slot', iso, iso === slot, `${longDay(d.date)} at ${time(iso)}`);
        input.addEventListener('change', () => {
          slot = iso;
          choose(day, slot);
        });
        label.prepend(input);
        return label;
      }),
    );
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

  /** A ruled grid cell. Pickable cells are labels, so a click anywhere selects. */
  function cell(className: string, text?: string, tag: 'div' | 'label' = 'div') {
    const el = document.createElement(tag);
    el.className = `border-b border-r border-ink-800 ${className}`;
    if (text !== undefined) el.append(text);
    return el;
  }

  function radio(name: string, value: string, checked: boolean, label: string) {
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = name;
    input.value = value;
    input.checked = checked;
    input.className = 'sr-only';
    input.setAttribute('aria-label', label);
    return input;
  }

  /* ------------------------------------------------------ submitting */

  const field = (name: string) => String(new FormData(form).get(name) ?? '').trim();

  function fail(message: string) {
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  function finish(title: string, body: string) {
    form.querySelector<HTMLElement>('[data-when]')!.hidden = true;
    form.querySelector<HTMLElement>('[data-details]')!.hidden = true;
    done.querySelector('[data-done-title]')!.textContent = title;
    done.querySelector('[data-done-body]')!.textContent = body;
    done.hidden = false;
    done.focus();
  }

  async function post(path: string, body: unknown) {
    const res = await fetch(`${api}/v1/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    return { res, error: json?.error };
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
      choose(day, slot);
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!slot || !day) return fail('Pick a day and a time first.');
    if (!field('name')) return fail('Add your name so Jacob knows who to ask for.');
    if (!field('phone')) return fail('Add a phone number so Jacob can reach you on the day.');
    if (!field('address')) return fail('Add the address where the vehicle will be.');
    const start = slot;
    const date = day;

    void run(bookBtn, 'Booking…', async () => {
      const input = readInput();
      const { res, error } = await post('bookings', {
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
      });
      if (res.status === 201) {
        finish(`Booked: ${when(start, date)}`, `Jacob has it on his calendar and will text you to confirm. Need to change it? Call or text ${formatPhone(phone)}.`);
        return;
      }
      fail(error?.message ?? `That didn't go through. Call or text ${formatPhone(phone)}.`);
      // Someone else got there first: show what's still open.
      if (res.status === 409) {
        slot = null;
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
