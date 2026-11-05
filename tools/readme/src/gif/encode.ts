import { createRequire } from "node:module";

/**
 * Animated GIF writer on top of gifenc (pure JS LZW, so the bytes are the same on every
 * machine). Frames are full-canvas index buffers over one global palette. Every frame after
 * the first is cropped to the rectangle that changed, and inside it unchanged pixels use the
 * transparent index (the previous frame stays underneath), which keeps the file small.
 */

type GifEncoder = {
  writeFrame(
    index: Uint8Array,
    width: number,
    height: number,
    opts: {
      palette?: number[][];
      delay?: number;
      repeat?: number;
      transparent?: boolean;
      transparentIndex?: number;
      dispose?: number;
    },
  ): void;
  finish(): void;
  bytes(): Uint8Array;
  bytesView(): Uint8Array;
};

// Loaded through require so Node and Vitest both get the same CommonJS build.
const { GIFEncoder } = createRequire(import.meta.url)("gifenc") as { GIFEncoder: () => GifEncoder };

export type GifFrame = { pixels: Uint8Array; /** milliseconds (GIF stores hundredths) */ delay: number };

export type GifOptions = {
  width: number;
  height: number;
  /** Up to 256 [r, g, b] colours. */
  palette: [number, number, number][];
  /** Palette index that is never drawn: see-through in the first frame, "unchanged" after it. */
  transparentIndex: number;
};

/** Merge consecutive identical frames (their delays add up). */
export function mergeStill(frames: GifFrame[]): GifFrame[] {
  const out: GifFrame[] = [];
  for (const f of frames) {
    const last = out[out.length - 1];
    if (last && sameBytes(last.pixels, f.pixels)) last.delay += f.delay;
    else out.push({ pixels: f.pixels, delay: f.delay });
  }
  return out;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Bounding box of the pixels that differ between two frames, or null when they are identical. */
export function changedBox(a: Uint8Array, b: Uint8Array, width: number): { x: number; y: number; w: number; h: number } | null {
  const height = a.length / width;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (a[row + x] === b[row + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Encode frames as a looping (forever) GIF89a. */
export function encodeGif(frames: GifFrame[], o: GifOptions): Uint8Array {
  if (!frames.length) throw new Error("GIF needs at least one frame");
  if (o.palette.length > 256) throw new Error("GIF palette is limited to 256 colours");
  const enc = GIFEncoder();
  let prev: Uint8Array | null = null;
  frames.forEach((f) => {
    const opts = { delay: f.delay, repeat: 0, transparent: true, transparentIndex: o.transparentIndex, dispose: 1 };
    if (!prev) {
      enc.writeFrame(f.pixels, o.width, o.height, { ...opts, palette: o.palette });
      prev = f.pixels;
      return;
    }
    // an unchanged frame still needs its delay: keep one transparent pixel
    const box = changedBox(prev, f.pixels, o.width) ?? { x: 0, y: 0, w: 1, h: 1 };
    const sub = new Uint8Array(box.w * box.h);
    for (let y = 0; y < box.h; y++)
      for (let x = 0; x < box.w; x++) {
        const k = (box.y + y) * o.width + box.x + x;
        sub[y * box.w + x] = f.pixels[k] === prev[k] ? o.transparentIndex : f.pixels[k]!;
      }
    const start = enc.bytesView().length;
    enc.writeFrame(sub, box.w, box.h, opts);
    // gifenc always places images at 0,0: set the image descriptor's left/top (it follows the
    // 8-byte graphic control extension, GIF89a §23 and §20)
    const view = enc.bytesView();
    if (view[start] !== 0x21 || view[start + 1] !== 0xf9 || view[start + 8] !== 0x2c) throw new Error("GIF: unexpected frame layout");
    view[start + 9] = box.x & 0xff;
    view[start + 10] = box.x >> 8;
    view[start + 11] = box.y & 0xff;
    view[start + 12] = box.y >> 8;
    prev = f.pixels;
  });
  enc.finish();
  return enc.bytes();
}
