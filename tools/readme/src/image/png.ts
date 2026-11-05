import { inflateSync } from "node:zlib";
import { zlibDeflate } from "./deflate.ts";
import type { Gray } from "./gray.ts";

/** PNG decode (to luminance over white) and small deterministic encoders for the prints. */

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function isPng(buf: Uint8Array): boolean {
  return SIGNATURE.every((b, i) => buf[i] === b);
}

/** Luminance over white; `cutout` is true when a corner is see-through (a cut-out logo). */
export function decodePngLuma(buf: Uint8Array): Gray & { cutout: boolean } {
  if (!isPng(buf)) throw new Error("not a PNG");
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 8;
  let colorType = 0;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (pos + 8 <= buf.length) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(...buf.subarray(pos + 4, pos + 8));
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = view.getUint32(pos + 8);
      height = view.getUint32(pos + 12);
      depth = data[8]!;
      colorType = data[9]!;
      if (data[12] !== 0) throw new Error("PNG: interlaced files are not supported");
    } else if (type === "PLTE") palette = data;
    else if (type === "tRNS") trns = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels || !width || !height) throw new Error("PNG: unsupported colour type");
  const raw = inflateSync(Buffer.concat(idat));
  const bitsPerPixel = channels * depth;
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const pixels = new Uint8Array(stride * height);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = pixels.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp]! : 0;
      const b = prev[i]!;
      const c = i >= bpp ? prev[i - bpp]! : 0;
      const x = line[i]!;
      let v: number;
      if (filter === 0) v = x;
      else if (filter === 1) v = x + a;
      else if (filter === 2) v = x + b;
      else if (filter === 3) v = x + ((a + b) >> 1);
      else {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      cur[i] = v & 0xff;
    }
    prev = cur;
  }
  const max = (1 << depth) - 1;
  const sampleAt = (y: number, index: number): number => {
    const row = y * stride;
    if (depth === 8) return pixels[row + index]!;
    if (depth === 16) return pixels[row + index * 2]!;
    const bit = index * depth;
    return (pixels[row + (bit >> 3)]! >> (8 - depth - (bit & 7))) & max;
  };
  const scale = depth === 16 ? 1 : 255 / max;
  const data = new Float32Array(width * height);
  let cutout = false;
  const corner = (x: number, y: number) => (x === 0 || x === width - 1) && (y === 0 || y === height - 1);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let r: number, g: number, b: number;
      let a = 255;
      if (colorType === 3) {
        const i = sampleAt(y, x);
        r = palette?.[i * 3] ?? 0;
        g = palette?.[i * 3 + 1] ?? 0;
        b = palette?.[i * 3 + 2] ?? 0;
        a = trns?.[i] ?? 255;
      } else if (colorType === 0 || colorType === 4) {
        r = g = b = sampleAt(y, x * channels) * scale;
        if (colorType === 4) a = sampleAt(y, x * channels + 1) * scale;
      } else {
        r = sampleAt(y, x * channels) * scale;
        g = sampleAt(y, x * channels + 1) * scale;
        b = sampleAt(y, x * channels + 2) * scale;
        if (colorType === 6) a = sampleAt(y, x * channels + 3) * scale;
      }
      const lum = (r * 0.3 + g * 0.59 + b * 0.11) / 255;
      const alpha = a / 255;
      data[y * width + x] = lum * alpha + (1 - alpha);
      if (a < 250 && corner(x, y)) cutout = true;
    }
  return { width, height, data, cutout };
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

const hexRgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** Paeth predictor (PNG filter type 4). */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Filter scanlines. 8-bit greyscale rows get the filter with the smallest sum of absolute
 * residuals (the usual heuristic); palette and sub-byte images use filter 0 as the spec advises.
 */
function filterRows(rows: Uint8Array, stride: number, height: number, adaptive: boolean): Uint8Array {
  const out = new Uint8Array((stride + 1) * height);
  const zero = new Uint8Array(stride);
  const cand = Array.from({ length: 5 }, () => new Uint8Array(stride));
  for (let y = 0; y < height; y++) {
    const cur = rows.subarray(y * stride, (y + 1) * stride);
    const prev = y ? rows.subarray((y - 1) * stride, y * stride) : zero;
    let best = 0;
    if (adaptive) {
      let bestSum = Infinity;
      for (let f = 0; f < 5; f++) {
        const line = cand[f]!;
        let sum = 0;
        for (let i = 0; i < stride; i++) {
          const a = i ? cur[i - 1]! : 0;
          const b = prev[i]!;
          const c = i ? prev[i - 1]! : 0;
          const x = cur[i]!;
          const v = (f === 0 ? x : f === 1 ? x - a : f === 2 ? x - b : f === 3 ? x - ((a + b) >> 1) : x - paeth(a, b, c)) & 0xff;
          line[i] = v;
          sum += v < 128 ? v : 256 - v;
        }
        if (sum < bestSum) {
          bestSum = sum;
          best = f;
        }
      }
    } else cand[0]!.set(cur);
    out[y * (stride + 1)] = best;
    out.set(cand[best]!, y * (stride + 1) + 1);
  }
  return out;
}

function pngFile(width: number, height: number, depth: number, colorType: number, filtered: Uint8Array, plte?: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = depth;
  ihdr[9] = colorType;
  return Buffer.concat([
    Buffer.from(SIGNATURE),
    chunk("IHDR", ihdr),
    ...(plte ? [chunk("PLTE", plte)] : []),
    chunk("IDAT", zlibDeflate(filtered)),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

/**
 * Palette PNG from colour indices (0..palette.length-1), each pixel scaled up to
 * `scale` x `scale` (nearest) so pixel art stays crisp even where the browser smooths images.
 */
export function encodeIndexedPng(indices: Uint8Array, width: number, height: number, palette: readonly string[], scale = 1): Buffer {
  if (palette.length < 1 || palette.length > 256) throw new Error("PNG: palette needs 1..256 colours");
  const depth = palette.length <= 2 ? 1 : palette.length <= 4 ? 2 : palette.length <= 16 ? 4 : 8;
  const W = width * scale;
  const H = height * scale;
  const stride = Math.ceil((W * depth) / 8);
  const rows = new Uint8Array(stride * H);
  const perByte = 8 / depth;
  for (let y = 0; y < H; y++) {
    const sy = Math.floor(y / scale);
    for (let x = 0; x < W; x++) {
      const v = indices[sy * width + Math.floor(x / scale)]! & ((1 << depth) - 1);
      const k = y * stride + Math.floor(x / perByte);
      rows[k] = rows[k]! | (v << (8 - depth - (x % perByte) * depth));
    }
  }
  const plte = Uint8Array.from(palette.flatMap(hexRgb));
  return pngFile(W, H, depth, 3, filterRows(rows, stride, H, false), plte);
}

/** 8-bit greyscale PNG (0 = black … 255 = white), scaled up `scale` x `scale` (nearest). */
export function encodeGrayPng(levels: Uint8Array, width: number, height: number, scale = 1): Buffer {
  const W = width * scale;
  const H = height * scale;
  const rows = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const sy = Math.floor(y / scale);
    for (let x = 0; x < W; x++) rows[y * W + x] = levels[sy * width + Math.floor(x / scale)]!;
  }
  return pngFile(W, H, 8, 0, filterRows(rows, W, H, true));
}

/** A 1-bit image (1 = ink) as a two-colour palette PNG, each pixel scaled up to `scale` x `scale`. */
export function encodeTwoTonePng(bits: Uint8Array, width: number, height: number, scale: number, paper: string, ink: string): Buffer {
  return encodeIndexedPng(bits, width, height, [paper, ink], scale);
}
