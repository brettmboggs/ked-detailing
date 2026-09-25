/**
 * The Website tab: Jacob changes the site's words and photos himself.
 *
 * The page starts from the built-in content (src/lib/site-content.ts) with his
 * saved changes on top. Saving sends only what differs from the built-in
 * content, so anything he never touched keeps following the code. The API
 * checks it all again (api/src/site.ts) and rebuilds the site.
 */
import { PACKAGE_IDS, original, type FullDoc, type PackageId, type SiteDoc } from '../../lib/site-content';
import { Failed, h, $, when, api, sectionHead, saveBar } from './core';
import { changed, fields, group, linesField, listEditor, resetWatchers, same, textField } from './website-fields';
import { photoField } from './website-photos';

type Full = FullDoc;

const LEVELS: Record<PackageId, string> = { 'level-1': 'Level I', 'level-2': 'Level II', 'level-3': 'Level III', 'level-4': 'Level IV' };

/** The built-in content with his saved changes laid on top. */
function withSaved(saved: SiteDoc): Full {
  const w = structuredClone(original);
  Object.assign(w.hero, saved.hero);
  if (saved.intro) w.intro = saved.intro;
  Object.assign(w.area, saved.area);
  Object.assign(w.contact, saved.contact);
  Object.assign(w.reviews, saved.reviews);
  for (const id of PACKAGE_IDS) Object.assign(w.packages[id], saved.packages?.[id]);
  if (saved.also) w.also = saved.also;
  if (saved.faqs) w.faqs = saved.faqs;
  if (saved.marquee) w.marquee = saved.marquee;
  if (saved.recent) w.recent = saved.recent;
  return w;
}

/** Only what differs from the built-in content, trimmed. */
function changes(w: Full): SiteDoc {
  const tidy = <T>(v: T): T => (typeof v === 'string' ? (v.trim() as T) : v);
  const sub = <T extends object>(now: T, was: T): Partial<T> | undefined => {
    const out: Partial<T> = {};
    for (const k of Object.keys(now) as (keyof T)[]) if (!same(tidy(now[k]), was[k])) out[k] = tidy(now[k]);
    return Object.keys(out).length ? out : undefined;
  };
  const doc: SiteDoc = {
    hero: sub(w.hero, original.hero),
    intro: w.intro.trim() !== original.intro ? w.intro.trim() : undefined,
    area: sub(w.area, original.area),
    contact: sub(w.contact, original.contact),
    reviews: sub(w.reviews, original.reviews),
    also: same(w.also, original.also) ? undefined : w.also,
    faqs: same(w.faqs, original.faqs) ? undefined : w.faqs,
    marquee: same(w.marquee, original.marquee) ? undefined : w.marquee,
    recent: same(w.recent, original.recent) ? undefined : w.recent,
  };
  const packages: SiteDoc['packages'] = {};
  for (const id of PACKAGE_IDS) {
    const p = sub(w.packages[id], original.packages[id]);
    if (p) packages[id] = p;
  }
  if (Object.keys(packages).length) doc.packages = packages;
  return JSON.parse(JSON.stringify(doc)) as SiteDoc; // drops the undefineds
}

const hint = (text: string) => h('p', { class: 'mb-4 max-w-2xl text-sm text-bone-400' }, text);

export async function renderWebsite() {
  const view = $('[data-view="website"]');
  const saved = await api<{ content: SiteDoc; updatedAt: string | null }>('/site');
  const w = withSaved(saved.content ?? {});
  let updatedAt = saved.updatedAt;
  resetWatchers();

  const savedLine = h('p', { class: 'mt-6 text-xs text-bone-500' });
  const drawSavedLine = () =>
    (savedLine.textContent = updatedAt
      ? `Last saved ${when(updatedAt, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}.`
      : 'Nothing changed yet. The website shows its original words and photos.');
  drawSavedLine();

  const packages = PACKAGE_IDS.map((id) => {
    const p = w.packages[id];
    const o = original.packages[id];
    return group(
      `${LEVELS[id]}: ${o.name}`,
      fields(
        textField('Name', () => p.name, (v) => (p.name = v), o.name, { max: 32 }),
        textField('How long it takes', () => p.duration, (v) => (p.duration = v), o.duration, { max: 32, hint: 'Like "2–3 hours".' }),
        textField('What it is', () => p.summary, (v) => (p.summary = v), o.summary, { max: 300, lines: 3 }),
        linesField("What's included", () => p.includes, (v) => (p.includes = v), o.includes, { hint: 'One thing per line.' }),
        textField('Last line', () => p.closer, (v) => (p.closer = v), o.closer, { max: 160, wide: true, hint: 'Who this package is for.' }),
        photoField('Photo', () => p.photo, (v) => (p.photo = v), o.photo, () => p.name),
      ),
    );
  });

  view.replaceChildren(
    h(
      'p',
      { class: 'mb-10 max-w-2xl border-l-2 border-gold-500 pl-4 text-bone-200' },
      'Change the words and photos on your website. Nothing changes until you press Save. Prices are on the Prices tab, and your hours are on the Hours tab.',
    ),

    sectionHead('Top of the page', 'The first thing people see.'),
    fields(
      textField('Small line above the headline', () => w.hero.eyebrow, (v) => (w.hero.eyebrow = v), original.hero.eyebrow, { max: 60 }),
      textField('Same line, short, for phones', () => w.hero.eyebrowShort, (v) => (w.hero.eyebrowShort = v), original.hero.eyebrowShort, { max: 32 }),
      ...([0, 1, 2] as const).map((i) =>
        textField(
          `Headline, line ${i + 1}${i === 2 ? ' (gold)' : ''}`,
          () => w.hero.headline[i],
          (v) => (w.hero.headline[i] = v),
          original.hero.headline[i],
          { max: 10, hint: i === 0 ? 'The letters are huge, so each line fits about 10.' : undefined },
        ),
      ),
      textField('Text under the headline', () => w.hero.sub, (v) => (w.hero.sub = v), original.hero.sub, { max: 220, lines: 2 }),
    ),

    sectionHead('About you'),
    fields(
      textField('About paragraph', () => w.intro, (v) => (w.intro = v), original.intro, { max: 500, lines: 5 }),
      textField('Where you are based', () => w.area.base, (v) => (w.area.base = v), original.area.base, { max: 40, hint: 'A town, not your street address.' }),
      textField('Area you cover', () => w.area.covers, (v) => (w.area.covers = v), original.area.covers, { max: 80, hint: 'Reads "…detailing across ___".' }),
    ),

    sectionHead('Packages', 'The words and photo for each package.'),
    ...packages,

    sectionHead('Also available', 'Other work you do, under the packages.'),
    listEditor({
      get: () => w.also,
      set: (v) => (w.also = v),
      original: original.also,
      noun: 'another service',
      min: 0,
      max: 4,
      blank: () => ({ name: '', blurb: '' }),
      title: (a, i) => a.name.trim() || `Service ${i + 1}`,
      row: (a) =>
        fields(
          textField('Name', () => a.name, (v) => (a.name = v), null, { max: 60, wide: true }),
          textField('What it is', () => a.blurb, (v) => (a.blurb = v), null, { max: 300, lines: 3 }),
        ),
    }),

    sectionHead('Reviews'),
    fields(
      textField('Star rating', () => w.reviews.rating, (v) => (w.reviews.rating = v), original.reviews.rating, { max: 3, inputmode: 'decimal', hint: 'Like 5.0' }),
      textField(
        'Number of reviews',
        () => String(w.reviews.count),
        (v) => (w.reviews.count = /^\d+$/.test(v.trim()) ? Number(v.trim()) : (v as unknown as number)),
        String(original.reviews.count),
        { max: 6, inputmode: 'numeric' },
      ),
      textField('Link to your reviews', () => w.reviews.url, (v) => (w.reviews.url = v), original.reviews.url, { max: 300, wide: true, type: 'url' }),
    ),
    h('div', { class: 'mt-6' }, hint('Copy these word for word from real reviews.')),
    listEditor({
      get: () => w.reviews.list,
      set: (v) => (w.reviews.list = v),
      original: original.reviews.list,
      noun: 'a review',
      min: 1,
      max: 20,
      blank: () => ({ quote: '', name: '', detail: '', source: 'Google' }),
      title: (r, i) => r.name.trim() || `Review ${i + 1}`,
      row: (r) =>
        fields(
          textField('What they said', () => r.quote, (v) => (r.quote = v), null, { max: 700, lines: 4 }),
          textField('Their name', () => r.name, (v) => (r.name = v), null, { max: 60 }),
          textField('Where they left it', () => r.source, (v) => (r.source = v), null, { max: 30, hint: 'Like Google.' }),
          textField('What you did', () => r.detail, (v) => (r.detail = v), null, { max: 80, wide: true, hint: 'Like "1972 Monte Carlo". You can leave it empty.' }),
        ),
    }),

    sectionHead('Questions', 'The questions and answers near the bottom of the page. Google shows these too.'),
    listEditor({
      get: () => w.faqs,
      set: (v) => (w.faqs = v),
      original: original.faqs,
      noun: 'a question',
      min: 1,
      max: 20,
      blank: () => ({ q: '', a: '' }),
      title: (_, i) => `Question ${i + 1}`,
      row: (f) =>
        fields(
          textField('Question', () => f.q, (v) => (f.q = v), null, { max: 160, wide: true }),
          textField('Answer', () => f.a, (v) => (f.a = v), null, { max: 800, lines: 4 }),
        ),
    }),

    sectionHead('Contact', 'Shown all over the site.'),
    fields(
      textField('Phone', () => w.contact.phone, (v) => (w.contact.phone = v), original.contact.phone, { max: 20, type: 'tel', inputmode: 'tel' }),
      textField('Email', () => w.contact.email, (v) => (w.contact.email = v), original.contact.email, { max: 120, type: 'email' }),
      textField('Instagram link', () => w.contact.instagram, (v) => (w.contact.instagram = v), original.contact.instagram, { max: 300, type: 'url' }),
      textField('Facebook link', () => w.contact.facebook, (v) => (w.contact.facebook = v), original.contact.facebook, { max: 300, type: 'url' }),
    ),

    sectionHead('Recent work', 'The row of photos above "Follow" on the home page. Up to 8.'),
    listEditor({
      get: () => w.recent,
      set: (v) => (w.recent = v),
      original: original.recent,
      noun: 'a photo',
      min: 1,
      max: 8,
      blank: () => ({ photo: original.recent[0]!.photo, alt: '' }),
      title: (_, i) => `Photo ${i + 1}`,
      row: (r) =>
        fields(
          photoField('Photo', () => r.photo, (v) => (r.photo = v), null, () => r.alt),
          textField('What is in the photo', () => r.alt, (v) => (r.alt = v), null, {
            max: 160,
            wide: true,
            hint: 'For people who can\'t see it, and for Google. Like "Foam on a white Porsche".',
          }),
        ),
    }),

    sectionHead('Scrolling names', 'The gold strip of car names that slides across the page.'),
    fields(linesField('Names', () => w.marquee, (v) => (w.marquee = v), original.marquee, { hint: 'One per line. At least 3.', lines: 10 })),

    savedLine,
    saveBar('Save website', async () => {
      const problems = check(w);
      if (problems.length) throw new Failed('Some of the website needs fixing before it can be saved.', problems);
      const res = await api<{ content: SiteDoc; updatedAt: string }>('/site', { method: 'PUT', body: changes(w) });
      updatedAt = res.updatedAt;
      drawSavedLine();
      return 'Saved. The website updates in a few minutes.';
    }),
  );
  changed();
}

/** The quick checks, so empty boxes are caught before the round trip. The API checks everything. */
function check(w: Full): string[] {
  const out: string[] = [];
  const empty = (v: string) => !v.trim();
  if (w.hero.headline.some(empty)) out.push('The headline needs all 3 lines.');
  w.also.forEach((a, i) => (empty(a.name) || empty(a.blurb)) && out.push(`Also available ${i + 1} needs a name and what it is.`));
  w.reviews.list.forEach((r, i) => (empty(r.quote) || empty(r.name)) && out.push(`Review ${i + 1} needs what they said and their name.`));
  w.faqs.forEach((f, i) => (empty(f.q) || empty(f.a)) && out.push(`Question ${i + 1} needs a question and an answer.`));
  w.recent.forEach((r, i) => empty(r.alt) && out.push(`Recent work photo ${i + 1} needs a few words about what's in it.`));
  if (typeof w.reviews.count !== 'number') out.push('Number of reviews must be a whole number.');
  return out;
}
