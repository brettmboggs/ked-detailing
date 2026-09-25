import sharp from 'sharp';
import { apiUrl } from './pricing';
import { isUpload, merge, uploadsIn, type PhotoRef, type SiteContent } from './site-content';

/**
 * The website's words and photos, read once per build from the API and laid
 * over src/data/site.ts. Saving in the admin's Website tab rebuilds the site
 * (rebuildSite in api/src/index.ts), so pages follow without a commit.
 *
 * Photos Jacob uploads are downloaded here and resized into WebP files that
 * the build writes out with the site (src/pages/site-photos/[file].ts), so a
 * page never loads an image from the API. Built-in photos keep going through
 * astro:assets as before.
 *
 * Nothing saved, the API unreachable, a bad field or a photo that won't
 * download: each falls back to the built-in content. A broken API never breaks
 * the build.
 *
 * Build only (sharp, network). Components render photos with SitePhoto.astro.
 */

/** Widths each uploaded photo is written at. */
export const UPLOAD_WIDTHS = [480, 960, 1600] as const;

export interface Upload {
  width: number;
  height: number;
  /** `${id}-${w}.webp` → the bytes. */
  files: Map<string, Uint8Array>;
}

export interface LiveSite {
  content: SiteContent;
  uploads: Map<string, Upload>;
}

const builtIns = new Set(
  Object.keys(import.meta.glob('../assets/photos/*.jpg')).map((k) => k.split('/').pop()!),
);

let cached: { at: number; site: Promise<LiveSite> } | undefined;

export function loadLiveSite(): Promise<LiveSite> {
  // In dev, look again every few seconds so a save shows on reload.
  if (!cached || (import.meta.env.DEV && Date.now() - cached.at > 5000)) cached = { at: Date.now(), site: fetchSite() };
  return cached.site;
}

export async function loadSite(): Promise<SiteContent> {
  return (await loadLiveSite()).content;
}

const fallback = (): LiveSite => ({ content: merge({}, (ref) => builtIns.has(ref)), uploads: new Map() });

async function fetchSite(): Promise<LiveSite> {
  if (!apiUrl) return fallback();
  let doc: unknown;
  try {
    const res = await fetch(`${apiUrl}/v1/site`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { content?: unknown; updatedAt?: string | null };
    if (!body.updatedAt) return fallback();
    doc = body.content;
  } catch (err) {
    console.warn(`[site] using the built-in words and photos: ${(err as Error).message}`);
    return fallback();
  }

  const uploads = new Map<string, Upload>();
  await Promise.all(
    uploadsIn(doc).map(async (id) => {
      try {
        uploads.set(id, await fetchPhoto(id));
      } catch (err) {
        console.warn(`[site] photo ${id} left out: ${(err as Error).message}`);
      }
    }),
  );
  const photoOk = (ref: PhotoRef) => (isUpload(ref) ? uploads.has(ref) : builtIns.has(ref));
  try {
    return { content: merge(doc, photoOk), uploads };
  } catch (err) {
    console.warn(`[site] using the built-in words and photos: ${(err as Error).message}`);
    return fallback();
  }
}

async function fetchPhoto(id: string): Promise<Upload> {
  const res = await fetch(`${apiUrl}/v1/site/photos/${id}`, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const meta = await sharp(bytes).rotate().metadata();
  // .rotate() applies EXIF orientation, so a portrait phone shot stays upright.
  const upright = meta.orientation && meta.orientation >= 5;
  const width = (upright ? meta.height : meta.width) ?? 0;
  const height = (upright ? meta.width : meta.height) ?? 0;
  if (!width || !height) throw new Error('not an image');
  const files = new Map<string, Uint8Array>();
  for (const w of UPLOAD_WIDTHS) {
    const out = await sharp(bytes).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
    files.set(`${id}-${w}.webp`, new Uint8Array(out));
  }
  return { width, height, files };
}
