/**
 * Booking a job by hand, usually while Jacob is on the phone. Priced with the
 * same formula as the website (@ked/pricing, live config) so he can read the
 * price out; the server re-prices it when it saves. He can book any time: the
 * server answers clashes with warnings, shown on the job afterwards.
 */
import {
  applicableAddOns,
  applicableConditions,
  formatRange,
  quote,
  type PricingConfig,
  type Quote,
  type QuoteInput,
} from '@ked/pricing';
import { zonedToUtc } from '@ked/scheduling';
import { TZ, type BookingRules, h, api, input, small, heading, headingStyle, checkbox } from './core';
import { type CalJob, type Customer, action, backLink, block, goldSmall, labelled, textArea, textButton, today } from './calendar-shared';

let config: PricingConfig | null = null;

export async function renderNewJob(
  view: HTMLElement,
  opts: {
    customer?: Customer;
    date?: string;
    start?: string;
    back: () => void;
    created: (job: CalJob, warnings: string[]) => void;
  },
) {
  const [{ config: cfg }, { rules }] = await Promise.all([
    config ? Promise.resolve({ config }) : api<{ config: PricingConfig }>('/pricing'),
    api<{ rules: BookingRules }>('/settings/booking'),
  ]);
  config = cfg;

  /* ---------------------------------------------------------- who */

  let picked: Customer | null = opts.customer ?? null;
  const name = h('input', { type: 'text', class: input, maxlength: 100, autocomplete: 'off' }) as HTMLInputElement;
  const phone = h('input', { type: 'tel', class: input, maxlength: 30, autocomplete: 'off' }) as HTMLInputElement;
  const email = h('input', { type: 'email', class: input, maxlength: 200, autocomplete: 'off' }) as HTMLInputElement;
  const search = h('input', { type: 'search', class: input, placeholder: 'Name or phone number', autocomplete: 'off' }) as HTMLInputElement;
  const results = h('ul', { class: 'mt-1' });
  const who = h('div', {});

  const drawWho = () => {
    if (picked) {
      const c = picked;
      who.replaceChildren(
        h(
          'div',
          { class: 'flex flex-wrap items-baseline justify-between gap-3 border-l-2 border-gold-500 pl-4' },
          h(
            'div',
            {},
            h('p', { class: 'font-semibold text-bone-50' }, c.name),
            h('p', { class: 'text-sm text-bone-400' }, [c.phone, c.email].filter(Boolean).join(' · ') || 'No phone or email on file'),
          ),
          h(
            'button',
            {
              type: 'button',
              class: textButton,
              onclick: () => {
                picked = null;
                drawWho();
                search.focus();
              },
            },
            'Someone else',
          ),
        ),
      );
      return;
    }
    who.replaceChildren(
      labelled('Returning customer? Look them up', search),
      results,
      h('p', { class: `${small} mb-3 mt-6` }, 'Or someone new'),
      h('div', { class: 'grid gap-3 sm:grid-cols-3' }, labelled('Name', name), labelled('Phone', phone), labelled('Email (optional)', email)),
      h('p', { class: 'mt-2 text-sm text-bone-500' }, "If the phone number matches someone you have, the job goes on their record."),
    );
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    const q = search.value.trim();
    if (q.length < 2) return results.replaceChildren();
    timer = setTimeout(async () => {
      try {
        const { customers } = await api<{ customers: Customer[] }>(`/customers?q=${encodeURIComponent(q)}`);
        if (search.value.trim() !== q) return;
        results.replaceChildren(
          ...(customers.length
            ? customers.slice(0, 6).map((c) =>
                h(
                  'li',
                  {},
                  h(
                    'button',
                    {
                      type: 'button',
                      class: 'flex w-full flex-wrap items-baseline justify-between gap-x-4 border-b border-ink-800 px-1 py-2.5 text-left hover:bg-ink-900',
                      onclick: () => choose(c),
                    },
                    h('span', { class: 'text-bone-50' }, c.name),
                    h('span', { class: 'text-sm tabular-nums text-bone-400' }, c.phone ?? c.email ?? ''),
                  ),
                ),
              )
            : [h('li', { class: 'py-2 text-sm text-bone-500' }, 'Nobody by that name or number yet.')]),
        );
      } catch {
        // Searching is a convenience; typing a new customer still works.
      }
    }, 250);
  });

  /* ---------------------------------------------------------- where */

  const address = h('input', { type: 'text', class: input, maxlength: 200, autocomplete: 'off' }) as HTMLInputElement;
  const zip = h('input', { type: 'text', class: input, maxlength: 10, inputmode: 'numeric', autocomplete: 'off' }) as HTMLInputElement;
  const fillAddress = (a: string | null) => {
    if (!a) return;
    address.value = a;
    const m = a.match(/\b(\d{5})(?:-\d{4})?\s*$/);
    if (m) zip.value = m[1]!;
  };
  /** Their address on file, or where their last job was. */
  const fillFrom = async (c: Customer) => {
    if (address.value) return;
    if (c.address) return fillAddress(c.address);
    try {
      const { jobs } = await api<{ jobs: CalJob[] }>(`/customers/${c.id}`);
      const last = jobs[0];
      if (!last || address.value) return;
      address.value = last.address;
      if (last.zip) zip.value = last.zip;
      refresh();
    } catch {
      // Jacob can type it.
    }
  };
  const choose = (c: Customer) => {
    picked = c;
    void fillFrom(c);
    drawWho();
    refresh();
  };
  if (picked) void fillFrom(picked);
  drawWho();

  /* ---------------------------------------------------------- what */

  const vehicleServices = cfg.services;
  const service = h('select', { class: input }, ...vehicleServices.map((s) => h('option', { value: s.id }, `${s.level ? `${s.level}: ` : ''}${s.name}`))) as HTMLSelectElement;
  const size = h('select', { class: input }, ...cfg.vehicleClasses.map((c) => h('option', { value: c.id }, `${c.label} (${c.examples})`))) as HTMLSelectElement;
  size.value = cfg.vehicleClasses.find((c) => c.multiplier === 1)?.id ?? cfg.vehicleClasses[0]?.id ?? '';
  const feet = h('input', { type: 'number', class: input, min: '1', step: '1', inputmode: 'numeric', value: '22' }) as HTMLInputElement;
  const vehicle = h('input', { type: 'text', class: input, maxlength: 120, placeholder: '2019 Honda CR-V, silver', autocomplete: 'off' }) as HTMLInputElement;
  const answers: Record<string, string> = {};
  const addOns = new Set<string>();
  const extras = h('div', { class: 'flex flex-col gap-3' });
  const sizeRow = h('div', {});
  const priceLine = h('div', { class: 'border-l-2 border-gold-500 pl-4', role: 'status' });

  const currentService = () => cfg.services.find((s) => s.id === service.value)!;
  const readInput = (): QuoteInput => {
    const s = currentService();
    return {
      service: s.id,
      ...(s.craft === 'vehicle' ? { vehicleClass: size.value } : { boatFeet: Number(feet.value) }),
      conditions: { ...answers },
      addOns: [...addOns],
      zip: zip.value.trim() || undefined,
    };
  };

  let priced: Quote | null = null;
  const refresh = () => {
    try {
      priced = quote(cfg, readInput());
    } catch (err) {
      priced = null;
      priceLine.replaceChildren(h('p', { class: 'text-sm text-bone-400' }, (err as Error).message));
      return;
    }
    const hrs = priced.hours;
    priceLine.replaceChildren(
      h(
        'p',
        { class: 'font-display text-2xl tabular-nums text-bone-50', style: "font-variation-settings:'wdth' 80,'wght' 700" },
        priced.range ? formatRange(priced.range) : 'Priced after you see it',
      ),
      h('p', { class: 'text-sm text-bone-400' }, `About ${hrs[0] === hrs[1] ? hrs[0] : `${hrs[0]}–${hrs[1]}`} hours of work.`),
      ...priced.notes.map((n) => h('p', { class: 'text-sm text-bone-500' }, n)),
    );
    if (!length.value) length.placeholder = String(Math.ceil((priced.hours[1] * 60) / rules.slotStepMinutes) * rules.slotStepMinutes / 60);
  };

  /** Size, condition questions and add-ons for the chosen package. */
  const drawExtras = () => {
    const s = currentService();
    sizeRow.replaceChildren(s.craft === 'vehicle' ? labelled('Size', size) : labelled('Boat length (feet)', feet));
    for (const k of Object.keys(answers)) delete answers[k];
    for (const a of [...addOns]) if (!applicableAddOns(cfg, s).some((x) => x.id === a)) addOns.delete(a);
    extras.replaceChildren(
      ...applicableConditions(cfg, s).map((c) => {
        const sel = h('select', { class: input }, ...c.options.map((o) => h('option', { value: o.id }, o.label))) as HTMLSelectElement;
        sel.addEventListener('change', () => {
          answers[c.id] = sel.value;
          refresh();
        });
        return labelled(c.question, sel);
      }),
      ...(applicableAddOns(cfg, s).length
        ? [
            h(
              'div',
              { class: 'flex flex-col gap-2 pt-1' },
              h('span', { class: small }, 'Add-ons'),
              ...applicableAddOns(cfg, s).map((a) =>
                checkbox(a.label, () => addOns.has(a.id), (on) => {
                  if (on) addOns.add(a.id);
                  else addOns.delete(a.id);
                  refresh();
                }),
              ),
            ),
          ]
        : []),
    );
  };
  service.addEventListener('change', () => {
    drawExtras();
    refresh();
  });
  size.addEventListener('change', refresh);
  feet.addEventListener('input', refresh);
  zip.addEventListener('input', refresh);

  /* ---------------------------------------------------------- when */

  const openAt = rules.week.find(Boolean)?.open ?? '09:00';
  const date = h('input', { type: 'date', class: input, value: opts.date ?? today() }) as HTMLInputElement;
  const start = h('input', { type: 'time', class: input, value: opts.start ?? openAt, step: 900 }) as HTMLInputElement;
  const length = h('input', { type: 'number', class: input, min: '0.5', step: '0.5', inputmode: 'decimal' }) as HTMLInputElement;
  const notes = h('textarea', { class: textArea, maxlength: 5000, rows: 3, placeholder: 'Gate code, where to park, anything to remember' }) as HTMLTextAreaElement;

  drawExtras();
  refresh();

  const save = action(
    'Book it',
    async () => {
      if (!picked && !name.value.trim()) throw new Error('Pick a customer, or type a new name.');
      if (!address.value.trim()) throw new Error('Add the address for the job.');
      if (!date.value || !start.value) throw new Error('Pick a day and a start time.');
      if (!priced) throw new Error('Finish the package details first.');
      const hours = length.value ? Number(length.value) : null;
      if (hours !== null && !(hours > 0)) throw new Error('Hours should be more than zero, or leave it blank.');
      const body: Record<string, unknown> = {
        input: readInput(),
        start: zonedToUtc(date.value, start.value, TZ).toISOString(),
        address: address.value.trim(),
        zip: zip.value.trim() || undefined,
        vehicle: vehicle.value.trim() || undefined,
        notes: notes.value.trim() || undefined,
        ...(hours ? { minutes: Math.round(hours * 60) } : {}),
      };
      if (picked) body.customerId = picked.id;
      else
        body.customer = {
          name: name.value.trim(),
          phone: phone.value.trim() || undefined,
          email: email.value.trim() || undefined,
          address: address.value.trim(),
        };
      const { job, warnings } = await api<{ job: CalJob; warnings: string[] }>('/jobs', { method: 'POST', body });
      opts.created(job, warnings);
    },
    goldSmall,
  );

  view.replaceChildren(
    backLink('Back to the calendar', opts.back),
    h('h2', { class: heading, style: headingStyle }, 'New job'),
    h('p', { class: 'mt-1 max-w-2xl text-sm text-bone-400' }, 'Book someone yourself. The price uses your current prices, same as the website.'),
    h(
      'div',
      { class: 'mt-6 grid gap-x-12 lg:grid-cols-[1fr_20rem]' },
      h(
        'div',
        { class: 'max-w-2xl' },
        block('Who', who),
        block('Where', h('div', { class: 'grid grid-cols-[1fr_7rem] gap-3' }, labelled('Address', address), labelled('ZIP', zip)), h('p', { class: 'mt-2 text-sm text-bone-500' }, 'The ZIP sets the travel fee.')),
        block(
          'What',
          h('div', { class: 'grid gap-3 sm:grid-cols-2' }, labelled('Package', service), sizeRow),
          h('div', { class: 'mt-3' }, labelled('Vehicle or boat', vehicle)),
          h('div', { class: 'mt-4' }, extras),
        ),
        block(
          'When',
          h('div', { class: 'grid grid-cols-2 gap-3 sm:grid-cols-3' }, labelled('Day', date), labelled('Start', start), labelled('Hours (optional)', length)),
          h('p', { class: 'mt-2 text-sm text-bone-500' }, "Leave hours blank to use the package's usual time."),
        ),
        block('Notes', notes),
      ),
      h(
        'div',
        { class: 'lg:pt-6' },
        h(
          'div',
          { class: 'sticky top-6 flex flex-col gap-5 border-t border-ink-800 py-6 lg:border-t-0 lg:py-0' },
          h('p', { class: small }, 'Price to tell them'),
          priceLine,
          save.row,
        ),
      ),
    ),
  );
}
