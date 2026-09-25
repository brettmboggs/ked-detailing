/**
 * Photos in the Website tab: show one, upload a new one, or pick one of the
 * site's own photos.
 *
 * Uploads are shrunk in the browser first (longest side 2400 px, JPEG), which
 * also turns an iPhone's HEIC into something every browser shows. The API
 * keeps them private until a save puts them on the site; the build then
 * copies and resizes them into the site itself.
 */
import { withBase } from '../../lib/url';
import { isUpload, type PhotoRef } from '../../lib/site-content';
import { API, Failed, h, ghost, token, showError, clearError } from './core';
import { changed, labelRow, resetLink } from './website-fields';

const MAX_SIDE = 2400;
const MAX_BYTES = 5 * 1024 * 1024;

/** Previews of photos uploaded in this visit, before the site can show them. */
const local = new Map<string, string>();

export function photoUrl(ref: PhotoRef): string {
  if (isUpload(ref)) return local.get(ref) ?? `${API}/v1/site/photos/${ref}`;
  return withBase(`/site-photos/${ref.replace(/\.jpg$/, '')}-400.webp`);
}

/** A phone photo resized to 2400px on its longest side, as JPEG. Job photos use it too. */
export async function shrink(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Failed("That file didn't open as a photo. Try a JPEG or PNG.");
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!blob) throw new Failed("That photo couldn't be prepared. Try another one.");
  if (blob.size > MAX_BYTES) throw new Failed('That photo is too big, even after shrinking it. Try another one.');
  return blob;
}

async function upload(file: File): Promise<string> {
  const blob = await shrink(file);
  const res = await fetch(`${API}/v1/site/photos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: blob,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Failed(body?.error?.message ?? `The upload didn't work (${res.status}).`);
  local.set(body.id, URL.createObjectURL(blob));
  return body.id as string;
}

let library: Promise<string[]> | undefined;
const loadLibrary = () =>
  (library ??= fetch(withBase('/site-photos/library.json'))
    .then((r) => (r.ok ? r.json() : { photos: [] }))
    .then((b: { photos: string[] }) => b.photos)
    .catch(() => []));

/**
 * A photo with Upload and Pick buttons. `original` null hides the reset link
 * (photos inside a list reset with the list).
 */
export function photoField(label: string, get: () => PhotoRef, set: (v: PhotoRef) => void, original: PhotoRef | null, alt: () => string) {
  const img = h('img', { class: 'aspect-[4/3] w-full max-w-72 border border-ink-800 bg-ink-900 object-cover', alt: '' }) as HTMLImageElement;
  const status = h('p', { class: 'text-sm text-bone-400', role: 'status' });
  const picker = h('div', { class: 'sm:col-span-2' });
  const show = () => {
    img.src = photoUrl(get());
    img.alt = alt();
  };
  const choose = (ref: PhotoRef) => {
    set(ref);
    show();
    changed();
  };

  const file = h('input', { type: 'file', accept: 'image/*', class: 'sr-only' }) as HTMLInputElement;
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    clearError();
    status.textContent = 'Uploading…';
    try {
      choose(await upload(f));
      status.textContent = 'Uploaded. Press Save to put it on the website.';
    } catch (err) {
      status.textContent = '';
      showError(err);
    }
  });

  const openPicker = async () => {
    if (picker.childElementCount) return picker.replaceChildren();
    const photos = await loadLibrary();
    if (!photos.length) {
      picker.replaceChildren(h('p', { class: 'text-sm text-bone-500' }, "Your photos can't be listed right now."));
      return;
    }
    picker.replaceChildren(
      h('p', { class: 'mb-2 text-sm text-bone-400' }, 'Tap a photo to use it.'),
      h(
        'div',
        { class: 'flex flex-wrap gap-2' },
        ...photos.map((name) =>
          h(
            'button',
            {
              type: 'button',
              class: 'border border-ink-800 transition-colors hover:border-gold-500 focus-visible:border-gold-500 focus-visible:outline-none',
              'aria-label': `Use ${name.replace(/\.jpg$/, '').replace(/-/g, ' ')}`,
              onclick: () => {
                choose(name);
                picker.replaceChildren();
              },
            },
            h('img', { src: photoUrl(name), alt: '', loading: 'lazy', class: 'block h-16 w-24 object-cover' }),
          ),
        ),
      ),
    );
  };

  const reset = original === null ? null : resetLink(() => get() !== original, () => (set(original), show()));
  show();
  return h(
    'div',
    { class: 'grid gap-3 sm:col-span-2 sm:grid-cols-[18rem_1fr] sm:items-start' },
    h('div', { class: 'flex flex-col gap-1' }, labelRow(label, reset), img),
    h(
      'div',
      { class: 'flex flex-col items-start gap-3 sm:pt-6' },
      h('label', { class: `${ghost} cursor-pointer focus-within:border-gold-500` }, 'Upload a new photo', file),
      h('button', { type: 'button', class: ghost, onclick: openPicker }, 'Pick one of your photos'),
      status,
    ),
    picker,
  );
}
