/**
 * Finding an item by barcode, three ways:
 *  - typing in the search box and pressing Enter;
 *  - a USB or Bluetooth scanner, which "types" the digits fast and presses
 *    Enter. Into the box that's the same as typing; anywhere else on the tab
 *    (nothing focused) the burst is caught and looked up too;
 *  - the camera, through the browser's BarcodeDetector (Chrome on Android and
 *    Macs). Where it doesn't exist the button simply isn't shown.
 */
import { type Child, h, input, ghost } from './core';

export interface ScanBar {
  el: HTMLElement;
  input: HTMLInputElement;
  /** A line under the box for "found it" or "not known yet". */
  say: (...children: Child[]) => void;
  clear: () => void;
}

export function scanBar(o: { onType: (q: string) => void; onSubmit: (q: string) => void; onCode: (code: string) => void }): ScanBar {
  const box = h('input', {
    class: `${input} text-base`,
    type: 'search',
    placeholder: 'Scan a barcode, or type a name',
    autocomplete: 'off',
    enterkeyhint: 'search',
    'aria-label': 'Scan a barcode, or type a name',
  }) as HTMLInputElement;
  box.addEventListener('input', () => o.onType(box.value));
  box.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    o.onSubmit(box.value.trim());
  });

  const line = h('div', { class: 'mt-2 min-h-5 text-sm text-bone-200', role: 'status' });
  const camera = cameraScanner((code) => o.onCode(code));

  return {
    el: h(
      'div',
      {},
      h('div', { class: 'flex flex-wrap gap-2' }, h('div', { class: 'min-w-0 flex-1 basis-60' }, box), camera?.button ?? null),
      camera?.panel ?? null,
      line,
    ),
    input: box,
    say: (...children) => line.replaceChildren(...children.filter((c): c is Node | string => !!c)),
    clear: () => {
      box.value = '';
      o.onType('');
    },
  };
}

/* ------------------------------------------------ hardware scanners */

let onBurst: ((code: string) => void) | null = null;
let watching: HTMLElement | null = null;
let installed = false;

/**
 * Catch a scanner's burst when nothing is focused. Keys closer than 60ms apart
 * are a scanner; people don't type that fast. The latest render's handler wins.
 */
export function listenForScanner(view: HTMLElement, handler: (code: string) => void) {
  onBurst = handler;
  watching = view;
  if (installed) return;
  installed = true;
  let buf = '';
  let last = 0;
  document.addEventListener('keydown', (e) => {
    if (!watching || watching.hidden || !watching.isConnected) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const at = performance.now();
    if (at - last > 60) buf = '';
    last = at;
    if (e.key === 'Enter') {
      if (buf.length >= 6) {
        e.preventDefault();
        onBurst?.(buf);
      }
      buf = '';
    } else if (e.key.length === 1) {
      buf += e.key;
    }
  });
}

/* ------------------------------------------------ camera */

interface Detected {
  rawValue: string;
}
interface Detector {
  detect(source: HTMLVideoElement): Promise<Detected[]>;
}
interface DetectorClass {
  new (opts: { formats: string[] }): Detector;
  getSupportedFormats(): Promise<string[]>;
}

const WANTED = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'];

let stopActive: (() => void) | null = null;
/** Turn off the camera (e.g. when the tab is redrawn or left). */
export const stopCamera = () => stopActive?.();

function cameraScanner(onCode: (code: string) => void) {
  const Detector = (globalThis as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
  if (!Detector || !navigator.mediaDevices?.getUserMedia) return null;

  const button = h('button', { type: 'button', class: `${ghost} shrink-0 py-2` }, 'Use camera') as HTMLButtonElement;
  const video = h('video', { class: 'block aspect-[4/3] w-full bg-ink-900 object-cover', muted: true, playsInline: true }) as HTMLVideoElement;
  video.setAttribute('playsinline', '');
  const note = h('p', { class: 'text-sm text-bone-400' }, 'Hold the barcode inside the box.');
  const stop = h('button', { type: 'button', class: ghost }, 'Stop camera');
  const panel = h(
    'div',
    { class: 'mt-3 max-w-sm border border-ink-700', hidden: true },
    h('div', { class: 'relative' }, video, h('div', { class: 'pointer-events-none absolute inset-x-[12%] top-1/2 h-1/3 -translate-y-1/2 border-2 border-gold-500/80' })),
    h('div', { class: 'flex items-center justify-between gap-3 p-3' }, note, stop),
  );

  let stream: MediaStream | null = null;
  let timer = 0;
  const end = () => {
    window.clearTimeout(timer);
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    video.srcObject = null;
    panel.hidden = true;
    button.disabled = false;
    if (stopActive === end) stopActive = null;
  };
  stop.addEventListener('click', end);

  button.addEventListener('click', async () => {
    stopCamera();
    button.disabled = true;
    try {
      const supported = await Detector.getSupportedFormats();
      const formats = WANTED.filter((f) => supported.includes(f));
      if (!formats.length) throw new Error("This browser can't read barcodes with the camera.");
      const detector = new Detector({ formats });
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      stopActive = end;
      video.srcObject = stream;
      panel.hidden = false;
      note.textContent = 'Hold the barcode inside the box.';
      await video.play();
      const look = async () => {
        if (!stream) return;
        if (!panel.isConnected || panel.closest<HTMLElement>('[hidden]')) return end();
        try {
          const [hit] = await detector.detect(video);
          if (hit?.rawValue) {
            end();
            onCode(hit.rawValue);
            return;
          }
        } catch {
          // A frame that isn't ready yet; try the next one.
        }
        timer = window.setTimeout(look, 200);
      };
      look();
    } catch (err) {
      end();
      panel.hidden = false;
      const name = (err as DOMException).name;
      note.textContent =
        name === 'NotAllowedError' ? 'The camera is blocked. Allow it in the browser settings, then try again.' : name === 'NotFoundError' ? 'No camera found on this device.' : (err as Error).message;
    }
  });

  return { button, panel };
}
