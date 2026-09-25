import type { APIRoute } from 'astro';

/** The built-in photos (src/assets/photos), for the admin's photo picker. Thumbnails are at `<name>-400.webp`. */
export const builtInPhotos = Object.keys(import.meta.glob('../../assets/photos/*.jpg'))
  .map((k) => k.split('/').pop()!)
  .sort();

export const GET: APIRoute = () => Response.json({ photos: builtInPhotos });
