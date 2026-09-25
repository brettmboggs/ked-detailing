import { ApiError, now, ulid, type Bindings } from './lib.ts';

/**
 * The website's own words and photos, as Jacob edits them in the web admin.
 *
 * Stored as one JSON document in `settings` under the key 'site', holding only
 * what he has changed. The Astro build reads it from GET /v1/site and lays it
 * over the built-in text in src/data/site.ts (src/lib/site-content.ts), so an
 * empty document is exactly today's site. A save rebuilds the site.
 *
 * Everything here is plain text: the validator rejects unknown fields, caps
 * every length, and refuses anything that looks like HTML.
 *
 * Photos he uploads for the site live in KV under `site/<id>`, apart from job
 * photos and receipts. They're only served publicly while the saved document
 * uses them, and a save sweeps away uploads nothing uses any more.
 */

export const PACKAGE_IDS = ['level-1', 'level-2', 'level-3', 'level-4'] as const;

type Photo = string; // a built-in file name ("van-logo.jpg") or an upload id (ULID)

export interface SiteDoc {
  hero?: { eyebrow?: string; eyebrowShort?: string; headline?: [string, string, string]; sub?: string };
  intro?: string;
  area?: { base?: string; covers?: string };
  contact?: { phone?: string; email?: string; instagram?: string; facebook?: string };
  reviews?: {
    rating?: string;
    count?: number;
    url?: string;
    list?: { quote: string; name: string; detail: string; source: string }[];
  };
  packages?: Partial<
    Record<
      (typeof PACKAGE_IDS)[number],
      { name?: string; duration?: string; summary?: string; includes?: string[]; closer?: string; photo?: Photo }
    >
  >;
  also?: { name: string; blurb: string }[];
  faqs?: { q: string; a: string }[];
  marquee?: string[];
  recent?: { photo: Photo; alt: string }[];
}

const UPLOAD_ID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const BUILT_IN = /^[a-z0-9][a-z0-9-]{0,76}\.jpg$/;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/* --------------------------------------------------------- validate */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Checks a whole document and returns a clean copy (known fields only,
 * trimmed) plus every problem in plain English, the way validateConfig does
 * for prices. `uploads` is the set of site photo ids that exist.
 */
export function validateSite(body: unknown, uploads: Set<string>): { doc: SiteDoc; errors: string[] } {
  const errors: string[] = [];
  const doc: SiteDoc = {};
  if (!isObj(body)) return { doc, errors: ['The website content must be an object.'] };

  const only = (o: Obj, keys: readonly string[], where: string) => {
    for (const k of Object.keys(o)) if (!keys.includes(k)) errors.push(`${where}: "${k}" isn't something the website has.`);
  };

  /** Trimmed text, up to `max` characters, no HTML. Undefined (with an error) when it isn't. */
  const str = (v: unknown, label: string, max: number, min = 1): string | undefined => {
    if (typeof v !== 'string') {
      errors.push(`${label} must be text.`);
      return undefined;
    }
    const t = v.replace(/\r\n?/g, '\n').trim();
    if (t.length < min) errors.push(`${label} can't be empty.`);
    else if (t.length > max) errors.push(`${label} is too long (${t.length} letters; the most is ${max}).`);
    else if (/[<>]/.test(t)) errors.push(`${label}: leave out the < and > signs.`);
    // eslint-disable-next-line no-control-regex
    else if (/[\u0000-\u0008\u000b-\u001f\u007f]/.test(t)) errors.push(`${label} has a hidden character in it. Retype it.`);
    else return t;
    return undefined;
  };

  const arr = (v: unknown, label: string, minItems: number, maxItems: number): unknown[] | undefined => {
    if (!Array.isArray(v)) {
      errors.push(`${label} must be a list.`);
      return undefined;
    }
    if (v.length < minItems) errors.push(`${label} needs at least ${minItems}.`);
    else if (v.length > maxItems) errors.push(`${label} can have up to ${maxItems}.`);
    else return v;
    return undefined;
  };

  const obj = (v: unknown, label: string): Obj | undefined => {
    if (isObj(v)) return v;
    errors.push(`${label} must be an object.`);
    return undefined;
  };

  const url = (v: unknown, label: string, hosts?: string[]): string | undefined => {
    const t = str(v, label, 300);
    if (t === undefined) return undefined;
    try {
      const u = new URL(t);
      const host = u.hostname.replace(/^www\./, '');
      if (u.protocol !== 'https:') errors.push(`${label} must start with https://`);
      else if (hosts && !hosts.includes(host)) errors.push(`${label} must be a ${hosts[0]} link.`);
      else return u.href;
    } catch {
      errors.push(`${label} isn't a web address.`);
    }
    return undefined;
  };

  const photo = (v: unknown, label: string): string | undefined => {
    if (typeof v === 'string' && BUILT_IN.test(v)) return v;
    if (typeof v === 'string' && UPLOAD_ID.test(v)) {
      if (uploads.has(v)) return v;
      errors.push(`${label}: that photo didn't finish uploading. Add it again.`);
      return undefined;
    }
    errors.push(`${label} isn't a photo.`);
    return undefined;
  };

  /** Copies each present field through its checker, leaving absent ones out. */
  const pick = <T extends Obj>(src: Obj, fields: { [K in keyof T]?: (v: unknown) => T[K] | undefined }): T => {
    const out: Obj = {};
    for (const [k, check] of Object.entries(fields)) {
      if (src[k] === undefined) continue;
      const v = (check as (v: unknown) => unknown)(src[k]);
      if (v !== undefined) out[k] = v;
    }
    return out as T;
  };

  only(body, ['hero', 'intro', 'area', 'contact', 'reviews', 'packages', 'also', 'faqs', 'marquee', 'recent'], 'Website');

  if (body.hero !== undefined) {
    const o = obj(body.hero, 'Top of the page');
    if (o) {
      only(o, ['eyebrow', 'eyebrowShort', 'headline', 'sub'], 'Top of the page');
      doc.hero = pick(o, {
        eyebrow: (v) => str(v, 'The small line above the headline', 60),
        eyebrowShort: (v) => str(v, 'The short line for phones', 32),
        headline: (v) => {
          const lines = arr(v, 'The headline', 3, 3);
          if (!lines) return undefined;
          const out = lines.map((l, i) => str(l, `Headline line ${i + 1}`, 10));
          return out.every((l) => l !== undefined) ? (out as [string, string, string]) : undefined;
        },
        sub: (v) => str(v, 'The text under the headline', 220),
      });
    }
  }

  if (body.intro !== undefined) {
    const t = str(body.intro, 'The About paragraph', 500);
    if (t !== undefined) doc.intro = t;
  }

  if (body.area !== undefined) {
    const o = obj(body.area, 'Where you work');
    if (o) {
      only(o, ['base', 'covers'], 'Where you work');
      doc.area = pick(o, {
        base: (v) => str(v, 'Where you are based', 40),
        covers: (v) => str(v, 'The area you cover', 80),
      });
    }
  }

  if (body.contact !== undefined) {
    const o = obj(body.contact, 'Contact');
    if (o) {
      only(o, ['phone', 'email', 'instagram', 'facebook'], 'Contact');
      doc.contact = pick(o, {
        phone: (v) => {
          const t = str(v, 'Phone number', 20);
          if (t === undefined) return undefined;
          const d = t.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
          if (d.length !== 10) {
            errors.push('Phone number needs 10 digits, like (314) 555-0100.');
            return undefined;
          }
          return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
        },
        email: (v) => {
          const t = str(v, 'Email', 120);
          if (t !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) {
            errors.push("Email doesn't look like an email address.");
            return undefined;
          }
          return t?.toLowerCase();
        },
        instagram: (v) => url(v, 'Instagram link', ['instagram.com']),
        facebook: (v) => url(v, 'Facebook link', ['facebook.com']),
      });
    }
  }

  if (body.reviews !== undefined) {
    const o = obj(body.reviews, 'Reviews');
    if (o) {
      only(o, ['rating', 'count', 'url', 'list'], 'Reviews');
      doc.reviews = pick(o, {
        rating: (v) => {
          const t = str(v, 'Star rating', 3);
          if (t !== undefined && !/^[1-5](\.\d)?$/.test(t)) {
            errors.push('Star rating must be a number from 1 to 5, like 5.0 or 4.9.');
            return undefined;
          }
          return t;
        },
        count: (v) => {
          if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100000) return v;
          errors.push('Number of reviews must be a whole number.');
          return undefined;
        },
        url: (v) => url(v, 'Reviews link'),
        list: (v) => {
          const items = arr(v, 'Reviews', 1, 20);
          if (!items) return undefined;
          const out = items.map((r, i) => {
            const n = `Review ${i + 1}`;
            const x = obj(r, n);
            if (!x) return undefined;
            only(x, ['quote', 'name', 'detail', 'source'], n);
            const quote = str(x.quote, `${n}: what they said`, 700);
            const name = str(x.name, `${n}: name`, 60);
            const detail = str(x.detail ?? '', `${n}: what you did`, 80, 0);
            const source = str(x.source ?? '', `${n}: where it was left`, 30, 0);
            return quote && name && detail !== undefined && source !== undefined ? { quote, name, detail, source } : undefined;
          });
          return out.every(Boolean) ? (out as NonNullable<SiteDoc['reviews']>['list']) : undefined;
        },
      });
    }
  }

  if (body.packages !== undefined) {
    const o = obj(body.packages, 'Packages');
    if (o) {
      only(o, PACKAGE_IDS, 'Packages');
      const packages: NonNullable<SiteDoc['packages']> = {};
      for (const id of PACKAGE_IDS) {
        if (o[id] === undefined) continue;
        const n = `Level ${['I', 'II', 'III', 'IV'][PACKAGE_IDS.indexOf(id)]}`;
        const p = obj(o[id], n);
        if (!p) continue;
        only(p, ['name', 'duration', 'summary', 'includes', 'closer', 'photo'], n);
        packages[id] = pick(p, {
          name: (v) => str(v, `${n}: name`, 32),
          duration: (v) => str(v, `${n}: how long it takes`, 32),
          summary: (v) => str(v, `${n}: description`, 300),
          includes: (v) => {
            const items = arr(v, `${n}: what's included`, 1, 12);
            if (!items) return undefined;
            const out = items.map((l, i) => str(l, `${n}: included item ${i + 1}`, 80));
            return out.every((l) => l !== undefined) ? (out as string[]) : undefined;
          },
          closer: (v) => str(v, `${n}: last line`, 160),
          photo: (v) => photo(v, `${n}: photo`),
        });
      }
      doc.packages = packages;
    }
  }

  if (body.also !== undefined) {
    const items = arr(body.also, 'Also available', 0, 4);
    if (items) {
      const out = items.map((a, i) => {
        const n = `Also available ${i + 1}`;
        const x = obj(a, n);
        if (!x) return undefined;
        only(x, ['name', 'blurb'], n);
        const name = str(x.name, `${n}: name`, 60);
        const blurb = str(x.blurb, `${n}: description`, 300);
        return name && blurb ? { name, blurb } : undefined;
      });
      if (out.every(Boolean)) doc.also = out as SiteDoc['also'];
    }
  }

  if (body.faqs !== undefined) {
    const items = arr(body.faqs, 'Questions', 1, 20);
    if (items) {
      const out = items.map((f, i) => {
        const n = `Question ${i + 1}`;
        const x = obj(f, n);
        if (!x) return undefined;
        only(x, ['q', 'a'], n);
        const q = str(x.q, `${n}`, 160);
        const a = str(x.a, `${n}: answer`, 800);
        return q && a ? { q, a } : undefined;
      });
      if (out.every(Boolean)) doc.faqs = out as SiteDoc['faqs'];
    }
  }

  if (body.marquee !== undefined) {
    const items = arr(body.marquee, 'Scrolling names', 3, 40);
    if (items) {
      const out = items.map((w, i) => str(w, `Scrolling name ${i + 1}`, 30));
      if (out.every((w) => w !== undefined)) doc.marquee = out as string[];
    }
  }

  if (body.recent !== undefined) {
    const items = arr(body.recent, 'Recent work photos', 1, 8);
    if (items) {
      const out = items.map((r, i) => {
        const n = `Recent work photo ${i + 1}`;
        const x = obj(r, n);
        if (!x) return undefined;
        only(x, ['photo', 'alt'], n);
        const p = photo(x.photo, n);
        const alt = str(x.alt, `${n}: description`, 160);
        return p && alt ? { photo: p, alt } : undefined;
      });
      if (out.every(Boolean)) doc.recent = out as SiteDoc['recent'];
    }
  }

  return { doc, errors };
}

/** Every uploaded photo id the document uses. */
export function photosIn(doc: SiteDoc): Set<string> {
  const ids = new Set<string>();
  for (const p of Object.values(doc.packages ?? {})) if (p?.photo && UPLOAD_ID.test(p.photo)) ids.add(p.photo);
  for (const r of doc.recent ?? []) if (UPLOAD_ID.test(r.photo)) ids.add(r.photo);
  return ids;
}

/* ------------------------------------------------------------- store */

export async function currentSite(db: D1Database): Promise<{ content: SiteDoc; updatedAt: string | null }> {
  const row = await db
    .prepare("SELECT value, updated_at FROM settings WHERE key = 'site'")
    .first<{ value: string; updated_at: string }>();
  if (!row) return { content: {}, updatedAt: null };
  return { content: JSON.parse(row.value) as SiteDoc, updatedAt: row.updated_at };
}

function kv(env: Bindings): KVNamespace {
  const store = env.PHOTO_KV as KVNamespace | undefined;
  if (!store) throw new ApiError(503, 'photos_off', "Photo storage isn't switched on yet.");
  return store;
}

/** Ids of every site photo in storage. */
async function uploadedIds(env: Bindings): Promise<Set<string>> {
  const ids = new Set<string>();
  const store = env.PHOTO_KV as KVNamespace | undefined;
  if (!store) return ids;
  let cursor: string | undefined;
  do {
    // TENANT: this sweeps every site/ photo in the namespace. With more than one
    // business it would delete theirs: prefix keys by business first.
    const page: KVNamespaceListResult<unknown, string> = await store.list({ prefix: 'site/', cursor });
    for (const k of page.keys) ids.add(k.name.slice('site/'.length));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return ids;
}

export async function saveSite(env: Bindings, body: unknown, by: string, later: (p: Promise<unknown>) => void) {
  const uploads = await uploadedIds(env);
  const { doc, errors } = validateSite(body, uploads);
  if (errors.length) throw new ApiError(422, 'invalid_site', 'Some of the website needs fixing before it can be saved.', errors);
  const at = now();
  await env.DB.prepare(
    `INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('site', ?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  )
    .bind(JSON.stringify(doc), at, by)
    .run();
  later(sweep(env, uploads, photosIn(doc)));
  return { content: doc, updatedAt: at };
}

/**
 * Deletes site photos nothing uses: ones taken off the site, and uploads that
 * were never saved. Anything younger than an hour is left, in case it's
 * waiting on a save in another tab. The live site keeps its own copies, so
 * this never breaks a page.
 */
async function sweep(env: Bindings, uploads: Set<string>, used: Set<string>) {
  const cutoff = Date.now() - 60 * 60 * 1000;
  const stale = [...uploads].filter((id) => !used.has(id) && ulidTime(id) < cutoff);
  await Promise.all(stale.map((id) => kv(env).delete(`site/${id}`)));
}

function ulidTime(id: string): number {
  const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let t = 0;
  for (const ch of id.slice(0, 10)) t = t * 32 + CROCKFORD.indexOf(ch);
  return t;
}

/* ------------------------------------------------------------- photos */

/** JPEG, PNG or WebP only: browsers show all three. HEIC is converted before upload. */
function sniff(head: Uint8Array): string | null {
  const at = (i: number, ...bytes: number[]) => bytes.every((b, j) => head[i + j] === b);
  const ascii = (i: number, s: string) => [...s].every((c, j) => head[i + j] === c.charCodeAt(0));
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  return null;
}

/** Upload one photo for the website as the raw request body. Not public until a save uses it. */
export async function uploadSitePhoto(env: Bindings, req: Request) {
  const store = kv(env);
  const declared = Number(req.headers.get('Content-Length') ?? 0);
  if (declared > MAX_PHOTO_BYTES) throw new ApiError(413, 'too_big', 'Website photos can be up to 5 MB.');
  const body = new Uint8Array(await req.arrayBuffer());
  if (body.byteLength === 0) throw new ApiError(422, 'invalid', 'The photo was empty.');
  if (body.byteLength > MAX_PHOTO_BYTES) throw new ApiError(413, 'too_big', 'Website photos can be up to 5 MB.');
  const contentType = sniff(body.subarray(0, 16));
  if (!contentType) throw new ApiError(415, 'not_an_image', 'That file is not a JPEG, PNG or WebP photo.');
  const id = ulid();
  await store.put(`site/${id}`, body, { metadata: { contentType } });
  return { id, contentType, bytes: body.byteLength, url: `/v1/site/photos/${id}` };
}

/**
 * A website photo, for anyone, but only while the saved website uses it. Job
 * photos and receipts live under other keys and can never come out of here.
 */
export async function sitePhotoResponse(env: Bindings, id: string) {
  if (!UPLOAD_ID.test(id)) throw new ApiError(404, 'not_found', 'No such photo.');
  const { content } = await currentSite(env.DB);
  if (!photosIn(content).has(id)) throw new ApiError(404, 'not_found', 'No such photo.');
  const found = await kv(env).getWithMetadata<{ contentType: string }>(`site/${id}`, 'stream');
  if (!found.value) throw new ApiError(404, 'not_found', 'That photo is missing from storage.');
  return new Response(found.value, {
    headers: {
      'Content-Type': found.metadata?.contentType ?? 'image/jpeg',
      // An id is never reused for different bytes.
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
