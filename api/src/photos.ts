import { ApiError, now, text, ulid, type Bindings } from './lib.ts';

const MAX_BYTES = 10 * 1024 * 1024;

/** Only real images, checked by their first bytes rather than the claimed type. */
function sniff(head: Uint8Array): { type: string; ext: string } | null {
  const at = (i: number, ...bytes: number[]) => bytes.every((b, j) => head[i + j] === b);
  const ascii = (i: number, s: string) => [...s].every((c, j) => head[i + j] === c.charCodeAt(0));
  if (at(0, 0xff, 0xd8, 0xff)) return { type: 'image/jpeg', ext: 'jpg' };
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return { type: 'image/png', ext: 'png' };
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return { type: 'image/webp', ext: 'webp' };
  // HEIC/HEIF straight off an iPhone: an ISO box with an HEIF brand.
  if (ascii(4, 'ftyp') && ['heic', 'heix', 'hevc', 'mif1', 'msf1'].some((b) => ascii(8, b))) return { type: 'image/heic', ext: 'heic' };
  return null;
}

function bucket(env: Bindings): R2Bucket {
  // Undefined until R2 is switched on for the account and the bucket exists.
  if (!env.PHOTOS) throw new ApiError(503, 'photos_off', "Photo storage isn't switched on yet.");
  return env.PHOTOS;
}

interface PhotoRow {
  id: string;
  object_key: string;
  kind: 'receipt' | 'job';
  stage: 'before' | 'after' | null;
  job_id: string | null;
  content_type: string;
  bytes: number;
  caption: string | null;
  created_at: string;
}

const toPhoto = (r: PhotoRow) => ({
  id: r.id,
  kind: r.kind,
  stage: r.stage,
  jobId: r.job_id,
  contentType: r.content_type,
  bytes: r.bytes,
  caption: r.caption,
  /** Fetch with the same Authorization header as every other owner call. */
  url: `/v1/photos/${r.id}`,
  createdAt: r.created_at,
});

/**
 * Upload one photo as the raw request body (no multipart), with
 * ?kind=receipt|job, and for jobs ?jobId= and optionally &stage=before|after.
 */
export async function uploadPhoto(env: Bindings, req: Request, q: Record<string, string | undefined>) {
  const kind = q.kind;
  if (kind !== 'receipt' && kind !== 'job') throw new ApiError(422, 'invalid', 'kind must be receipt or job.');
  let jobId: string | null = null;
  let stage: 'before' | 'after' | null = null;
  if (kind === 'job') {
    if (!q.jobId || !(await env.DB.prepare('SELECT 1 FROM jobs WHERE id = ?').bind(q.jobId).first())) {
      throw new ApiError(422, 'invalid', 'Job photos need the job they belong to.');
    }
    jobId = q.jobId;
    if (q.stage !== undefined) {
      if (q.stage !== 'before' && q.stage !== 'after') throw new ApiError(422, 'invalid', 'stage must be before or after.');
      stage = q.stage;
    }
  }

  const declared = Number(req.headers.get('Content-Length') ?? 0);
  if (declared > MAX_BYTES) throw new ApiError(413, 'too_big', 'Photos can be up to 10 MB.');
  const body = new Uint8Array(await req.arrayBuffer());
  if (body.byteLength === 0) throw new ApiError(422, 'invalid', 'The photo was empty.');
  if (body.byteLength > MAX_BYTES) throw new ApiError(413, 'too_big', 'Photos can be up to 10 MB.');
  const format = sniff(body.subarray(0, 16));
  if (!format) throw new ApiError(415, 'not_an_image', 'That file is not a JPEG, PNG, WebP or HEIC photo.');

  const id = ulid();
  const at = now();
  const key = kind === 'job' ? `jobs/${jobId}/${id}.${format.ext}` : `receipts/${at.slice(0, 7)}/${id}.${format.ext}`;
  await bucket(env).put(key, body, { httpMetadata: { contentType: format.type } });
  try {
    await env.DB.prepare(
      'INSERT INTO photos (id, object_key, kind, stage, job_id, content_type, bytes, caption, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(id, key, kind, stage, jobId, format.type, body.byteLength, text(q.caption, 'Caption', 200) ?? null, at)
      .run();
  } catch (err) {
    // Don't leave an orphaned object behind if the index write fails.
    await bucket(env).delete(key);
    throw err;
  }
  return toPhoto((await env.DB.prepare('SELECT * FROM photos WHERE id = ?').bind(id).first<PhotoRow>())!);
}

async function getRow(db: D1Database, id: string) {
  const row = await db.prepare('SELECT * FROM photos WHERE id = ?').bind(id).first<PhotoRow>();
  if (!row) throw new ApiError(404, 'not_found', 'No photo with that ID.');
  return row;
}

/** The image itself, owner-only. Cached privately on the device for a day. */
export async function photoResponse(env: Bindings, id: string) {
  const row = await getRow(env.DB, id);
  const obj = await bucket(env).get(row.object_key);
  if (!obj) throw new ApiError(404, 'not_found', 'That photo is missing from storage.');
  return new Response(obj.body, {
    headers: {
      'Content-Type': row.content_type,
      'Content-Length': String(row.bytes),
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function jobPhotos(db: D1Database, jobId: string) {
  const { results } = await db.prepare('SELECT * FROM photos WHERE job_id = ? ORDER BY id').bind(jobId).all<PhotoRow>();
  return results.map(toPhoto);
}

/**
 * Job photos can be deleted. Receipts attached to an entry can't: the IRS
 * expects them kept with the books.
 */
export async function deletePhoto(env: Bindings, id: string) {
  const row = await getRow(env.DB, id);
  const attached = await env.DB.prepare('SELECT 1 FROM entries WHERE receipt_key = ?').bind(id).first();
  if (attached) throw new ApiError(409, 'receipt_in_books', "That receipt is attached to an entry in the books, so it's kept.");
  await env.DB.prepare('DELETE FROM photos WHERE id = ?').bind(id).run();
  await bucket(env).delete(row.object_key);
}

/** A receipt photo id, checked before it's attached to an entry. */
export async function receiptId(db: D1Database, value: unknown): Promise<string | null> {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new ApiError(422, 'invalid', 'receiptKey must be a photo ID.');
  const row = await db.prepare("SELECT 1 FROM photos WHERE id = ? AND kind = 'receipt'").bind(value).first();
  if (!row) throw new ApiError(422, 'invalid', 'No receipt photo with that ID.');
  return value;
}

/** Attach a receipt to an entry after the fact. Receipts aren't money, so this doesn't break "never edit". */
export async function attachReceipt(db: D1Database, entryId: string, body: Record<string, unknown>) {
  const photo = await receiptId(db, body.photoId);
  if (!photo) throw new ApiError(422, 'invalid', 'photoId is required.');
  const { meta } = await db.prepare('UPDATE entries SET receipt_key = ? WHERE id = ?').bind(photo, entryId).run();
  if (meta.changes !== 1) throw new ApiError(404, 'not_found', 'No entry with that ID.');
}
