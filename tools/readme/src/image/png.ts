import { inflateSync } from "node:zlib";
import type { Gray } from "./gray.ts";

/** PNG decode (to luminance over white) and a tiny indexed-colour encoder for dithered prints. */

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

export function decodePngLuma(buf: Uint8Array): Gray {
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
    }
  return { width, height, data };
}

/**
 * zlib stream made of stored (uncompressed) deflate blocks. Real compression would be
 * smaller, but its bytes can change between zlib versions, and the README output must be
 * byte-for-byte reproducible on any Node for `--check` in CI.
 */
function zlibStored(data: Uint8Array): Buffer {
  const parts: Buffer[] = [Buffer.from([0x78, 0x01])];
  const MAX = 0xffff;
  for (let off = 0; off < data.length || off === 0; off += MAX) {
    const block = data.subarray(off, Math.min(off + MAX, data.length));
    const head = Buffer.alloc(5);
    head[0] = off + MAX >= data.length ? 1 : 0;
    head.writeUInt16LE(block.length, 1);
    head.writeUInt16LE(~block.length & 0xffff, 3);
    parts.push(head, Buffer.from(block));
    if (!data.length) break;
  }
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  const adler = Buffer.alloc(4);
  adler.writeUInt32BE(((b << 16) | a) >>> 0);
  parts.push(adler);
  return Buffer.concat(parts);
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/**
 * Encode a 1-bit image (true = ink) as a 2-colour palette PNG, each source pixel
 * scaled up to `scale` x `scale` so it stays crisp even when the browser smooths it.
 */
export function encodeTwoTonePng(bits: Uint8Array, width: number, height: number, scale: number, paper: string, ink: string): Buffer {
  const W = width * scale;
  const H = height * scale;
  const stride = Math.ceil(W / 8);
  const raw = Buffer.alloc((stride + 1) * H);
  for (let y = 0; y < H; y++) {
    const row = y * (stride + 1);
    raw[row] = 0;
    const sy = Math.floor(y / scale);
    for (let x = 0; x < W; x++) {
      const k = row + 1 + (x >> 3);
      if (bits[sy * width + Math.floor(x / scale)]) raw[k] = raw[k]! | (0x80 >> (x & 7));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 1; // bit depth
  ihdr[9] = 3; // indexed colour
  const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const plte = Uint8Array.from([...hex(paper), ...hex(ink)]);
  return Buffer.concat([
    Buffer.from(SIGNATURE),
    chunk("IHDR", ihdr),
    chunk("PLTE", plte),
    chunk("IDAT", zlibStored(raw)),
    chunk("IEND", new Uint8Array(0)),
  ]);
}
