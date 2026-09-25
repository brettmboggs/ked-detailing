/**
 * The day grid and start times shared by /quote (booking) and /booking
 * (moving a booking). It only draws what the server offered and reports the
 * pick; the server re-checks any time that's sent back.
 */

export interface Day {
  date: string;
  slots: string[];
  /** Jacob already has a job near this address that day. */
  nearby?: boolean;
}

export interface PickerElements {
  days: HTMLElement;
  timesWrap: HTMLElement;
  timesLabel: HTMLElement;
  times: HTMLElement;
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Formatting in the business's zone. Dates are plain days, formatted at noon UTC so no zone can shift them. */
export function formatters(timezone: () => string) {
  const time = (iso: string) =>
    new Intl.DateTimeFormat('en-US', { timeZone: timezone(), hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
  const dayName = (date: string, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }).format(new Date(`${date}T12:00:00Z`));
  const longDay = (date: string) => dayName(date, { weekday: 'long', month: 'long', day: 'numeric' });
  const when = (iso: string, date: string) => `${dayName(date, { weekday: 'short', month: 'short', day: 'numeric' })} at ${time(iso)}`;
  return { time, dayName, longDay, when };
}

export function slotPicker(els: PickerElements, onPick: (day: string | null, slot: string | null) => void) {
  let days: Day[] = [];
  let timezone = 'America/Chicago';
  let day: string | null = null;
  let slot: string | null = null;
  const f = formatters(() => timezone);
  // Says what the gold rule under a date means, only when one is showing.
  const legend = document.createElement('p');
  legend.className = 'mt-3 flex items-center gap-3 text-sm text-bone-400';
  legend.hidden = true;
  const mark = document.createElement('span');
  mark.className = 'h-0.5 w-4 shrink-0 bg-gold-500';
  mark.setAttribute('aria-hidden', 'true');
  legend.append(mark, "Jacob's already working near you these days.");
  els.days.after(legend);

  /**
   * Show these days. The current pick survives if it's still open; otherwise
   * the first open day is shown with no time picked. Returns false if nothing
   * is open at all.
   */
  function set(next: Day[], tz: string): boolean {
    days = next;
    timezone = tz;
    const open = days.filter((d) => d.slots.length);
    if (!open.length) {
      day = slot = null;
      return false;
    }
    if (!day || !open.some((d) => d.date === day)) day = open[0]!.date;
    if (slot && !days.find((d) => d.date === day)?.slots.includes(slot)) slot = null;
    drawDays();
    drawTimes();
    onPick(day, slot);
    return true;
  }

  function clearSlot() {
    slot = null;
    onPick(day, slot);
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
    days.forEach((d, i) => {
      const weekday = new Date(`${d.date}T12:00:00Z`).getUTCDay();
      if (i === 0 || d.date.endsWith('-01')) {
        if (column !== 0) pad(7);
        column = 0;
        cells.push(
          cell(
            'col-span-7 px-3 py-2 text-left font-display text-sm uppercase tracking-[0.1em] text-bone-200',
            f.dayName(d.date, { month: 'long', year: 'numeric' }),
          ),
        );
        pad(weekday);
      }
      cells.push(d.slots.length ? dayOption(d) : cell('py-3 text-sm text-ink-600', String(Number(d.date.slice(8)))));
      column = (column + 1) % 7;
    });
    if (column !== 0) pad(7);
    els.days.replaceChildren(...cells);
    legend.hidden = !days.some((d) => d.nearby && d.slots.length);
  }

  function dayOption(d: Day) {
    const label = cell(
      'group relative cursor-pointer py-3 text-sm font-semibold text-bone-50 transition-colors hover:bg-ink-900 ' +
        'has-[:checked]:bg-gold-500 has-[:checked]:text-ink-950 ' +
        'has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-gold-400',
      String(Number(d.date.slice(8))),
      'label',
    );
    const name = d.nearby ? `${f.longDay(d.date)}, Jacob's nearby` : f.longDay(d.date);
    label.title = name;
    if (d.nearby) {
      const rule = document.createElement('span');
      rule.className = 'absolute bottom-1.5 left-1/2 h-0.5 w-4 -translate-x-1/2 bg-gold-500 group-has-[:checked]:bg-ink-950';
      rule.setAttribute('aria-hidden', 'true');
      label.append(rule);
    }
    const input = radio('day', d.date, d.date === day, name);
    input.addEventListener('change', () => {
      day = d.date;
      slot = null;
      drawTimes();
      onPick(day, slot);
    });
    label.prepend(input);
    return label;
  }

  function drawTimes() {
    const d = days.find((x) => x.date === day);
    if (!d) return void (els.timesWrap.hidden = true);
    els.timesWrap.hidden = false;
    els.timesLabel.textContent = d.nearby ? `${f.longDay(d.date)}. Jacob's already nearby that day.` : f.longDay(d.date);
    els.times.replaceChildren(
      ...d.slots.map((iso) => {
        const label = cell(
          'cursor-pointer py-3 text-sm tabular-nums text-bone-200 transition-colors hover:bg-ink-900 hover:text-bone-50 ' +
            'has-[:checked]:bg-gold-500 has-[:checked]:font-semibold has-[:checked]:text-ink-950 ' +
            'has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-gold-400',
          f.time(iso),
          'label',
        );
        const input = radio('slot', iso, iso === slot, `${f.longDay(d.date)} at ${f.time(iso)}`);
        input.addEventListener('change', () => {
          slot = iso;
          onPick(day, slot);
        });
        label.prepend(input);
        return label;
      }),
    );
  }

  return {
    set,
    clearSlot,
    get day() {
      return day;
    },
    get slot() {
      return slot;
    },
    ...f,
  };
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
