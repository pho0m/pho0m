import { createRequire } from "node:module";

/**
 * Animated GIF writer on top of gifenc (pure JS LZW, so the bytes are the same on every
 * machine). Frames are full-canvas index buffers over one global palette; every frame after
 * the first only paints what changed (unchanged pixels use the transparent index and the
 * previous frame stays underneath), which keeps the file small.
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

/** Encode frames as a looping (forever) GIF89a. */
export function encodeGif(frames: GifFrame[], o: GifOptions): Uint8Array {
  if (!frames.length) throw new Error("GIF needs at least one frame");
  if (o.palette.length > 256) throw new Error("GIF palette is limited to 256 colours");
  const enc = GIFEncoder();
  let prev: Uint8Array | null = null;
  frames.forEach((f, i) => {
    let px = f.pixels;
    if (prev) {
      px = new Uint8Array(f.pixels);
      for (let k = 0; k < px.length; k++) if (px[k] === prev[k]) px[k] = o.transparentIndex;
    }
    enc.writeFrame(px, o.width, o.height, {
      palette: i === 0 ? o.palette : undefined,
      delay: f.delay,
      repeat: 0,
      transparent: true,
      transparentIndex: o.transparentIndex,
      dispose: 1,
    });
    prev = f.pixels;
  });
  enc.finish();
  return enc.bytes();
}
