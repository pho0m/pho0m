import { FRAME_H, FRAME_W, ditherPrint, loadImage, negativeOf } from "../../lib/pixel.ts";
import { clearPrint, developingPrint, downsample, photoSource, type PrintSource } from "../../lib/print.ts";

/**
 * Site glue around the shared print pipeline (web/src/lib/print.ts): an image
 * cache, per-source caches so the clear print / negative are computed once, and
 * an idle queue so that work never lands in the scroll loop.
 */

const images = new Map<string, Promise<HTMLImageElement>>();

/** loadImage() with a per-URL cache; failed loads are forgotten so they can be retried. */
export function loadCached(url: string): Promise<HTMLImageElement> {
  let p = images.get(url);
  if (!p) {
    p = loadImage(url);
    images.set(url, p);
    p.catch(() => images.delete(url));
  }
  return p;
}

const natural = (img: HTMLImageElement) => ({
  w: img.naturalWidth || img.width || 1,
  h: img.naturalHeight || img.height || 1,
});

/** Height for a target width keeping the image's natural aspect (bounded). */
export function naturalHeight(img: HTMLImageElement, w: number, minAspect = 0.5, maxAspect = 2): number {
  const { w: sw, h: sh } = natural(img);
  const ratio = Math.min(maxAspect, Math.max(minAspect, sw / sh));
  return Math.max(1, Math.round(w / ratio));
}

/**
 * Size of the clear print for a photo shown `width` dither-pixels wide at `aspect`
 * (w/h): about 3× the dither, at most `max` px wide, never wider than the part of
 * the photo a cover-fit actually uses (no upscaling).
 */
export function clearSize(img: HTMLImageElement, width: number, aspect: number, max = 640): { w: number; h: number } {
  const { w: sw, h: sh } = natural(img);
  const used = Math.min(sw, sh * aspect);
  const w = Math.max(width, Math.min(max, Math.round(width * 3.2), Math.round(used)));
  return { w, h: Math.max(1, Math.round(w / aspect)) };
}

const photos = new Map<string, Promise<PrintSource>>();

/** Cached photoSource() for a URL at w×h. Rejects when the image cannot be loaded or read (CORS). */
export function photoPrintSource(url: string, w: number, h: number): Promise<PrintSource> {
  const key = `${url}|${w}x${h}`;
  let p = photos.get(key);
  if (!p) {
    p = loadCached(url).then((img) => photoSource(img, w, h));
    photos.set(key, p);
    p.catch(() => photos.delete(key));
  }
  return p;
}

const clears = new WeakMap<PrintSource, ImageData>();
const negatives = new WeakMap<PrintSource, ImageData>();
const smalls = new WeakMap<PrintSource, PrintSource>();

/** The finished clear print of a source, computed once. */
export function clearOf(src: PrintSource): ImageData {
  let c = clears.get(src);
  if (!c) {
    c = clearPrint(src);
    clears.set(src, c);
  }
  return c;
}

/** The red safelight negative (same as negativePrint), computed once from the cached clear print. */
export function negativeFor(src: PrintSource): ImageData {
  let c = negatives.get(src);
  if (!c) {
    c = negativeOf(clearOf(src));
    negatives.set(src, c);
  }
  return c;
}

/**
 * The developing dither at w×h (default: the film frame size). A big photo is
 * box-downsampled once and cached, so each animation step is one cheap dither pass.
 */
export function developingAt(src: PrintSource, level: number, out?: ImageData, w = FRAME_W, h = FRAME_H): ImageData {
  let small = smalls.get(src);
  if (!small || small.data.width !== w || small.data.height !== h) {
    small = { ...src, data: downsample(src.data, w, h) };
    smalls.set(src, small);
  }
  if (w === FRAME_W && h === FRAME_H) return developingPrint(small, level, out);
  // developingPrint() is fixed to the film frame size; other shapes (avatar 4:5…) get the same dither at their own size.
  return ditherPrint(small.data, { ...src.ditherTone, level }, out);
}

/* ------------------------------------------------------------------------------------------ */

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
};

const queue: (() => void)[] = [];
let pumping = false;

/** Run `job` when the browser is idle, one job per idle slot (keeps long print maths out of animation frames). */
export function whenIdle(job: () => void): void {
  queue.push(job);
  if (pumping) return;
  pumping = true;
  const w = (typeof window !== "undefined" ? window : undefined) as IdleWindow | undefined;
  const next = () => {
    const fn = queue.shift();
    if (!fn) {
      pumping = false;
      return;
    }
    try {
      fn();
    } finally {
      if (w?.requestIdleCallback) w.requestIdleCallback(next, { timeout: 300 });
      else setTimeout(next, 16);
    }
  };
  if (w?.requestIdleCallback) w.requestIdleCallback(next, { timeout: 300 });
  else setTimeout(next, 0);
}
