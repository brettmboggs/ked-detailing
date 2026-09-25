import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { APIRoute, GetStaticPaths } from 'astro';
import sharp from 'sharp';
import { loadLiveSite } from '../../lib/live-site';

/**
 * The website's photo files that don't go through astro:assets:
 *
 * - `<id>-<width>.webp`: photos Jacob uploaded in the admin, downloaded and
 *   resized at build time (src/lib/live-site.ts), so pages never load images
 *   from the API.
 * - `<name>-400.webp`: small copies of the built-in photos, for the admin's
 *   photo picker only.
 */
const builtInPhotos = Object.keys(import.meta.glob('../../assets/photos/*.jpg')).map((k) => k.split('/').pop()!);

export const getStaticPaths = (async () => {
  const { uploads } = await loadLiveSite();
  const uploaded = [...uploads.values()].flatMap((u) => [...u.files.entries()]);
  return [
    ...uploaded.map(([file, bytes]) => ({ params: { file }, props: { bytes } })),
    ...builtInPhotos.map((name) => ({ params: { file: `${name.replace(/\.jpg$/, '')}-400.webp` }, props: { builtIn: name } })),
  ];
}) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ props }) => {
  const bytes: Uint8Array = props.bytes
    ? props.bytes
    : new Uint8Array(
        await sharp(await readFile(join(process.cwd(), 'src/assets/photos', props.builtIn as string)))
          .rotate()
          .resize({ width: 400 })
          .webp({ quality: 70 })
          .toBuffer(),
      );
  return new Response(bytes as BodyInit, { headers: { 'Content-Type': 'image/webp' } });
};
