import type { IconName } from "@pho0m/content";
import {
  FRAME_H,
  FRAME_W,
  PRINT_H,
  PRINT_W,
  createImageData,
  ditherPrint,
  iconScene,
  naturalSize,
  negativeOf,
  scratchContext,
  sourceToImageData,
  tonePrint,
  type PixelImage,
} from "./pixel.ts";

/**
 * One print pipeline for the site and the admin preview.
 *
 *   developing  → two-tone ordered dither at FRAME_W×FRAME_H (the "coming up in the tray" effect)
 *   clear       → continuous-tone duotone print (sharp; photos at PRINT_W×PRINT_H)
 *   negative    → red safelight negative of the clear print
 *
 * The effect stays (flash → dither develops → DEV/STOP/FIX/DRY) and the finished
 * print is clear instead of a coarse dither.
 *
 * Everything here is plain pixel maths on ImageData, so it also runs in the print
 * worker (web/src/lib/print.worker.ts), which the site uses to keep it off the main thread.
 */

export type Tone = { black: number; white: number };
export type PrintSource = {
  /** Full-resolution source pixels (PRINT size for photos, FRAME size for pixel-art scenes). */
  data: ImageData;
  /** true for photos (show smooth), false for pixel art (show pixelated). */
  photo: boolean;
  /** Auto-levels for the dither and for the clear print. */
  ditherTone?: Tone;
  clearTone?: Tone;
};

/** True when the image has see-through corners (a cut-out logo). Throws on tainted (non-CORS) images. */
export function hasTransparentEdges(img: PixelImage): boolean {
  let ctx: ReturnType<typeof scratchContext>;
  try {
    ctx = scratchContext(8, 8);
  } catch {
    return false;
  }
  ctx.drawImage(img, 0, 0, 8, 8);
  const d = ctx.getImageData(0, 0, 8, 8).data;
  return [0, 7, 56, 63].some((p) => d[p * 4 + 3]! < 250);
}

/** Contain-fit a cut-out image on white paper with a small margin. */
export function containOnPaper(img: PixelImage, w: number, h: number): ImageData {
  const ctx = scratchContext(w, h);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  const { w: sw, h: sh } = naturalSize(img);
  const scale = Math.min((w * 0.84) / sw, (h * 0.84) / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  return ctx.getImageData(0, 0, w, h);
}

/** Percentile auto-levels: the darkest/lightest `clip` share maps to full ink/paper. */
export function autoTone(src: ImageData, clip = 0.12, minSpan = 0.35): Tone {
  const hist = new Uint32Array(256);
  const d = src.data;
  for (let k = 0; k < d.length; k += 4) hist[Math.round(d[k]! * 0.3 + d[k + 1]! * 0.59 + d[k + 2]! * 0.11)]!++;
  const total = d.length / 4;
  const at = (q: number) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v]!;
      if (acc >= q * total) return v / 255;
    }
    return 1;
  };
  let black = at(clip);
  let white = at(1 - clip);
  if (white - black < minSpan) {
    const mid = (white + black) / 2;
    black = Math.max(0, mid - minSpan / 2);
    white = Math.min(1, mid + minSpan / 2);
  }
  return { black, white };
}

/** Box-filter downsample (used to feed the low-res developing dither from a big photo). */
export function downsample(src: ImageData, w: number, h: number): ImageData {
  if (src.width === w && src.height === h) return src;
  const o = createImageData(w, h);
  const fx = src.width / w;
  const fy = src.height / h;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * fx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * fx));
      const y0 = Math.floor(y * fy);
      const y1 = Math.max(y0 + 1, Math.floor((y + 1) * fy));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let yy = y0; yy < y1 && yy < src.height; yy++)
        for (let xx = x0; xx < x1 && xx < src.width; xx++) {
          const k = (yy * src.width + xx) * 4;
          r += src.data[k]!;
          g += src.data[k + 1]!;
          b += src.data[k + 2]!;
          n++;
        }
      const k = (y * w + x) * 4;
      o.data[k] = r / n;
      o.data[k + 1] = g / n;
      o.data[k + 2] = b / n;
      o.data[k + 3] = 255;
    }
  return o;
}

/** Photo (or cut-out logo) → print source. Throws when the canvas cannot be read (CORS). */
export function photoSource(img: PixelImage, w = PRINT_W, h = PRINT_H): PrintSource {
  if (hasTransparentEdges(img)) {
    const data = containOnPaper(img, w, h);
    return { data, photo: true };
  }
  const data = sourceToImageData(img, w, h);
  return { data, photo: true, ditherTone: autoTone(data, 0.12, 0.35), clearTone: autoTone(data, 0.01, 0.5) };
}

/** Generated pixel-art scene for a frame without photos (time of day t: 0 dawn … 1 night). */
export function iconSource(icon: IconName, t: number, seed = 0): PrintSource {
  return { data: iconScene(icon, t, seed), photo: false };
}

/** The developing print: ordered dither at FRAME size, `level` 0 → 1. */
export function developingPrint(src: PrintSource, level: number, out?: ImageData): ImageData {
  const small = src.data.width === FRAME_W && src.data.height === FRAME_H ? src.data : downsample(src.data, FRAME_W, FRAME_H);
  return ditherPrint(small, { ...src.ditherTone, level }, out);
}

/** The finished print: clear continuous-tone duotone at the source's resolution. */
export function clearPrint(src: PrintSource, level = 1, out?: ImageData): ImageData {
  return tonePrint(src.data, { ...src.clearTone, level, grain: src.photo ? 0.035 : 0, contrast: src.photo ? 0.3 : 0.15 }, out);
}

/** Red safelight negative of the clear print. */
export function negativePrint(src: PrintSource): ImageData {
  return negativeOf(clearPrint(src));
}

export type Size = { w: number; h: number };
/** The finished pieces of a print: what the site paints, computed in one go (in the print worker). */
export type PrintFinals = {
  /** clearPrint(src) */
  clear: ImageData;
  /** negativeOf(clear), when asked for */
  negative?: ImageData;
  /** The source box-downsampled to `dev` size: input of the developing dither, when asked for. */
  small?: ImageData;
};

/** Clear print, and optionally its negative and the downsampled dither input, of a source. */
export function printFinals(src: PrintSource, opts: { negative?: boolean; dev?: Size } = {}): PrintFinals {
  const clear = clearPrint(src);
  const out: PrintFinals = { clear };
  if (opts.negative) out.negative = negativeOf(clear);
  if (opts.dev) out.small = downsample(src.data, opts.dev.w, opts.dev.h);
  return out;
}

/** CSS image-rendering for a canvas showing this source's clear print. */
export function renderingFor(src: PrintSource): "auto" | "pixelated" {
  return src.photo ? "auto" : "pixelated";
}
