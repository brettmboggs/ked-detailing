/**
 * Marketing → Campaigns: one message to a group of customers. Email goes out
 * from the API a batch at a time (the free email plan sends 100 a day); a
 * text campaign is a list Jacob works through, each text written for him.
 */
import { type Child, h, api, input, small, ghost, dollars, clearError, showError } from './core';
import { textArea } from './calendar-shared';
import {
  type Campaign,
  type GoOpts,
  type MarketingCtx,
  type Segment,
  type Template,
  M,
  SOURCE_NAMES,
  button,
  confirmButton,
  copyButton,
  firstName,
  goldSmall,
  isPhone,
  label,
  part,
  plural,
  quiet,
  shortDate,
  smsHref,
} from './marketing-shared';

interface Preview {
  count: number;
  canEmail: number;
  canText: number;
  people: { id: string; name: string; canEmail: boolean; canText: boolean; visits: number; spend: number; lastVisit: string | null }[];
  sample: { id: string; name: string; subject: string | null; body: string } | null;
  unknown: string[];
}

interface Person {
  customerId: string;
  name: string;
  phone: string | null;
  email: string | null;
  status: 'queued' | 'sent' | 'failed' | 'skipped';
  reason: string | null;
  sentAt: string | null;
  message: string | null;
}

interface SendResult {
  campaign: Campaign;
  batch: { sent: number; failed: number; skipped: number; dailyLimit: boolean; emailsLeftToday: number } | null;
}

const REASON: Record<string, string> = {
  no_email: 'No email on file',
  unsubscribed: 'Unsubscribed',
  no_phone: 'No phone number',
  no_texts: "Doesn't want texts",
  failed: "Didn't go through",
};

const PLACEHOLDERS: [string, string][] = [
  ['{first}', 'First name'],
  ['{last service}', 'Last package'],
  ['{quote link}', 'Booking link'],
  ['{referral link}', 'Their referral link'],
  ['{friend gets}', 'What a friend gets'],
  ['{you get}', 'What they get'],
];

let services: { id: string; name: string }[] | null = null;
async function loadServices() {
  if (!services) {
    const { config } = await api<{ config: { services: { id: string; name: string }[] } }>('/pricing');
    services = config.services.map((s) => ({ id: s.id, name: s.name }));
  }
  return services;
}

export async function renderCampaigns(el: HTMLElement, ctx: MarketingCtx, opts: GoOpts) {
  if (opts.campaignId) return openCampaign(el, ctx, opts.campaignId, false);
  return drawList(el, ctx);
}

/* ------------------------------------------------------------ list */

const month = () => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'numeric' }).format(new Date()));

function statusWord(c: Campaign) {
  if (c.status === 'draft') return 'Draft';
  if (c.channel === 'text') return c.status === 'sent' ? 'All texted' : 'Texting';
  return c.status === 'sent' ? 'Sent' : 'Sending';
}

function statsLine(c: Campaign) {
  const s = c.stats;
  if (c.status === 'draft') return 'Not sent yet';
  const parts =
    c.channel === 'text'
      ? [`${s.sent} of ${s.total - s.skipped} texted`]
      : [`${plural(s.sent, 'email')} sent`, s.queued ? `${s.queued} waiting` : '', s.failed ? `${s.failed} didn't go` : '', s.skipped ? `${s.skipped} skipped` : ''];
  parts.push(s.bookings ? `${plural(s.bookings, 'booking')} (${dollars(s.bookedValue)})` : 'no bookings yet');
  return parts.filter(Boolean).join(' · ');
}

async function drawList(el: HTMLElement, ctx: MarketingCtx) {
  const [{ campaigns, emailReady }, { templates }] = await Promise.all([
    api<{ campaigns: Campaign[]; emailReady: boolean }>(M),
    api<{ templates: Template[] }>(`${M}/templates`),
  ]);
  const now = month();
  const inSeason = (t: Template) => t.months.includes(now);
  const sorted = [...templates].sort((a, b) => Number(inSeason(b)) - Number(inSeason(a)));

  const start = async (body: object) => {
    const c = await api<Campaign>(M, { method: 'POST', body });
    ctx.go('campaigns', { campaignId: c.id });
  };

  const templateRow = (t: Template) =>
    h(
      'li',
      { class: 'grid gap-x-6 gap-y-2 border-b border-ink-800 py-4 sm:grid-cols-[1fr_auto] sm:items-center' },
      h(
        'div',
        {},
        h(
          'p',
          { class: 'flex flex-wrap items-baseline gap-x-3' },
          h('span', { class: 'font-semibold text-bone-50' }, t.name),
          h('span', { class: 'text-xs uppercase tracking-[0.14em] text-bone-500' }, t.channel === 'email' ? 'Email' : 'Text list'),
          inSeason(t) ? h('span', { class: 'text-xs uppercase tracking-[0.14em] text-gold-400' }, 'Good time for it now') : null,
        ),
        h('p', { class: 'mt-0.5 max-w-2xl text-sm text-bone-400' }, t.why),
      ),
      button('Use this', () => start({ template: t.id })).row,
    );

  const campaignRow = (c: Campaign) =>
    h(
      'li',
      {},
      h(
        'button',
        {
          type: 'button',
          class: 'grid w-full gap-x-6 gap-y-0.5 border-b border-ink-800 px-1 py-3 text-left transition-colors hover:bg-ink-900 sm:grid-cols-[1fr_9rem_7rem]',
          onclick: () => ctx.go('campaigns', { campaignId: c.id }),
        },
        h('span', { class: 'font-semibold text-bone-50' }, c.name),
        h('span', { class: 'text-sm text-bone-200' }, c.channel === 'email' ? 'Email' : 'Text list'),
        h('span', { class: `text-sm ${c.status === 'draft' ? 'text-bone-500' : c.status === 'sent' ? 'text-bone-200' : 'text-gold-400'}` }, statusWord(c)),
        h('span', { class: 'text-sm text-bone-400 sm:col-span-3' }, `${c.sentAt ? `${shortDate(c.sentAt)} · ` : ''}${statsLine(c)}`),
      ),
    );

  el.replaceChildren(
    h(
      'p',
      { class: 'mb-8 max-w-2xl border-l-2 border-gold-500 pl-4 text-bone-200' },
      'Send one message to a group of customers. Email goes out from here. A text list opens Messages on your phone with each text already written, and you press send.',
    ),
    emailReady ? '' : h('p', { class: 'mb-8 max-w-2xl text-sm text-bone-400' }, "Email isn't turned on yet, so for now use text lists. Brett can switch email on."),
    part(
      'Your campaigns',
      campaigns.length ? 'Bookings count when someone on the list books within 30 days of getting it.' : null,
      campaigns.length ? h('ul', { class: 'border-t border-ink-800' }, ...campaigns.map(campaignRow)) : h('p', { class: 'text-bone-500' }, 'Nothing sent yet. Start one below.'),
    ),
    part(
      'Start a new one',
      'Pick a ready-made message and change anything you want before it goes out.',
      h('ul', { class: 'border-t border-ink-800' }, ...sorted.map(templateRow)),
      h(
        'div',
        { class: 'mt-5' },
        button('Start from scratch', () => start({ name: 'New campaign', segment: { lifecycle: 'customer' }, channel: emailReady ? 'email' : 'text', subject: '', body: 'Hey {first}, ' }), goldSmall).row,
      ),
    ),
  );
}

/* ------------------------------------------------------------ one campaign */

async function openCampaign(el: HTMLElement, ctx: MarketingCtx, id: string, autoSend: boolean) {
  const [camp, svc] = await Promise.all([api<Campaign>(`${M}/${id}`), loadServices()]);
  if (camp.status === 'draft') {
    const templates = camp.template ? (await api<{ templates: Template[] }>(`${M}/templates`)).templates : [];
    return drawCompose(el, ctx, camp, svc, templates.find((t) => t.id === camp.template) ?? null);
  }
  return drawSent(el, ctx, camp, autoSend);
}

const back = (ctx: MarketingCtx) => h('button', { type: 'button', class: `${quiet} mb-6`, onclick: () => ctx.go('campaigns') }, '‹ All campaigns');

const labelled = (text: string, control: HTMLElement, hint?: string, cls = '') =>
  h('label', { class: `flex flex-col gap-1 ${cls}` }, h('span', { class: small }, text), control, hint ? h('span', { class: 'text-xs text-bone-500' }, hint) : null);

function select(options: [string, string][], value: string, onChange: (v: string) => void, aria: string) {
  const el = h('select', { class: input, 'aria-label': aria }, ...options.map(([v, t]) => h('option', { value: v }, t))) as HTMLSelectElement;
  el.value = options.some(([v]) => v === value) ? value : options[0]![0];
  el.addEventListener('change', () => onChange(el.value));
  return el;
}

/** Two or more square choices side by side. */
function choice<T extends string>(options: [T, string][], get: () => T, set: (v: T) => void, aria: string) {
  const wrap = h('div', { role: 'radiogroup', 'aria-label': aria, class: 'flex w-fit border-l border-t border-ink-700' });
  const draw = () =>
    wrap.replaceChildren(
      ...options.map(([v, t]) =>
        h(
          'button',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(get() === v),
            class:
              'border-b border-r border-ink-700 px-4 py-2 text-sm transition-colors ' +
              (get() === v ? 'bg-ink-900 text-bone-50 shadow-[inset_0_-2px_0_var(--color-gold-500)]' : 'text-bone-400 hover:text-bone-50'),
            onclick: () => {
              set(v);
              draw();
            },
          },
          t,
        ),
      ),
    );
  draw();
  return wrap;
}

/** The "who gets it" controls. Changes the segment in place and calls `changed`. */
function segmentPicker(seg: Segment, svc: { id: string; name: string }[], changed: () => void) {
  const lapsedRow = h('div', {});
  const drawLapsed = () =>
    lapsedRow.replaceChildren(
      seg.lifecycle === 'lapsed'
        ? labelled(
            'Last visit more than',
            select(
              [
                ['90', '3 months ago'],
                ['180', '6 months ago'],
                ['270', '9 months ago'],
                ['365', 'a year ago'],
              ],
              String(seg.lapsedDays ?? 180),
              (v) => {
                seg.lapsedDays = Number(v);
                changed();
              },
              'Last visit more than',
            ),
          )
        : '',
    );
  drawLapsed();

  const zips = h('input', { class: input, type: 'text', inputmode: 'numeric', placeholder: 'Any', 'aria-label': 'ZIP codes' }) as HTMLInputElement;
  zips.value = (seg.zips ?? []).join(', ');
  zips.addEventListener('input', () => {
    const list = zips.value.split(/[\s,]+/).map((z) => z.replace(/\D/g, '')).filter((z) => z.length >= 3);
    seg.zips = list.length ? list : undefined;
    changed();
  });

  const spend = h('input', { class: input, type: 'number', min: '0', step: '1', inputmode: 'decimal', placeholder: 'Any', 'aria-label': 'Spent at least' }) as HTMLInputElement;
  spend.value = seg.minSpend ? String(seg.minSpend / 100) : '';
  spend.addEventListener('input', () => {
    const n = Number(spend.value);
    seg.minSpend = spend.value.trim() && Number.isFinite(n) && n > 0 ? Math.round(n * 100) : undefined;
    changed();
  });

  const booked = h('input', { type: 'checkbox', class: 'size-4 accent-[#e8b14c]' }) as HTMLInputElement;
  booked.checked = !!seg.noUpcoming;
  booked.addEventListener('change', () => {
    seg.noUpcoming = booked.checked || undefined;
    changed();
  });

  return h(
    'div',
    { class: 'grid gap-4 sm:grid-cols-2' },
    labelled(
      'Who',
      select(
        [
          ['customer', "Everyone who's had a job"],
          ['repeat', 'Repeat customers (2 or more jobs)'],
          ['lapsed', "Customers who haven't been back"],
          ['lead', 'Asked for a price but never booked'],
          ['any', 'Everyone, customers and price requests'],
        ],
        seg.lifecycle ?? 'any',
        (v) => {
          seg.lifecycle = v as Segment['lifecycle'];
          if (v !== 'lapsed') delete seg.lapsedDays;
          drawLapsed();
          changed();
        },
        'Who',
      ),
    ),
    lapsedRow,
    labelled(
      'Had this done',
      select(
        [['', 'Any package'], ...svc.map((s) => [s.id, s.name] as [string, string])],
        seg.services?.[0] ?? '',
        (v) => {
          seg.services = v ? [v] : undefined;
          changed();
        },
        'Had this done',
      ),
    ),
    labelled(
      'Found you through',
      select(
        [['', 'Anywhere'], ...Object.entries(SOURCE_NAMES)],
        seg.sources?.[0] ?? '',
        (v) => {
          seg.sources = v ? [v] : undefined;
          changed();
        },
        'Found you through',
      ),
    ),
    labelled('ZIP codes', zips, 'Like 63049, 63051. Or 630 for every ZIP starting with 630.'),
    labelled('Spent at least ($)', spend),
    labelled(
      'How many',
      select(
        [
          ['', 'Everyone who matches'],
          ['10', 'Top 10 by money spent'],
          ['25', 'Top 25 by money spent'],
          ['50', 'Top 50 by money spent'],
          ['100', 'Top 100 by money spent'],
        ],
        seg.limit ? String(seg.limit) : '',
        (v) => {
          if (v) {
            seg.limit = Number(v);
            seg.sort = 'spend';
          } else {
            delete seg.limit;
            delete seg.sort;
          }
          changed();
        },
        'How many',
      ),
    ),
    h('label', { class: 'flex items-center gap-2 self-end pb-2 text-sm text-bone-200' }, booked, 'Skip people who already have a job booked'),
  );
}

function drawCompose(el: HTMLElement, ctx: MarketingCtx, camp: Campaign, svc: { id: string; name: string }[], template: Template | null) {
  const w = { name: camp.name, channel: camp.channel, subject: camp.subject ?? '', body: camp.body, segment: structuredClone(camp.segment) };
  let preview: Preview | null = null;
  let sampleId: string | null = null;
  let dirty = false;

  const name = h('input', { class: input, type: 'text', maxlength: 80, 'aria-label': 'Name' }) as HTMLInputElement;
  name.value = w.name;
  name.addEventListener('input', () => {
    w.name = name.value;
    touch();
  });

  const subject = h('input', { class: input, type: 'text', maxlength: 150, 'aria-label': 'Subject' }) as HTMLInputElement;
  subject.value = w.subject;
  subject.addEventListener('input', () => {
    w.subject = subject.value;
    touch();
  });
  const subjectRow = labelled('Subject line', subject, 'What people see in their inbox before they open it.');

  const body = h('textarea', { class: `${textArea} min-h-48`, maxlength: 5000, 'aria-label': 'Message' }) as HTMLTextAreaElement;
  body.value = w.body;
  const length = h('p', { class: 'text-xs text-bone-500' });
  const drawLength = () =>
    (length.textContent =
      w.channel === 'text'
        ? `${w.body.length} letters before names and links are filled in. Keep texts short: a few lines reads best on a phone.`
        : '');
  body.addEventListener('input', () => {
    w.body = body.value;
    drawLength();
    touch();
  });

  const insert = (token: string) => {
    const at = body.selectionStart ?? body.value.length;
    body.setRangeText(token, at, body.selectionEnd ?? at, 'end');
    body.focus();
    w.body = body.value;
    drawLength();
    touch();
  };
  const tokens = h(
    'div',
    { class: 'flex flex-wrap items-center gap-x-4 gap-y-2' },
    h('span', { class: small }, 'Add'),
    ...PLACEHOLDERS.map(([t, what]) => h('button', { type: 'button', class: quiet, title: `Adds ${t}`, onclick: () => insert(t) }, what)),
  );

  const count = h('p', { class: 'text-sm text-bone-200', role: 'status', 'aria-live': 'polite' }, 'Counting…');
  const sampleBox = h('div', {});
  const warn = h('div', {});
  const who = h('div', {});
  const sendArea = h('div', { class: 'flex flex-wrap items-center gap-4' });
  const saveStatus = h('span', { class: 'text-sm text-bone-400', role: 'status' });

  const reachable = () => (preview ? (w.channel === 'email' ? preview.canEmail : preview.canText) : 0);

  const drawPreview = () => {
    if (!preview) return;
    const n = reachable();
    count.replaceChildren(
      h('span', { class: 'font-semibold text-bone-50' }, plural(preview.count, 'person', 'people')),
      ` match. ${plural(preview.canEmail, 'has', 'have')} an email you can use, ${preview.canText} can get texts.`,
      preview.count && !n ? h('span', { class: 'block text-gold-400' }, w.channel === 'email' ? 'Nobody here can get email. Try a text list.' : 'Nobody here can get texts.') : '',
    );

    const s = preview.sample;
    const others = preview.people.filter((p) => (w.channel === 'email' ? p.canEmail : p.canText));
    sampleBox.replaceChildren(
      s
        ? h(
            'div',
            {},
            h(
              'div',
              { class: 'mb-2 flex flex-wrap items-baseline justify-between gap-3' },
              h('p', { class: small }, `How it reads for ${s.name}`),
              others.length > 1
                ? h(
                    'button',
                    {
                      type: 'button',
                      class: quiet,
                      onclick: () => {
                        const i = others.findIndex((p) => p.id === s.id);
                        sampleId = others[(i + 1) % others.length]!.id;
                        void refresh();
                      },
                    },
                    'Someone else',
                  )
                : null,
            ),
            h(
              'div',
              { class: 'border border-ink-700 bg-ink-900 p-4' },
              s.subject !== null ? h('p', { class: 'mb-3 border-b border-ink-800 pb-3 font-semibold text-bone-50' }, s.subject || '(no subject yet)') : null,
              h('p', { class: 'whitespace-pre-wrap break-words text-bone-200' }, s.body),
              w.channel === 'email' ? h('p', { class: 'mt-4 border-t border-ink-800 pt-3 text-xs text-bone-500' }, "Every email ends with your business name and a link to stop getting them. That's the law, and it's added for you.") : null,
            ),
          )
        : h('p', { class: 'text-bone-500' }, 'Nobody matches yet, so there is nothing to show.'),
    );

    warn.replaceChildren(
      preview.unknown.length
        ? h('p', { class: 'border-l-2 border-red-400 pl-3 text-sm text-red-300' }, `These won't be filled in: ${preview.unknown.map((u) => `{${u}}`).join(', ')}. Check the spelling, or use the Add buttons.`)
        : '',
    );

    who.replaceChildren(
      preview.count
        ? h(
            'details',
            { class: 'border-t border-ink-800 pt-3' },
            h('summary', { class: `${quiet} cursor-pointer` }, `See who's on it${preview.count > 100 ? ' (first 100)' : ''}`),
            h(
              'ul',
              { class: 'mt-3 columns-1 gap-8 text-sm sm:columns-2' },
              ...preview.people.map((p) => {
                const ok = w.channel === 'email' ? p.canEmail : p.canText;
                return h('li', { class: `break-inside-avoid py-0.5 ${ok ? 'text-bone-200' : 'text-bone-500'}` }, p.name, ok ? '' : w.channel === 'email' ? ' (no email)' : ' (no texts)');
              }),
            ),
          )
        : '',
    );
    drawSend();
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  let seq = 0;
  async function refresh() {
    const mine = ++seq;
    try {
      const p = await api<Preview>(`${M}/preview`, { method: 'POST', body: { ...w, sampleId } });
      if (mine !== seq) return;
      preview = p;
      drawPreview();
    } catch (err) {
      if (mine === seq) count.textContent = (err as Error).message;
    }
  }
  function touch() {
    dirty = true;
    saveStatus.textContent = '';
    clearTimeout(timer);
    timer = setTimeout(() => void refresh(), 350);
  }

  const save = async () => {
    await api<Campaign>(`${M}/${camp.id}`, { method: 'PATCH', body: { name: w.name, channel: w.channel, subject: w.channel === 'email' ? w.subject : w.subject || null, body: w.body, segment: w.segment } });
    dirty = false;
  };

  function drawSend() {
    const n = reachable();
    const problems = [
      !w.name.trim() && 'Give it a name.',
      w.channel === 'email' && !w.subject.trim() && 'Write a subject line.',
      !w.body.trim() && 'Write the message.',
      !n && 'Nobody on the list can get it yet.',
    ].filter(Boolean) as string[];
    const go = async () => {
      await save();
      const res = await api<SendResult>(`${M}/${camp.id}/send`, { method: 'POST' });
      drawSent(el, ctx, res.campaign, true, res);
    };
    sendArea.replaceChildren(
      problems.length
        ? h('p', { class: 'text-sm text-bone-400' }, problems.join(' '))
        : w.channel === 'email'
          ? confirmButton(`Send to ${plural(n, 'person', 'people')}`, `Yes, email ${plural(n, 'person', 'people')} now`, go, goldSmall)
          : button(`Make my text list (${plural(n, 'person', 'people')})`, go, goldSmall).btn,
    );
  }

  const channel = choice<'email' | 'text'>(
    [
      ['email', 'Email'],
      ['text', 'Text list'],
    ],
    () => w.channel,
    (v) => {
      if (template && w.body.trim() === (w.channel === 'email' ? template.email : template.text).trim()) {
        w.body = v === 'email' ? template.email : template.text;
        body.value = w.body;
      }
      if (template && v === 'email' && !w.subject.trim()) subject.value = w.subject = template.subject;
      w.channel = v;
      subjectRow.hidden = v !== 'email';
      drawLength();
      touch();
    },
    'Send by',
  );
  subjectRow.hidden = w.channel !== 'email';
  drawLength();

  el.replaceChildren(
    back(ctx),
    h('div', { class: 'grid gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]' },
      h(
        'div',
        { class: 'flex flex-col gap-6' },
        labelled('Name (only you see this)', name),
        h('div', { class: 'flex flex-col gap-1' }, h('span', { class: small }, 'Send by'), channel, h('span', { class: 'text-xs text-bone-500' }, 'Email goes out from here. A text list lets you send each one from your phone.')),
        h('div', { class: 'border-t border-ink-800 pt-6' }, label('Who gets it', 'mb-4'), segmentPicker(w.segment, svc, touch), h('div', { class: 'mt-5' }, count)),
        h('div', { class: 'flex flex-col gap-4 border-t border-ink-800 pt-6' }, subjectRow, labelled('Message', body), length, tokens, warn),
      ),
      h('div', { class: 'flex flex-col gap-6 lg:sticky lg:top-24 lg:self-start' }, sampleBox, who),
    ),
    h(
      'div',
      { class: 'sticky bottom-0 mt-10 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-ink-800 bg-ink-950/95 py-4 backdrop-blur' },
      sendArea,
      button('Save for later', async () => {
        await save();
        return 'Saved.';
      }).row,
      saveStatus,
      h(
        'span',
        { class: 'ml-auto' },
        confirmButton('Delete', 'Yes, delete it', async () => {
          await api(`${M}/${camp.id}`, { method: 'DELETE' });
          ctx.go('campaigns');
        }, quiet),
      ),
    ),
  );
  void refresh();
  // Leaving with unsaved changes keeps them: save quietly when the page hides.
  const flush = () => {
    if (dirty && el.isConnected) void save().catch(() => undefined);
  };
  document.addEventListener('visibilitychange', flush, { once: true });
}

/* ------------------------------------------------------------ after sending */

function statRow(name: string, value: Child, hint?: string) {
  return h(
    'div',
    { class: 'flex items-baseline justify-between gap-6 border-b border-ink-800 py-3' },
    h('dt', { class: 'text-sm text-bone-400' }, name, hint ? h('span', { class: 'block text-xs text-bone-500' }, hint) : null),
    h('dd', { class: 'text-right tabular-nums text-bone-50' }, value),
  );
}

async function drawSent(el: HTMLElement, ctx: MarketingCtx, first: Campaign, autoSend: boolean, firstResult?: SendResult) {
  let camp = first;
  const top = h('div', {});
  const progress = h('div', {});
  const list = h('div', {});
  let sending = false;
  let lastBatch = firstResult?.batch ?? null;

  const copyIt = button(
    'Copy into a new one',
    async () => {
      const c = await api<Campaign>(M, {
        method: 'POST',
        body: { name: `${camp.name} (again)`, segment: camp.segment, channel: camp.channel, subject: camp.subject ?? '', body: camp.body },
      });
      ctx.go('campaigns', { campaignId: c.id });
    },
    quiet,
  ).btn;

  const drawTop = () => {
    const s = camp.stats;
    top.replaceChildren(
      h(
        'div',
        { class: 'flex flex-wrap items-end justify-between gap-4' },
        h(
          'div',
          {},
          h('h3', { class: 'font-display text-2xl uppercase text-bone-50', style: "font-variation-settings:'wdth' 80,'wght' 750" }, camp.name),
          h('p', { class: 'mt-1 text-sm text-bone-400' }, `${camp.channel === 'email' ? 'Email' : 'Text list'} · started ${camp.sentAt ? shortDate(camp.sentAt) : ''} · ${statusWord(camp)}`),
        ),
        copyIt,
      ),
      h(
        'dl',
        { class: 'mt-6 max-w-xl' },
        ...(camp.channel === 'email'
          ? [
              statRow('Sent', String(s.sent)),
              s.queued ? statRow('Waiting to go', String(s.queued)) : null,
              s.failed ? statRow("Didn't go through", String(s.failed)) : null,
              statRow('Skipped', String(s.skipped), 'No email on file, or they unsubscribed'),
            ]
          : [statRow('Texted', `${s.sent} of ${s.total - s.skipped}`), statRow('Skipped', String(s.skipped), 'No phone number, or they asked not to get texts')]),
        statRow('Booked', s.bookings ? `${s.bookings} · ${dollars(s.bookedValue)}` : '0', 'Jobs booked by people on the list within 30 days of getting it'),
      ),
    );
  };

  const drawEmailProgress = () => {
    const s = camp.stats;
    const goal = s.total - s.skipped;
    const pct = goal ? Math.round(((s.sent + s.failed) / goal) * 100) : 100;
    const bar = h('div', { class: 'h-1 w-full bg-ink-800' }, h('div', { class: 'h-1 bg-gold-500 transition-[width]', style: `width:${pct}%` }));
    const line = sending
      ? `Sending… ${s.sent} of ${goal} sent. Keep this page open.`
      : lastBatch?.dailyLimit
        ? `${s.queued} still to go. The free email plan sends about 100 a day, so the rest go tomorrow. Come back and press Send the rest.`
        : s.queued
          ? `${s.queued} still to go.`
          : `Done. ${s.sent} sent.`;
    progress.replaceChildren(
      h(
        'div',
        { class: 'mt-8 max-w-xl' },
        bar,
        h('p', { class: 'mt-3 text-sm text-bone-200', role: 'status' }, line),
        h(
          'div',
          { class: 'mt-4 flex flex-wrap gap-4' },
          s.queued && !sending ? button('Send the rest', () => loop(), goldSmall).btn : null,
          s.failed && !sending
            ? button('Try the ones that failed again', async () => {
                camp = await api<Campaign>(`${M}/${camp.id}/retry`, { method: 'POST' });
                await loop();
              }).btn
            : null,
        ),
      ),
    );
  };

  /** Sends batch after batch while this page is open and there's room today. */
  async function loop() {
    sending = true;
    drawEmailProgress();
    try {
      while (el.isConnected && camp.stats.queued > 0) {
        const res = await api<SendResult>(`${M}/${camp.id}/send`, { method: 'POST' });
        camp = res.campaign;
        lastBatch = res.batch;
        drawTop();
        drawEmailProgress();
        if (!res.batch || res.batch.dailyLimit || res.batch.sent + res.batch.failed + res.batch.skipped === 0) break;
      }
    } catch (err) {
      showError(err);
    } finally {
      sending = false;
      if (el.isConnected) {
        drawEmailProgress();
        await drawPeople();
      }
    }
  }

  async function drawPeople() {
    const { people } = await api<{ people: Person[] }>(`${M}/${camp.id}/people`);
    if (camp.channel === 'text') return drawTextList(people);
    list.replaceChildren(
      h(
        'details',
        { class: 'mt-10 border-t border-ink-800 pt-4' },
        h('summary', { class: `${quiet} cursor-pointer` }, `Everyone on it (${people.length})`),
        h(
          'ul',
          { class: 'mt-3 text-sm' },
          ...people.map((p) =>
            h(
              'li',
              { class: 'flex flex-wrap justify-between gap-x-6 border-b border-ink-800 py-2' },
              h('span', { class: 'text-bone-200' }, p.name),
              h(
                'span',
                { class: p.status === 'sent' ? 'text-bone-400' : p.status === 'failed' ? 'text-red-300' : 'text-bone-500' },
                p.status === 'sent' ? `Sent ${p.sentAt ? shortDate(p.sentAt) : ''}` : p.status === 'queued' ? 'Waiting' : (REASON[p.reason ?? p.status] ?? p.status),
              ),
            ),
          ),
        ),
      ),
    );
  }

  function drawTextList(people: Person[]) {
    const phone = isPhone();
    const row = (p: Person): HTMLElement => {
      const li = h('li', { class: 'grid gap-x-6 gap-y-2 border-b border-ink-800 py-4 sm:grid-cols-[12rem_1fr_auto] sm:items-start' });
      const mark = async (texted: boolean) => {
        clearError();
        try {
          camp = await api<Campaign>(`${M}/${camp.id}/texted`, { method: 'POST', body: { customerId: p.customerId, texted, message: p.message } });
          p.status = texted ? 'sent' : 'queued';
          p.sentAt = texted ? new Date().toISOString() : null;
          li.replaceWith(row(p));
          drawTop();
        } catch (err) {
          showError(err);
        }
      };
      const who = h('div', {}, h('p', { class: `font-semibold ${p.status === 'sent' ? 'text-bone-400' : 'text-bone-50'}` }, p.name), h('p', { class: 'text-sm tabular-nums text-bone-400' }, p.phone ?? ''));
      const msg = h('p', { class: `whitespace-pre-wrap break-words text-sm ${p.status === 'queued' ? 'text-bone-200' : 'text-bone-500'}` }, p.status === 'skipped' ? REASON[p.reason ?? ''] ?? 'Skipped' : (p.message ?? ''));
      let actions: Child;
      if (p.status === 'sent') {
        actions = h('div', { class: 'flex items-center gap-4 text-sm' }, h('span', { class: 'text-bone-400' }, `Texted ${p.sentAt ? shortDate(p.sentAt) : ''}`), h('button', { type: 'button', class: quiet, onclick: () => void mark(false) }, 'Undo'));
      } else if (p.status === 'queued' && p.phone) {
        actions = phone
          ? h('a', { href: smsHref(p.phone, p.message ?? ''), class: goldSmall, onclick: () => void mark(true) }, `Text ${firstName(p.name)}`)
          : h('div', { class: 'flex flex-wrap items-center gap-4' }, copyButton(() => p.message ?? '', 'Copy text'), h('button', { type: 'button', class: ghost, onclick: () => void mark(true) }, 'Mark texted'));
      } else actions = '';
      li.append(who, msg, actions);
      return li;
    };
    list.replaceChildren(
      part(
        'Your text list',
        phone
          ? 'Tap Text. Messages opens with the text written for you. Send it, come back here, and do the next one.'
          : "On your phone this opens Messages with the text written. Here on the computer, copy each text and mark it once you've sent it.",
        h('ul', { class: 'border-t border-ink-800' }, ...people.map(row)),
      ),
    );
  }

  drawTop();
  el.replaceChildren(back(ctx), top, progress, list);
  if (camp.channel === 'email') {
    drawEmailProgress();
    if (autoSend && camp.stats.queued > 0 && !lastBatch?.dailyLimit) await loop();
    else await drawPeople();
  } else {
    await drawPeople();
  }
}
