import { ApiError, randomToken, type Bindings } from './lib.ts';

/**
 * Artwork handed to a print shop's API (the door-jamb sticker sheets), which
 * fetches files from a public URL rather than taking uploads. Each file sits
 * at an unguessable address and deletes itself after a week, long enough for
 * the order to be reviewed and paid.
 */

const MAX_BYTES = 20 * 1024 * 1024;
const KEEP_SECONDS = 7 * 24 * 60 * 60;
const PNG = [0x89, 0x50, 0x4e, 0x47];

function kv(env: Bindings): KVNamespace {
  const store = env.PHOTO_KV as KVNamespace | undefined;
  if (!store) throw new ApiError(503, 'photos_off', "Photo storage isn't switched on yet.");
  return store;
}

/** A PNG as the raw request body. */
export async function uploadPrintFile(env: Bindings, req: Request) {
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (!bytes.length) throw new ApiError(422, 'invalid', 'Send the PNG as the request body.');
  if (bytes.length > MAX_BYTES) throw new ApiError(413, 'too_large', 'Print files can be up to 20 MB.');
  if (!PNG.every((b, i) => bytes[i] === b)) throw new ApiError(422, 'invalid', 'Print files must be PNG.');
  const id = randomToken();
  await kv(env).put(`print/${id}`, bytes, { expirationTtl: KEEP_SECONDS });
  return { url: `/v1/print-files/${id}.png`, expiresInDays: KEEP_SECONDS / 86400 };
}

export async function printFileResponse(env: Bindings, name: string) {
  const id = name.replace(/\.png$/, '');
  if (!/^[A-Za-z0-9_-]{16,}$/.test(id)) throw new ApiError(404, 'not_found', 'No such file.');
  const body = await kv(env).get(`print/${id}`, 'stream');
  if (!body) throw new ApiError(404, 'not_found', 'No such file. Print files are deleted after a week.');
  return new Response(body, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=3600', 'X-Robots-Tag': 'noindex' } });
}
