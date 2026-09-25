import { formatRange, quote, validateConfig, type PricingConfig } from '@ked/pricing';
import { Failed, type Child, h, $, when, api, small, sectionHead, field, checkbox, saveBar } from './core';

export async function renderPrices() {
  const view = $('[data-view="prices"]');
  const { config, updatedAt } = await api<{ config: PricingConfig; updatedAt: string | null }>('/pricing');
  const cfg: PricingConfig = structuredClone(config);

  const preview = h('div', { class: 'overflow-x-auto' });
  const refresh = () => {
    const vehicle = cfg.services.filter((s) => s.craft === 'vehicle' && !s.inspectionOnly);
    const cell = (serviceId: string, vehicleClass: string) => {
      try {
        const q = quote(cfg, { service: serviceId, vehicleClass });
        return q.range ? formatRange(q.range) : '—';
      } catch {
        return '—';
      }
    };
    preview.replaceChildren(
      h(
        'table',
        { class: 'w-full min-w-[40rem] border-collapse text-left text-sm' },
        h('thead', {}, h('tr', { class: 'border-b border-ink-800' }, h('th', { class: `${small} py-2 pr-4 font-normal` }, 'Package'), ...cfg.vehicleClasses.map((c) => h('th', { class: `${small} py-2 pr-4 font-normal` }, c.label)))),
        h('tbody', {}, ...vehicle.map((s) => h('tr', { class: 'border-b border-ink-800' }, h('td', { class: 'py-2 pr-4 text-bone-50' }, s.name), ...cfg.vehicleClasses.map((c) => h('td', { class: 'py-2 pr-4 tabular-nums text-bone-200' }, cell(s.id, c.id)))))),
      ),
    );
  };
  // Every field edits cfg, then the preview recomputes.
  // Loosely typed on purpose: each setter narrows its own value (`as number`, String(v)).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bind = (get: () => any, set: (v: any) => void): [() => any, (v: any) => void] => [get, (v) => (set(v), refresh())];
  const grid = (...children: Child[]) => h('div', { class: 'grid grid-cols-2 gap-3 sm:grid-cols-4' }, ...children);
  const block = (title: string, ...children: Child[]) => h('div', { class: 'border-t border-ink-800 py-5' }, h('p', { class: 'mb-3 font-semibold text-bone-50' }, title), ...children);

  const packages = cfg.services.map((s) =>
    block(
      `${s.level ? `${s.level}: ` : ''}${s.name}`,
      s.inspectionOnly
        ? h('p', { class: 'text-sm text-bone-400' }, 'Priced after Jacob sees it, so there are no numbers to set.')
        : grid(
            field(s.craft === 'boat' ? 'Price per foot ($)' : 'Price, sedan ($)', ...bind(() => s.base, (v) => (s.base = v as number)), { kind: 'money' }),
            field(s.craft === 'boat' ? 'Hours per foot, low' : 'Hours, low', ...bind(() => s.hours[0], (v) => (s.hours[0] = v as number)), { step: 0.05, min: 0 }),
            field(s.craft === 'boat' ? 'Hours per foot, high' : 'Hours, high', ...bind(() => s.hours[1], (v) => (s.hours[1] = v as number)), { step: 0.05, min: 0 }),
            field('Range either side (%)', ...bind(() => Math.round(s.spread * 100), (v) => (s.spread = (v as number) / 100)), { step: 1, min: 0 }),
          ),
    ),
  );

  const sizes = cfg.vehicleClasses.map((c) =>
    block(c.label, grid(
      field('Name', ...bind(() => c.label, (v) => (c.label = String(v))), { kind: 'text' }),
      field('Examples', ...bind(() => c.examples, (v) => (c.examples = String(v))), { kind: 'text' }),
      field('Times the sedan price', ...bind(() => c.multiplier, (v) => (c.multiplier = v as number)), { step: 0.05, min: 0 }),
    )),
  );

  const conditions = cfg.conditions.map((q) =>
    block(`${q.question} (${q.craft === 'boat' ? 'boats' : 'cars'})`, ...q.options.map((o, i) =>
      grid(
        field(i === 0 ? 'Answer (costs nothing)' : 'Answer', ...bind(() => o.label, (v) => (o.label = String(v))), { kind: 'text' }),
        field(q.craft === 'boat' && o.scalesWithSize ? 'Adds per foot ($)' : 'Adds ($)', ...bind(() => o.add, (v) => (o.add = v as number)), { kind: 'money' }),
        field('Extra hours', ...bind(() => o.hours, (v) => (o.hours = v as number)), { step: 0.05, min: 0 }),
        h('div', { class: 'flex items-end pb-2' }, checkbox('Bigger vehicle costs more', ...bind(() => o.scalesWithSize, (v) => (o.scalesWithSize = v)))),
      ),
    )),
  );

  const addOns = cfg.addOns.map((a) =>
    block(a.label, grid(
      field('Name', ...bind(() => a.label, (v) => (a.label = String(v))), { kind: 'text' }),
      field('Price ($)', ...bind(() => a.price, (v) => (a.price = v as number)), { kind: 'money' }),
      field('Hours', ...bind(() => a.hours, (v) => (a.hours = v as number)), { step: 0.05, min: 0 }),
      h('div', { class: 'flex items-end pb-2' }, checkbox('Bigger vehicle costs more', ...bind(() => a.scalesWithSize, (v) => (a.scalesWithSize = v)))),
      field('What it is', ...bind(() => a.description, (v) => (a.description = String(v))), { kind: 'text', wide: true }),
    )),
  );

  const travel = [
    ...cfg.travel.zones.map((z) =>
      block(z.label, grid(
        field('Area name', ...bind(() => z.label, (v) => (z.label = String(v))), { kind: 'text' }),
        field('Travel fee ($)', ...bind(() => z.fee, (v) => (z.fee = v as number)), { kind: 'money' }),
        field('ZIP codes (comma-separated; 3 digits covers a region)', ...bind(() => z.zips.join(', '), (v) => (z.zips = String(v).split(/[\s,]+/).filter(Boolean))), { kind: 'text', wide: true }),
      )),
    ),
    block('Everywhere else', grid(
      field('Fee outside those areas ($)', ...bind(() => cfg.travel.outsideFee, (v) => (cfg.travel.outsideFee = v as number | null)), { kind: 'money', blank: 'Jacob confirms' }),
      field('Smallest job ($)', ...bind(() => cfg.minimum, (v) => (cfg.minimum = v as number)), { kind: 'money' }),
      field('Round shown prices to ($)', ...bind(() => cfg.roundTo, (v) => (cfg.roundTo = v as number)), { kind: 'money' }),
    )),
  ];

  refresh();
  view.replaceChildren(
    sectionHead('What customers see', 'The estimate range for each package and size, worked out live from the numbers below. Nothing changes on the website until you save.'),
    preview,
    sectionHead('Packages', 'Car prices are for a sedan. Other sizes multiply it (see Sizes).'),
    ...packages,
    sectionHead('Sizes'),
    ...sizes,
    sectionHead('Condition questions', 'What each answer adds to the price and the time.'),
    ...conditions,
    sectionHead('Add-ons'),
    ...addOns,
    sectionHead('Travel and minimums'),
    ...travel,
    h('p', { class: 'mt-6 text-xs text-bone-500' }, updatedAt ? `Last saved ${when(updatedAt, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}.` : 'These are still the sample prices.'),
    saveBar('Save prices', async () => {
      const problems = validateConfig(cfg);
      if (problems.length) throw new Failed('Some prices need fixing before they can be saved.', problems);
      await api('/pricing', { method: 'PUT', body: cfg });
      return 'Saved. The website shows the new prices in about a minute.';
    }),
  );
}
