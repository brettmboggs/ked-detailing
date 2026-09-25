import {
  alsoAvailable,
  business,
  faqs,
  hero,
  intro,
  marque,
  recent,
  services,
  testimonials,
  type Faq,
  type Service,
  type Testimonial,
} from '../data/site';

/**
 * The parts of the website Jacob can change in the admin's Website tab, and
 * how his changes are laid over the built-in text in src/data/site.ts.
 *
 * `SiteDoc` is what the API stores (api/src/site.ts validates it): only the
 * fields he has changed. `original` is the same shape filled in from site.ts,
 * which the admin shows as the starting point and for "Put back the original".
 * `merge` makes the content the pages render, taking each field from his
 * document only when it's usable, so a bad or missing value falls back to the
 * built-in one instead of breaking the build.
 *
 * No Node or build-only imports here: the admin page bundles this file.
 */

export const PACKAGE_IDS = ['level-1', 'level-2', 'level-3', 'level-4'] as const;
export type PackageId = (typeof PACKAGE_IDS)[number];

/** A photo: a built-in file in src/assets/photos ("van-logo.jpg") or an uploaded photo's id. */
export type PhotoRef = string;
export const isUpload = (ref: PhotoRef) => /^[0-9A-HJKMNP-TV-Z]{26}$/.test(ref);

export interface PackageText {
  name?: string;
  duration?: string;
  summary?: string;
  includes?: string[];
  closer?: string;
  photo?: PhotoRef;
}

export interface SiteDoc {
  hero?: { eyebrow?: string; eyebrowShort?: string; headline?: [string, string, string]; sub?: string };
  intro?: string;
  area?: { base?: string; covers?: string };
  contact?: { phone?: string; email?: string; instagram?: string; facebook?: string };
  reviews?: { rating?: string; count?: number; url?: string; list?: Testimonial[] };
  packages?: Partial<Record<PackageId, PackageText>>;
  also?: { name: string; blurb: string }[];
  faqs?: Faq[];
  marquee?: string[];
  recent?: { photo: PhotoRef; alt: string }[];
}

/** Every editable field, filled in. */
export interface FullDoc {
  hero: { eyebrow: string; eyebrowShort: string; headline: [string, string, string]; sub: string };
  intro: string;
  area: { base: string; covers: string };
  contact: { phone: string; email: string; instagram: string; facebook: string };
  reviews: { rating: string; count: number; url: string; list: Testimonial[] };
  packages: Record<PackageId, Required<PackageText>>;
  also: { name: string; blurb: string }[];
  faqs: Faq[];
  marquee: string[];
  recent: { photo: PhotoRef; alt: string }[];
}

/** What the pages render. */
export interface SiteContent {
  business: {
    [K in keyof typeof business]: (typeof business)[K] extends string ? string : (typeof business)[K] extends number ? number : (typeof business)[K];
  };
  hero: { eyebrow: string; eyebrowShort: string; headline: [string, string, string]; sub: string; pricingNote: string };
  intro: string;
  services: Service[];
  alsoAvailable: { name: string; blurb: string }[];
  testimonials: Testimonial[];
  faqs: Faq[];
  marque: string[];
  recent: { src: PhotoRef; alt: string }[];
}

/** "Level II" → "level-2". */
export const packageId = (level: string): PackageId | undefined => {
  const n = { I: 1, II: 2, III: 3, IV: 4 }[level.replace('Level ', '').trim() as 'I' | 'II' | 'III' | 'IV'];
  return n ? (`level-${n}` as PackageId) : undefined;
};

const headline = hero.headline as unknown as [string, string, string];

/** Every editable field as it is in site.ts. */
export const original: FullDoc = {
  hero: { eyebrow: hero.eyebrow, eyebrowShort: hero.eyebrowShort, headline: [...headline] as [string, string, string], sub: hero.sub },
  intro,
  area: { base: business.baseCity, covers: business.serviceArea },
  contact: { phone: business.phone, email: business.email, instagram: business.instagram, facebook: business.facebook },
  reviews: { rating: business.rating, count: business.reviewCount, url: business.reviewsUrl, list: testimonials.map((t) => ({ ...t })) },
  packages: Object.fromEntries(
    services.map((s) => [
      packageId(s.level)!,
      { name: s.name, duration: s.duration, summary: s.summary, includes: [...s.includes], closer: s.closer, photo: s.photo },
    ]),
  ) as Record<PackageId, Required<PackageText>>,
  also: alsoAvailable.map((a) => ({ ...a })),
  faqs: faqs.map((f) => ({ ...f })),
  marquee: [...marque],
  recent: recent.map((r) => ({ photo: r.src, alt: r.alt })),
};

/* ------------------------------------------------------------ merge */

const text = (v: unknown, fallback: string, max = 1000): string =>
  typeof v === 'string' && v.trim() && v.length <= max && !/[<>]/.test(v) ? v.trim() : fallback;

const list = <T>(v: unknown, fallback: T[], item: (x: unknown) => T | undefined, max = 40): T[] => {
  if (!Array.isArray(v) || !v.length || v.length > max) return fallback;
  const out = v.map(item);
  return out.every((x) => x !== undefined) ? (out as T[]) : fallback;
};

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

const digits = (phone: string) => phone.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');

const httpsUrl = (v: unknown, fallback: string, host?: string) => {
  const t = text(v, '');
  try {
    const u = new URL(t);
    if (u.protocol === 'https:' && (!host || u.hostname.replace(/^www\./, '') === host)) return u.href;
  } catch {
    // fall through
  }
  return fallback;
};

/**
 * Jacob's changes over the built-in content. `photoOk` says whether a photo
 * reference can actually be shown (the built-in file exists, or the upload
 * was fetched), so a missing photo falls back rather than breaking a page.
 */
export function merge(input: unknown, photoOk: (ref: PhotoRef) => boolean): SiteContent {
  const doc = obj(input);
  const h = obj(doc.hero);
  const area = obj(doc.area);
  const contact = obj(doc.contact);
  const reviews = obj(doc.reviews);
  const packages = obj(doc.packages);

  const phone = text(contact.phone, business.phone);
  const phoneOk = digits(phone).length === 10;
  const instagram = httpsUrl(contact.instagram, business.instagram, 'instagram.com');
  const handle = new URL(instagram).pathname.split('/').filter(Boolean)[0];
  const email = text(contact.email, business.email);
  const count = reviews.count;

  const headlineIn = list(h.headline, [...headline], (l) => (typeof l === 'string' && l.trim() && !/[<>]/.test(l) ? l.trim() : undefined));

  return {
    business: {
      ...business,
      baseCity: text(area.base, business.baseCity, 40),
      serviceArea: text(area.covers, business.serviceArea, 80),
      phone: phoneOk ? phone : business.phone,
      phoneHref: phoneOk ? `tel:+1${digits(phone)}` : business.phoneHref,
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : business.email,
      instagram,
      instagramHandle: instagram === business.instagram || !handle ? business.instagramHandle : `@${handle}`,
      facebook: httpsUrl(contact.facebook, business.facebook, 'facebook.com'),
      reviewsUrl: httpsUrl(reviews.url, business.reviewsUrl),
      rating: /^[1-5](\.\d)?$/.test(text(reviews.rating, '')) ? text(reviews.rating, '') : business.rating,
      reviewCount: typeof count === 'number' && Number.isInteger(count) && count >= 0 ? count : business.reviewCount,
    },
    hero: {
      ...hero,
      eyebrow: text(h.eyebrow, hero.eyebrow, 60),
      eyebrowShort: text(h.eyebrowShort, hero.eyebrowShort, 32),
      headline: headlineIn.length === 3 ? (headlineIn as [string, string, string]) : [...headline],
      sub: text(h.sub, hero.sub, 220),
    },
    intro: text(doc.intro, intro, 500),
    services: services.map((s) => {
      const p = obj(packages[packageId(s.level)!]);
      const photo = typeof p.photo === 'string' && photoOk(p.photo) ? p.photo : s.photo;
      return {
        ...s,
        name: text(p.name, s.name, 32),
        duration: text(p.duration, s.duration, 32),
        summary: text(p.summary, s.summary, 300),
        includes: list(p.includes, s.includes, (l) => (typeof l === 'string' ? text(l, '') || undefined : undefined), 12),
        closer: text(p.closer, s.closer, 160),
        photo,
      };
    }),
    // An empty list is allowed here: it hides the "Also available" block.
    alsoAvailable: Array.isArray(doc.also) && doc.also.length === 0
      ? []
      : list(doc.also, alsoAvailable, (a) => {
          const x = obj(a);
          const name = text(x.name, '');
          const blurb = text(x.blurb, '');
          return name && blurb ? { name, blurb } : undefined;
        }, 4),
    testimonials: list(reviews.list, testimonials, (r) => {
      const x = obj(r);
      const quote = text(x.quote, '');
      const name = text(x.name, '');
      return quote && name ? { quote, name, detail: text(x.detail, ''), source: text(x.source, '') } : undefined;
    }, 20),
    faqs: list(doc.faqs, faqs, (f) => {
      const x = obj(f);
      const q = text(x.q, '');
      const a = text(x.a, '');
      return q && a ? { q, a } : undefined;
    }, 20),
    marque: list(doc.marquee, marque, (w) => text(w, '') || undefined),
    recent: (() => {
      // A photo that can't be shown is dropped from the row, not the whole row.
      if (!Array.isArray(doc.recent)) return recent;
      const items = doc.recent
        .map((r) => obj(r))
        .filter((r) => typeof r.photo === 'string' && photoOk(r.photo))
        .map((r) => ({ src: r.photo as string, alt: text(r.alt, '') }))
        .slice(0, 8);
      return items.length ? items : recent;
    })(),
  };
}

/** Every uploaded photo a document uses. */
export function uploadsIn(input: unknown): string[] {
  const doc = obj(input);
  const refs = [
    ...Object.values(obj(doc.packages)).map((p) => obj(p).photo),
    ...(Array.isArray(doc.recent) ? doc.recent.map((r) => obj(r).photo) : []),
  ];
  return [...new Set(refs.filter((r): r is string => typeof r === 'string' && isUpload(r)))];
}
