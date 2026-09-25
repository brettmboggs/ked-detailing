/**
 * Marketing → Links & QR codes: a different link for each thing Jacob puts
 * out (van magnet, door hangers, Instagram bio...). The website remembers
 * which link someone first came in on, so each one shows the people and
 * jobs it brought. QR codes are made here in the browser, ready to print.
 */
import { h, api, input, small, dollars } from './core';
import { type GoOpts, type MarketingCtx, M, button, confirmButton, copyButton, goldSmall, note, part, plural, quiet } from './marketing-shared';
import { download, encode, qrPng, qrSvg, qrSvgFile } from './marketing-qr';

interface Link {
  id: string;
  name: string;
  channel: string;
  source: string;
  medium: string;
  campaign: string;
  url: string;
  createdAt: string;
  leads: number;
  bookings: number;
  revenue: number;
}

/** Where a link goes, and the tags that tell the website where people came from. */
export const PRESETS: { key: string; name: string; source: string; medium: string; tip: string }[] = [
  { key: 'van', name: 'Van magnet', source: 'van', medium: 'magnet', tip: 'A QR magnet on the van. People see it at every job.' },
  { key: 'door-hangers', name: 'Door hangers', source: 'doorhanger', medium: 'print', tip: "Hang them on the neighbors' doors after a job." },
  { key: 'instagram', name: 'Instagram bio', source: 'instagram', medium: 'bio', tip: 'Put it in your Instagram bio instead of the plain website.' },
  { key: 'facebook', name: 'Facebook', source: 'facebook', medium: 'social', tip: 'For your Facebook page and posts in town groups.' },
  { key: 'nextdoor', name: 'Nextdoor', source: 'nextdoor', medium: 'social', tip: 'For your Nextdoor business page and posts.' },
  { key: 'flyers', name: 'Flyers', source: 'flyer', medium: 'print', tip: 'For flyers at shops, marinas and apartment offices.' },
  { key: 'cards', name: 'Business cards', source: 'card', medium: 'print', tip: 'Print the QR code on the back of your cards.' },
  { key: 'maps', name: 'Google profile', source: 'gbp', medium: 'profile', tip: 'The website button on your Google Business Profile.' },
  { key: 'other', name: 'Something else', source: '', medium: '', tip: 'Anything else: a car show, a sponsor sign, a coupon.' },
];

const tagOf = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);

const year = () => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric' }).format(new Date());

/** The QR code for a link, with print downloads. */
export function qrBlock(url: string, fileName: string, caption?: string) {
  let qr;
  try {
    qr = encode(url, 'Q');
  } catch {
    return h('p', { class: 'text-sm text-red-300' }, 'That link is too long for a QR code.');
  }
  const svg = qrSvg(qr, 200, `QR code for ${url}`);
  return h(
    'div',
    { class: 'flex flex-wrap items-end gap-6' },
    h('div', { class: 'border border-ink-700 bg-white p-2' }, svg),
    h(
      'div',
      { class: 'flex flex-col gap-3' },
      caption ? h('p', { class: 'max-w-xs text-sm text-bone-400' }, caption) : null,
      h('button', { type: 'button', class: quiet, onclick: () => download(`${fileName}.svg`, qrSvgFile(qr, 2)) }, 'Download for printing (SVG)'),
      h(
        'button',
        {
          type: 'button',
          class: quiet,
          onclick: async () => download(`${fileName}.png`, await qrPng(qr, 1200)),
        },
        'Download a picture (PNG)',
      ),
      h('p', { class: 'max-w-xs text-xs text-bone-500' }, 'Print it at least 1 inch wide. On the van, 4 inches or more.'),
    ),
  );
}

export async function renderLinks(el: HTMLElement, _ctx: MarketingCtx, opts: GoOpts) {
  const { links } = await api<{ links: Link[]; site: string }>(`${M}/links`);
  const listEl = h('ul', { class: 'border-t border-ink-800' });

  const row = (l: Link, open = false): HTMLElement => {
    const li = h('li', { class: 'border-b border-ink-800 py-4' });
    const qrArea = h('div', { class: 'mt-4', hidden: true });
    const urlText = h('p', { class: 'mt-1 break-all font-mono text-xs text-bone-500' }, l.url);
    const showQr = h(
      'button',
      {
        type: 'button',
        class: quiet,
        onclick: () => {
          if (!qrArea.childElementCount) qrArea.append(qrBlock(l.url, `ked-${l.source}-${l.campaign}`));
          qrArea.hidden = !qrArea.hidden;
          showQr.textContent = qrArea.hidden ? 'QR code' : 'Hide QR code';
        },
      },
      'QR code',
    );
    li.append(
      h(
        'div',
        { class: 'grid gap-x-6 gap-y-2 sm:grid-cols-[1fr_auto] sm:items-start' },
        h('div', { class: 'min-w-0' }, h('p', { class: 'font-semibold text-bone-50' }, l.name), urlText),
        h(
          'p',
          { class: 'text-sm tabular-nums text-bone-200 sm:text-right' },
          `${plural(l.leads, 'person', 'people')} · ${plural(l.bookings, 'job')}`,
          l.revenue ? h('span', { class: 'block text-bone-400' }, `${dollars(l.revenue)} of finished work`) : null,
        ),
      ),
      h(
        'div',
        { class: 'mt-3 flex flex-wrap items-center gap-x-5 gap-y-2' },
        copyButton(() => l.url, 'Copy link'),
        showQr,
        confirmButton('Delete', 'Yes, delete this link', async () => {
          await api(`${M}/links/${l.id}`, { method: 'DELETE' });
          li.remove();
        }, quiet),
      ),
      qrArea,
    );
    if (open) showQr.click();
    return li;
  };
  listEl.replaceChildren(...links.map((l) => row(l)));

  /* ------------------------------------------------------------ make one */

  const presetSel = h('select', { class: input, 'aria-label': 'Where it goes' }, ...PRESETS.map((p) => h('option', { value: p.key }, p.name))) as HTMLSelectElement;
  const nameIn = h('input', { class: input, type: 'text', maxlength: 80, 'aria-label': 'Name' }) as HTMLInputElement;
  const campIn = h('input', { class: input, type: 'text', maxlength: 40, 'aria-label': 'Which batch' }) as HTMLInputElement;
  const sourceIn = h('input', { class: input, type: 'text', maxlength: 40, 'aria-label': 'Where', placeholder: 'car-show' }) as HTMLInputElement;
  const tip = h('p', { class: 'text-sm text-bone-400' });
  const preview = h('p', { class: 'break-all font-mono text-xs text-bone-500' });
  const otherRow = h('label', { class: 'flex flex-col gap-1' }, h('span', { class: small }, 'One word for where it goes'), sourceIn);

  const current = () => PRESETS.find((p) => p.key === presetSel.value)!;
  const values = () => {
    const p = current();
    const source = p.key === 'other' ? tagOf(sourceIn.value) : p.source;
    return { name: nameIn.value.trim(), channel: p.key, source, medium: p.key === 'other' ? 'other' : p.medium, campaign: tagOf(campIn.value) };
  };
  const drawPreview = () => {
    const v = values();
    preview.textContent = v.source && v.campaign ? `kedservice.com/?utm_source=${v.source}&utm_medium=${v.medium}&utm_campaign=${v.campaign}` : '';
  };
  const pick = () => {
    const p = current();
    nameIn.value = p.key === 'other' ? '' : `${p.name} ${year()}`;
    if (!campIn.value.trim()) campIn.value = year();
    otherRow.hidden = p.key !== 'other';
    tip.textContent = p.tip;
    drawPreview();
  };
  presetSel.addEventListener('change', pick);
  for (const i of [nameIn, campIn, sourceIn]) i.addEventListener('input', drawPreview);
  if (opts.preset && PRESETS.some((p) => p.key === opts.preset)) presetSel.value = opts.preset;
  pick();

  const make = button(
    'Make the link',
    async () => {
      const v = values();
      if (!v.name) throw new Error('Give it a name, like "Van magnet".');
      if (!v.source) throw new Error('Write one word for where it goes.');
      if (!v.campaign) throw new Error('Write a word for this batch, like the year.');
      const l = await api<Link>(`${M}/links`, { method: 'POST', body: v });
      listEl.prepend(row(l, true));
      empty.hidden = true;
      campIn.value = year();
      pick();
      return 'Made. Its QR code is open in the list.';
    },
    goldSmall,
  );

  const empty = h('p', { class: 'text-bone-500', hidden: links.length > 0 }, 'No links yet. Make one above for each thing you hand out or post.');

  el.replaceChildren(
    h(
      'p',
      { class: 'mb-8 max-w-2xl border-l-2 border-gold-500 pl-4 text-bone-200' },
      'Use a different link on each thing you put out. When someone visits from it and asks for a price or books, it shows up here, so you can see what is worth your money.',
    ),
    part(
      'Make a link',
      null,
      h(
        'div',
        { class: 'grid max-w-3xl gap-4 sm:grid-cols-2' },
        h('label', { class: 'flex flex-col gap-1' }, h('span', { class: small }, 'Where it goes'), presetSel),
        h('label', { class: 'flex flex-col gap-1' }, h('span', { class: small }, 'Name'), nameIn),
        otherRow,
        h(
          'label',
          { class: 'flex flex-col gap-1' },
          h('span', { class: small }, 'Which batch'),
          campIn,
          h('span', { class: 'text-xs text-bone-500' }, 'Usually the year. New door hangers next spring? Make a new link with "spring-2027" to compare.'),
        ),
        h('div', { class: 'flex flex-col gap-2 sm:col-span-2' }, tip, preview),
      ),
      h('div', { class: 'mt-5' }, make.row),
    ),
    part(
      'Your links',
      'People counts anyone who asked for a price or booked after first coming in on the link. Jobs counts everything they booked since.',
      listEl,
      empty,
    ),
    note('Tip: a QR code with your van or door hanger link works best with a reason to scan, like "Scan for $20 off your first detail."'),
  );
}
