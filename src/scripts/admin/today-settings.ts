/**
 * How follow-ups work, on the Today tab: the review link, how often each
 * package comes due, when someone counts as gone quiet, the win-back offer,
 * which rules run and which may email, and the words of every message with a
 * live preview. Saved whole to PUT /crm/follow-ups/settings, which checks it.
 */
import { h, api, input, small, checkbox, field, saveBar } from './core';
import { block, labelled, textArea, textButton } from './calendar-shared';

type Rule = 'thank_you' | 'reminder' | 'rebook' | 'winback' | 'quote_chase';
type Template = 'review' | 'thank_you' | 'reminder' | 'rebook' | 'winback' | 'quote_chase';

export interface Settings {
  reviewUrl: string;
  rules: Record<Rule, { on: boolean; email: boolean }>;
  intervals: Record<string, number>;
  regularAfter: number;
  lapsedMonths: number;
  winbackOffer: string;
  quoteChaseDays: number;
  newPerDay: { rebook: number; winback: number };
  emailsPerDay: number;
  reminderAlsoText: boolean;
  templates: Record<Template, { subject: string; body: string }>;
}

export interface SettingsResponse {
  settings: Settings;
  defaults: Settings;
  placeholders: string[];
  services: { id: string; name: string; level: string | null }[];
  fallbackReviewUrl: string;
  email: { configured: boolean };
}

const RULES: { id: Rule; name: string; what: string }[] = [
  { id: 'thank_you', name: 'Thank you', what: 'The day after a job: thanks, and the first time, a review ask.' },
  { id: 'reminder', name: 'Reminder', what: 'The day before a booking: the time, the address and their link to move it.' },
  { id: 'rebook', name: 'Due again', what: 'When their package comes due and nothing is booked.' },
  { id: 'winback', name: 'Win back', what: "When they haven't booked in a long while." },
  { id: 'quote_chase', name: 'Quote', what: "When a quote request hasn't turned into a booking." },
];

const TEMPLATES: { id: Template; name: string }[] = [
  { id: 'review', name: 'Thanks + review (first job)' },
  { id: 'thank_you', name: 'Thank you (been here before)' },
  { id: 'reminder', name: 'Reminder' },
  { id: 'rebook', name: 'Due again' },
  { id: 'winback', name: 'Win back' },
  { id: 'quote_chase', name: 'Quote' },
];

/** Same filling as the server (crm-followups.ts `fill`), for the preview. */
export function fill(template: string, values: Record<string, string>) {
  return template
    .replace(/\{([^{}]*)\}/g, (_, name: string) => values[name.trim().toLowerCase()] ?? `{${name}}`)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function settingsPanel(data: SettingsResponse, saved: () => void) {
  const s = structuredClone(data.settings);

  /* ------------------------------------------------ review link */
  const review = h('input', { type: 'url', class: input, placeholder: data.fallbackReviewUrl, maxlength: 500, 'aria-label': 'Google review link' }) as HTMLInputElement;
  review.value = s.reviewUrl;
  review.addEventListener('input', () => {
    s.reviewUrl = review.value.trim();
    preview();
  });

  /* ------------------------------------------------ rules */
  const ruleRows = RULES.map((r) => {
    const emailBox = checkbox('Email it when I can', () => s.rules[r.id].email, (v) => (s.rules[r.id].email = v));
    const emailInput = emailBox.querySelector('input')!;
    emailInput.disabled = !s.rules[r.id].on;
    const onBox = checkbox('On', () => s.rules[r.id].on, (v) => {
      s.rules[r.id].on = v;
      emailInput.disabled = !v;
    });
    return h(
      'li',
      { class: 'grid gap-2 border-b border-ink-800 py-3 sm:grid-cols-[1fr_auto_auto] sm:items-center sm:gap-6' },
      h('div', {}, h('p', { class: 'text-bone-50' }, r.name), h('p', { class: 'text-sm text-bone-400' }, r.what)),
      onBox,
      emailBox,
    );
  });

  /* ------------------------------------------------ timing */
  const known = new Set(data.services.map((x) => x.id));
  const intervalFields = [
    ...data.services.map((svc) =>
      field(`${svc.level ? `${svc.level} · ` : ''}${svc.name}`, () => s.intervals[svc.id] ?? null, (v) => {
        if (v === null) delete s.intervals[svc.id];
        else s.intervals[svc.id] = Number(v);
      }, { step: 0.5, min: 0.5, blank: 'Use "everything else"' }),
    ),
    field('Everything else', () => s.intervals.other ?? 4, (v) => (s.intervals.other = Number(v) || 4), { step: 0.5, min: 0.5 }),
  ];
  // Keep intervals for packages that were removed from the price list out of the save.
  for (const k of Object.keys(s.intervals)) if (k !== 'other' && !known.has(k)) delete s.intervals[k];

  const offer = h('input', { type: 'text', class: input, maxlength: 300, placeholder: 'e.g. $20 off if you book this month.', 'aria-label': 'Win-back offer' }) as HTMLInputElement;
  offer.value = s.winbackOffer;
  offer.addEventListener('input', () => {
    s.winbackOffer = offer.value;
    preview();
  });

  /* ------------------------------------------------ messages */
  let current: Template = 'rebook';
  const pick = h('select', { class: `${input} max-w-sm`, 'aria-label': 'Which message' }, ...TEMPLATES.map((t) => h('option', { value: t.id }, t.name))) as HTMLSelectElement;
  pick.value = current;
  const subject = h('input', { type: 'text', class: input, maxlength: 150, 'aria-label': 'Email subject' }) as HTMLInputElement;
  const body = h('textarea', { class: textArea, rows: 9, maxlength: 2000, 'aria-label': 'Message' }) as HTMLTextAreaElement;
  const previewBox = h('p', { class: 'whitespace-pre-wrap border-l-2 border-gold-500 pl-4 text-sm leading-relaxed text-bone-200' });
  const previewSubject = h('p', { class: 'mb-2 text-sm text-bone-50' });

  const sample = () => ({
    'first name': 'Sarah',
    service: 'Tune-Up',
    'last visit': 'June 12',
    since: '3 months',
    date: 'Saturday, October 4',
    time: '9 AM',
    address: '123 Main St, Kirkwood',
    'review link': s.reviewUrl || data.fallbackReviewUrl,
    'quote link': 'https://www.kedservice.com/quote/',
    'manage link': 'https://www.kedservice.com/booking/?b=…',
    offer: s.winbackOffer,
  });
  function preview() {
    const t = s.templates[current];
    previewSubject.textContent = `Subject: ${fill(t.subject, sample())}`;
    previewBox.textContent = fill(t.body, sample());
  }
  function load() {
    subject.value = s.templates[current].subject;
    body.value = s.templates[current].body;
    preview();
  }
  pick.addEventListener('change', () => {
    current = pick.value as Template;
    load();
  });
  subject.addEventListener('input', () => {
    s.templates[current].subject = subject.value;
    preview();
  });
  body.addEventListener('input', () => {
    s.templates[current].body = body.value;
    preview();
  });

  // The fill-in words, as plain links that drop the word in where the cursor is.
  const words = h(
    'p',
    { class: 'flex flex-wrap gap-x-4 gap-y-1 text-sm' },
    h('span', { class: 'text-bone-400' }, 'Fill-ins:'),
    ...data.placeholders.map((p) =>
      h('button', {
        type: 'button',
        class: textButton,
        onclick: () => {
          const at = body.selectionStart ?? body.value.length;
          body.setRangeText(`{${p}}`, at, body.selectionEnd ?? at, 'end');
          body.focus();
          s.templates[current].body = body.value;
          preview();
        },
      }, `{${p}}`),
    ),
  );
  const reset = h('button', {
    type: 'button',
    class: textButton,
    onclick: () => {
      s.templates[current] = structuredClone(data.defaults.templates[current]);
      load();
    },
  }, 'Put back the original words');
  load();

  /* ------------------------------------------------ layout */
  const n = (label: string, get: () => number, set: (v: number) => void, min = 0, step = 1) =>
    field(label, get, (v) => set(Number(v)), { min, step });

  return h(
    'div',
    {},
    block(
      'Google review link',
      h('p', { class: 'mb-3 max-w-2xl text-sm text-bone-400' }, 'Where "leave a review" goes. In your Google Business Profile, press "Ask for reviews" and paste the link here. Left blank, it uses your review page from the website.'),
      h('div', { class: 'max-w-2xl' }, review),
    ),
    block(
      'What runs every morning',
      h('p', { class: 'mb-3 max-w-2xl text-sm text-bone-400' }, "Each morning the list above fills itself. With email on, people who gave an email get it sent for them; everyone else shows up here to text. Texts are never sent for you."),
      h('ul', { class: 'border-t border-ink-800' }, ...ruleRows),
      h('div', { class: 'mt-4' }, checkbox('When a reminder emails, still put a text on my list', () => s.reminderAlsoText, (v) => (s.reminderAlsoText = v))),
    ),
    block(
      'How often each package comes due (months)',
      h('p', { class: 'mb-3 max-w-2xl text-sm text-bone-400' }, "After this long with nothing booked, they show up as due again. Regulars go by their own habit instead."),
      h('div', { class: 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3' }, ...intervalFields),
      h('div', { class: 'mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3' },
        n('Regular after this many visits', () => s.regularAfter, (v) => (s.regularAfter = v), 2),
        n('Gone quiet after (months)', () => s.lapsedMonths, (v) => (s.lapsedMonths = v), 1),
        n('Chase a quote after (days)', () => s.quoteChaseDays, (v) => (s.quoteChaseDays = v), 1),
      ),
    ),
    block(
      'How many at once',
      h('p', { class: 'mb-3 max-w-2xl text-sm text-bone-400' }, 'So a busy day never buries you. Best customers come first; the rest wait for tomorrow.'),
      h('div', { class: 'grid gap-4 sm:grid-cols-3' },
        n('New "due again" a day', () => s.newPerDay.rebook, (v) => (s.newPerDay.rebook = v)),
        n('New "win back" a day', () => s.newPerDay.winback, (v) => (s.newPerDay.winback = v)),
        n('Emails a day (100 at most)', () => s.emailsPerDay, (v) => (s.emailsPerDay = v)),
      ),
    ),
    block(
      'Win-back offer',
      h('p', { class: 'mb-3 max-w-2xl text-sm text-bone-400' }, 'Optional. Goes in the win-back message where it says {offer}.'),
      h('div', { class: 'max-w-2xl' }, offer),
    ),
    block(
      'The words',
      h('div', { class: 'grid gap-x-10 gap-y-6 lg:grid-cols-2' },
        h('div', { class: 'flex flex-col gap-3' },
          labelled('Message', pick),
          labelled('Email subject', subject),
          labelled('Words', body),
          words,
          h('div', {}, reset),
        ),
        h('div', {}, h('p', { class: `${small} mb-3` }, 'What Sarah would get'), previewSubject, previewBox),
      ),
    ),
    saveBar('Save follow-up settings', async () => {
      const r = await api<{ settings: Settings }>('/crm/follow-ups/settings', { method: 'PUT', body: s });
      data.settings = r.settings;
      saved();
      return 'Saved. Tomorrow morning uses these.';
    }),
  );
}
