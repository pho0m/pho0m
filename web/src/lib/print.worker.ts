/**
 * Print worker: the heavy part of the darkroom print pipeline (web/src/lib/print.ts)
 * off the main thread, so scrolling and the film animation never wait for it.
 *
 *   "photo"  fetch + decode a photo, cover-fit it (or contain a cut-out logo) and
 *            compute its tones, clear print, negative and dither input
 *   "finish" the same maths for pixels the page already has (generated scenes, or a
 *            photo the page had to read itself)
 *
 * Pixel buffers travel as transferred ArrayBuffers (no copies). The page side is
 * web/src/site/ui/images.ts; without workers it runs the same functions itself.
 */
import { imageDataFrom } from "./pixel.ts";
import { photoSource, printFinals, type PrintSource, type Size, type Tone } from "./print.ts";

/** ImageData as plain transferable parts. */
export type Pixels = { w: number; h: number; buf: ArrayBuffer };

export type PrintRequest =
  | { id: number; op: "photo"; url: string; w: number; h: number; negative: boolean; dev?: Size }
  | {
      id: number;
      op: "finish";
      data: Pixels;
      photo: boolean;
      ditherTone?: Tone;
      clearTone?: Tone;
      negative: boolean;
      dev?: Size;
    };

export type PrintResponse =
  | {
      id: number;
      ok: true;
      /** The source pixels ("photo" only; "finish" leaves them with the page). */
      data?: Pixels;
      photo: boolean;
      ditherTone?: Tone;
      clearTone?: Tone;
      clear: Pixels;
      negative?: Pixels;
      /** Dither input; absent with `smallIsData` when the source already has the dither size. */
      small?: Pixels;
      smallIsData?: boolean;
    }
  | { id: number; ok: false; error: string; /** The worker cannot decode images here: the page should do it. */ unsupported?: boolean };

const pack = (d: ImageData): Pixels => ({ w: d.width, h: d.height, buf: d.data.buffer as ArrayBuffer });
const unpack = (p: Pixels): ImageData => imageDataFrom(new Uint8ClampedArray(p.buf), p.w, p.h);

function canDecode(): boolean {
  if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap !== "function") return false;
  try {
    return new OffscreenCanvas(1, 1).getContext("2d") !== null;
  } catch {
    return false;
  }
}

async function loadPhoto(url: string, w: number, h: number): Promise<PrintSource> {
  // Same request as <img crossorigin="anonymous">: CORS, credentials for the same origin only.
  const res = await fetch(url, { mode: "cors", credentials: "same-origin" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const bitmap = await createImageBitmap(await res.blob());
  try {
    return photoSource(bitmap, w, h);
  } finally {
    bitmap.close();
  }
}

/** Answer one request: the response and the buffers to transfer with it. */
export async function handlePrintRequest(req: PrintRequest): Promise<{ msg: PrintResponse; transfer: Transferable[] }> {
  try {
    let src: PrintSource;
    if (req.op === "photo") {
      if (!canDecode()) return { msg: { id: req.id, ok: false, error: "no OffscreenCanvas in workers", unsupported: true }, transfer: [] };
      src = await loadPhoto(req.url, req.w, req.h);
    } else {
      src = { data: unpack(req.data), photo: req.photo, ditherTone: req.ditherTone, clearTone: req.clearTone };
    }
    const f = printFinals(src, { negative: req.negative, dev: req.dev });
    const smallIsData = f.small === src.data;
    const msg: PrintResponse = {
      id: req.id,
      ok: true,
      photo: src.photo,
      ditherTone: src.ditherTone,
      clearTone: src.clearTone,
      clear: pack(f.clear),
      ...(req.op === "photo" ? { data: pack(src.data) } : {}),
      ...(f.negative ? { negative: pack(f.negative) } : {}),
      ...(f.small && !smallIsData ? { small: pack(f.small) } : {}),
      ...(smallIsData ? { smallIsData } : {}),
    };
    const transfer = [msg.data, msg.clear, msg.negative, msg.small].flatMap((p) => (p ? [p.buf] : []));
    return { msg, transfer };
  } catch (err) {
    return { msg: { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) }, transfer: [] };
  }
}

type Scope = {
  onmessage: ((ev: MessageEvent<PrintRequest>) => void) | null;
  postMessage(msg: PrintResponse, transfer?: Transferable[]): void;
};

// In the worker: answer each message. (Also imported by tests, where `self` is the page.)
const scope = self as unknown as Scope;
scope.onmessage = (ev) => {
  void handlePrintRequest(ev.data).then(({ msg, transfer }) => scope.postMessage(msg, transfer));
};
