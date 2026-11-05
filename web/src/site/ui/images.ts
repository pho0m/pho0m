import { FRAME_H, FRAME_W, ditherPrint, imageDataFrom, loadImage, negativeOf } from "../../lib/pixel.ts";
import { clearPrint, developingPrint, downsample, photoSource, type PrintSource, type Size } from "../../lib/print.ts";
import type { Pixels, PrintRequest, PrintResponse } from "../../lib/print.worker.ts";

/**
 * Site glue around the shared print pipeline (web/src/lib/print.ts): an image
 * cache, per-source caches so the clear print / negative are computed once, the
 * print worker that computes them off the main thread, and an idle queue (sliced by
 * the idle deadline) for the little main-thread work left, so it never lands in the
 * scroll loop. Without workers (tests, old browsers) the same maths runs here.
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

/* ---- print worker ---------------------------------------------------------------------- */

type Ok = Extract<PrintResponse, { ok: true }>;
type Req = PrintRequest extends infer R ? (R extends unknown ? Omit<R, "id"> : never) : never;
type WorkerError = Error & { unsupported?: boolean };

let worker: Worker | null | undefined;
const pending = new Map<number, { resolve: (r: Ok) => void; reject: (e: WorkerError) => void }>();
let nextId = 1;
/** Cleared when the worker cannot decode images (no OffscreenCanvas there): the page reads them itself. */
let decodeInWorker = true;

const fail = (message: string, unsupported = false): WorkerError => Object.assign(new Error(message), { unsupported });

/** The shared print worker, started on first use; null where workers are unavailable. */
function printWorker(): Worker | null {
  if (worker !== undefined) return worker;
  worker = null;
  if (typeof window === "undefined" || typeof Worker === "undefined") return null;
  try {
    const w = new Worker(new URL("../../lib/print.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (ev: MessageEvent<PrintResponse>) => {
      const r = ev.data;
      const p = pending.get(r.id);
      if (!p) return;
      pending.delete(r.id);
      if (r.ok) p.resolve(r);
      else p.reject(fail(r.error, r.unsupported));
    };
    w.onerror = (ev) => {
      // It could not start (old browser, blocked): do the work on the page from now on.
      ev.preventDefault();
      w.terminate();
      worker = null;
      for (const p of pending.values()) p.reject(fail("print worker failed", true));
      pending.clear();
    };
    worker = w;
  } catch {
    worker = null;
  }
  return worker;
}

function ask(w: Worker, req: Req, transfer: Transferable[] = []): Promise<Ok> {
  const id = nextId++;
  return new Promise<Ok>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ ...req, id }, transfer);
  });
}

const unpack = (p: Pixels): ImageData => imageDataFrom(new Uint8ClampedArray(p.buf), p.w, p.h);
/** A copy of the pixels to hand to the worker (the page keeps its own). */
const packCopy = (d: ImageData): Pixels => ({ w: d.width, h: d.height, buf: d.data.slice().buffer as ArrayBuffer });

/** Store what the worker computed in the per-source caches (clearOf, negativeFor, developingAt read them). */
function adopt(r: Ok, existing?: PrintSource): PrintSource {
  const src: PrintSource = existing ?? {
    data: unpack(r.data!),
    photo: r.photo,
    ditherTone: r.ditherTone,
    clearTone: r.clearTone,
  };
  if (!clears.has(src)) clears.set(src, unpack(r.clear));
  if (r.negative && !negatives.has(src)) negatives.set(src, unpack(r.negative));
  const small = r.smallIsData ? src.data : r.small ? unpack(r.small) : null;
  if (small) smalls.set(src, { ...src, data: small });
  return src;
}

/** What a painter needs computed ahead: the negative (film), the dither input at `dev` size. */
export type FinalsOptions = { negative?: boolean; dev?: Size };

const hasSmall = (src: PrintSource, dev: Size) => {
  const s = smalls.get(src);
  return !!s && s.data.width === dev.w && s.data.height === dev.h;
};

/** Resolve in the next idle slot (see whenIdle). */
const idle = (): Promise<void> => new Promise((resolve) => whenIdle(resolve));

async function finishMissing(src: PrintSource, opts: FinalsOptions): Promise<void> {
  const needClear = !clears.has(src);
  const needNegative = !!opts.negative && !negatives.has(src);
  const dev = opts.dev && !hasSmall(src, opts.dev) ? opts.dev : undefined;
  if (!needClear && !needNegative && !dev) return;
  const w = printWorker();
  if (w) {
    try {
      const data = packCopy(src.data);
      const r = await ask(
        w,
        { op: "finish", data, photo: src.photo, ditherTone: src.ditherTone, clearTone: src.clearTone, negative: needNegative, dev },
        [data.buf],
      );
      adopt(r, src);
      return;
    } catch (err) {
      if (!(err as WorkerError).unsupported) throw err;
    }
  }
  // No worker: the same maths on the page, one piece per idle slot.
  await idle();
  clearOf(src);
  if (needNegative) {
    await idle();
    negativeFor(src);
  }
  if (dev) {
    await idle();
    smalls.set(src, { ...src, data: downsample(src.data, dev.w, dev.h) });
  }
}

const finishing = new WeakMap<PrintSource, Promise<void>>();

/**
 * Make sure the clear print (and, as asked, the negative and the dither input) of a
 * source are computed, in the print worker when there is one. After this resolves,
 * clearOf / negativeFor / developingAt only read caches.
 */
export function ensureFinals(src: PrintSource, opts: FinalsOptions = {}): Promise<void> {
  const next = (finishing.get(src) ?? Promise.resolve()).then(() => finishMissing(src, opts));
  finishing.set(
    src,
    next.catch(() => {}),
  );
  return next;
}

async function loadPhotoSource(url: string, w: number, h: number, opts: FinalsOptions): Promise<PrintSource> {
  const wk = decodeInWorker ? printWorker() : null;
  if (wk) {
    try {
      const abs = new URL(url, document.baseURI).href;
      return adopt(await ask(wk, { op: "photo", url: abs, w, h, negative: !!opts.negative, dev: opts.dev }));
    } catch (err) {
      if (!(err as WorkerError).unsupported) throw err;
      decodeInWorker = false;
    }
  }
  const img = await loadCached(url);
  await idle();
  return photoSource(img, w, h);
}

const photos = new Map<string, Promise<PrintSource>>();

/**
 * Print source for the photo at `url`, w×h, cached per URL and size, with its clear
 * print (and `opts`) ready: fetched, decoded and computed in the print worker when
 * possible. Rejects when the image cannot be loaded or read (CORS).
 */
export function photoPrintSource(url: string, w: number, h: number, opts: FinalsOptions = {}): Promise<PrintSource> {
  const key = `${url}|${w}x${h}`;
  let p = photos.get(key);
  if (!p) {
    p = loadPhotoSource(url, w, h, opts);
    photos.set(key, p);
    p.catch(() => photos.delete(key));
  }
  return p.then(async (src) => {
    await ensureFinals(src, opts);
    return src;
  });
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
 * box-downsampled once and cached (by the worker, see FinalsOptions.dev), so each
 * animation step is one cheap dither pass.
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

type IdleDeadline = { timeRemaining: () => number; didTimeout: boolean };
type IdleWindow = Window & {
  requestIdleCallback?: (cb: (deadline: IdleDeadline) => void, opts?: { timeout: number }) => number;
};

/** A queued job still runs if no idle time comes for this long (they are small: a canvas paint). */
const IDLE_TIMEOUT_MS = 1000;
/** Without requestIdleCallback: work for at most this long per slot. */
const SLICE_MS = 4;

const queue: (() => void)[] = [];
let pumping = false;

function scheduleIdle() {
  const w = (typeof window !== "undefined" ? window : undefined) as IdleWindow | undefined;
  if (w?.requestIdleCallback) w.requestIdleCallback(pump, { timeout: IDLE_TIMEOUT_MS });
  else setTimeout(() => pump(null), 16);
}

function pump(deadline: IdleDeadline | null) {
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const t0 = now();
  // A slot forced by the timeout is not idle time: one job only.
  const left = () => (deadline ? !deadline.didTimeout && deadline.timeRemaining() > 2 : now() - t0 < SLICE_MS);
  // At least one job per slot, more while the idle period lasts.
  do {
    const fn = queue.shift();
    if (!fn) break;
    try {
      fn();
    } catch (err) {
      console.error(err);
    }
  } while (queue.length > 0 && left());
  if (queue.length > 0) scheduleIdle();
  else pumping = false;
}

/**
 * Run `job` when the browser is idle. Jobs run in idle slots, as many per slot as the
 * idle deadline allows, so short paints batch up and nothing runs in an animation frame.
 */
export function whenIdle(job: () => void): void {
  queue.push(job);
  if (pumping) return;
  pumping = true;
  scheduleIdle();
}
