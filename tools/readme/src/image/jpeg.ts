import type { Gray } from "./gray.ts";

/**
 * Small baseline JPEG decoder (SOF0/SOF1, Huffman, 8-bit) that returns luminance only.
 * The README needs a two-tone print of the avatar, so colour is never reconstructed.
 * Progressive and arithmetic-coded files throw; callers fall back to another rendering.
 */

const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21,
  28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61,
  54, 47, 55, 62, 63,
];

/** cos table for the separable IDCT: COS[x * 8 + u] = C(u) * cos((2x + 1) u π / 16) / 2 */
const COS = (() => {
  const t = new Float64Array(64);
  for (let x = 0; x < 8; x++)
    for (let u = 0; u < 8; u++) t[x * 8 + u] = ((u === 0 ? Math.SQRT1_2 : 1) * Math.cos(((2 * x + 1) * u * Math.PI) / 16)) / 2;
  return t;
})();

type Huffman = { maxCode: Int32Array; valPtr: Int32Array; minCode: Int32Array; values: Uint8Array };
type Component = {
  id: number;
  h: number;
  v: number;
  tq: number;
  blocksPerLine: number;
  blocksPerColumn: number;
  plane: Uint8Array;
  pred: number;
  dc?: Huffman;
  ac?: Huffman;
};

function buildHuffman(counts: Uint8Array, values: Uint8Array): Huffman {
  const maxCode = new Int32Array(18).fill(-1);
  const minCode = new Int32Array(17);
  const valPtr = new Int32Array(17);
  let code = 0;
  let k = 0;
  for (let len = 1; len <= 16; len++) {
    const n = counts[len - 1]!;
    if (n) {
      valPtr[len] = k;
      minCode[len] = code;
      code += n;
      k += n;
      maxCode[len] = code - 1;
    }
    code <<= 1;
  }
  return { maxCode, valPtr, minCode, values };
}

class BitReader {
  private bits = 0;
  private count = 0;
  constructor(
    private readonly buf: Uint8Array,
    public pos: number,
  ) {}
  private fill(): void {
    let b = 0;
    if (this.pos < this.buf.length) {
      b = this.buf[this.pos]!;
      if (b === 0xff) {
        const next = this.buf[this.pos + 1] ?? 0;
        if (next === 0x00) this.pos += 2;
        else b = 0; // a marker: feed zeros and leave it for the caller
      } else this.pos++;
    }
    this.bits = b;
    this.count = 8;
  }
  bit(): number {
    if (this.count === 0) this.fill();
    this.count--;
    return (this.bits >> this.count) & 1;
  }
  receive(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | this.bit();
    return v;
  }
  decode(h: Huffman): number {
    let code = 0;
    for (let len = 1; len <= 16; len++) {
      code = (code << 1) | this.bit();
      if (code <= h.maxCode[len]!) return h.values[h.valPtr[len]! + code - h.minCode[len]!]!;
    }
    throw new Error("JPEG: bad Huffman code");
  }
  /** Drop leftover bits and step over an RSTn marker. */
  restart(): void {
    this.count = 0;
    while (this.pos + 1 < this.buf.length && !(this.buf[this.pos] === 0xff && this.buf[this.pos + 1]! >= 0xd0 && this.buf[this.pos + 1]! <= 0xd7)) {
      this.pos++;
    }
    this.pos += 2;
  }
}

const extend = (v: number, s: number) => (s === 0 ? 0 : v < 1 << (s - 1) ? v - (1 << s) + 1 : v);

function decodeBlock(r: BitReader, c: Component, q: Uint16Array, out: Float64Array): void {
  out.fill(0);
  const t = r.decode(c.dc!);
  c.pred += extend(r.receive(t), t);
  out[0] = c.pred * q[0]!;
  for (let k = 1; k < 64; ) {
    const rs = r.decode(c.ac!);
    const s = rs & 15;
    const run = rs >> 4;
    if (s === 0) {
      if (run !== 15) break;
      k += 16;
      continue;
    }
    k += run;
    if (k > 63) break;
    out[ZIGZAG[k]!] = extend(r.receive(s), s) * q[k]!;
    k++;
  }
}

const tmp = new Float64Array(64);
function idctInto(coef: Float64Array, plane: Uint8Array, stride: number, x0: number, y0: number): void {
  for (let v = 0; v < 8; v++)
    for (let x = 0; x < 8; x++) {
      let s = 0;
      for (let u = 0; u < 8; u++) s += coef[v * 8 + u]! * COS[x * 8 + u]!;
      tmp[v * 8 + x] = s;
    }
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      let s = 0;
      for (let v = 0; v < 8; v++) s += tmp[v * 8 + x]! * COS[y * 8 + v]!;
      const val = Math.round(s + 128);
      plane[(y0 + y) * stride + x0 + x] = val < 0 ? 0 : val > 255 ? 255 : val;
    }
}

function exifOrientation(seg: Uint8Array): number {
  if (seg.length < 14 || String.fromCharCode(...seg.subarray(0, 4)) !== "Exif") return 1;
  const tiff = seg.subarray(6);
  const le = tiff[0] === 0x49;
  const u16 = (o: number) => (le ? tiff[o]! | (tiff[o + 1]! << 8) : (tiff[o]! << 8) | tiff[o + 1]!);
  const u32 = (o: number) => (le ? u16(o) + u16(o + 2) * 65536 : u16(o) * 65536 + u16(o + 2));
  const ifd = u32(4);
  if (ifd + 2 > tiff.length) return 1;
  const n = u16(ifd);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > tiff.length) break;
    if (u16(e) === 0x0112) return u16(e + 8) || 1;
  }
  return 1;
}

export function decodeJpegLuma(buf: Uint8Array): Gray & { orientation: number } {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error("not a JPEG");
  const qt: Uint16Array[] = [];
  const dcTables: Huffman[] = [];
  const acTables: Huffman[] = [];
  let comps: Component[] = [];
  let width = 0;
  let height = 0;
  let hMax = 1;
  let vMax = 1;
  let mcusX = 0;
  let mcusY = 0;
  let restartInterval = 0;
  let adobeTransform = -1;
  let orientation = 1;
  let pos = 2;
  const u16 = (o: number) => (buf[o]! << 8) | buf[o + 1]!;
  const coef = new Float64Array(64);

  while (pos < buf.length) {
    if (buf[pos] !== 0xff) {
      pos++;
      continue;
    }
    const marker = buf[pos + 1]!;
    pos += 2;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xff) {
      if (marker === 0xff) pos--;
      continue;
    }
    if (marker === 0xd9) break;
    const len = u16(pos);
    const seg = buf.subarray(pos + 2, pos + len);
    switch (marker) {
      case 0xdb: {
        let p = 0;
        while (p < seg.length) {
          const pq = seg[p]! >> 4;
          const tq = seg[p]! & 15;
          p++;
          const table = new Uint16Array(64);
          for (let i = 0; i < 64; i++) {
            table[i] = pq ? (seg[p]! << 8) | seg[p + 1]! : seg[p]!;
            p += pq ? 2 : 1;
          }
          qt[tq] = table;
        }
        break;
      }
      case 0xc4: {
        let p = 0;
        while (p < seg.length) {
          const tc = seg[p]! >> 4;
          const th = seg[p]! & 15;
          const counts = seg.subarray(p + 1, p + 17);
          const total = counts.reduce((a, b) => a + b, 0);
          const values = seg.slice(p + 17, p + 17 + total);
          (tc === 0 ? dcTables : acTables)[th] = buildHuffman(counts, values);
          p += 17 + total;
        }
        break;
      }
      case 0xc0:
      case 0xc1: {
        if (seg[0] !== 8) throw new Error("JPEG: only 8-bit precision is supported");
        height = u16(pos + 3);
        width = u16(pos + 5);
        const n = seg[5]!;
        comps = [];
        for (let i = 0; i < n; i++) {
          const o = 6 + i * 3;
          comps.push({
            id: seg[o]!,
            h: seg[o + 1]! >> 4,
            v: seg[o + 1]! & 15,
            tq: seg[o + 2]!,
            blocksPerLine: 0,
            blocksPerColumn: 0,
            plane: new Uint8Array(0),
            pred: 0,
          });
        }
        hMax = Math.max(...comps.map((c) => c.h));
        vMax = Math.max(...comps.map((c) => c.v));
        mcusX = Math.ceil(width / (8 * hMax));
        mcusY = Math.ceil(height / (8 * vMax));
        for (const c of comps) {
          c.blocksPerLine = mcusX * c.h;
          c.blocksPerColumn = mcusY * c.v;
          c.plane = new Uint8Array(c.blocksPerLine * 8 * c.blocksPerColumn * 8);
        }
        break;
      }
      case 0xc2:
      case 0xc3:
      case 0xc5:
      case 0xc6:
      case 0xc7:
      case 0xc9:
      case 0xca:
      case 0xcb:
      case 0xcd:
      case 0xce:
      case 0xcf:
        throw new Error("JPEG: only baseline (sequential Huffman) files are supported");
      case 0xdd:
        restartInterval = u16(pos + 2);
        break;
      case 0xe1:
        orientation = exifOrientation(seg);
        break;
      case 0xee:
        if (String.fromCharCode(...seg.subarray(0, 5)) === "Adobe") adobeTransform = seg[11] ?? -1;
        break;
      case 0xda: {
        const ns = seg[0]!;
        const scan: Component[] = [];
        for (let i = 0; i < ns; i++) {
          const c = comps.find((x) => x.id === seg[1 + i * 2]);
          if (!c) throw new Error("JPEG: scan references an unknown component");
          c.dc = dcTables[seg[2 + i * 2]! >> 4];
          c.ac = acTables[seg[2 + i * 2]! & 15];
          if (!c.dc || !c.ac || !qt[c.tq]) throw new Error("JPEG: missing table");
          c.pred = 0;
          scan.push(c);
        }
        const r = new BitReader(buf, pos + len);
        const single = scan.length === 1;
        const total = single
          ? Math.ceil(Math.ceil((width * scan[0]!.h) / hMax) / 8) * Math.ceil(Math.ceil((height * scan[0]!.v) / vMax) / 8)
          : mcusX * mcusY;
        for (let n = 0; n < total; n++) {
          if (restartInterval && n > 0 && n % restartInterval === 0) {
            r.restart();
            for (const c of scan) c.pred = 0;
          }
          if (single) {
            const c = scan[0]!;
            const perLine = Math.ceil(Math.ceil((width * c.h) / hMax) / 8);
            const bx = n % perLine;
            const by = Math.floor(n / perLine);
            decodeBlock(r, c, qt[c.tq]!, coef);
            idctInto(coef, c.plane, c.blocksPerLine * 8, bx * 8, by * 8);
          } else {
            const mx = n % mcusX;
            const my = Math.floor(n / mcusX);
            for (const c of scan)
              for (let v = 0; v < c.v; v++)
                for (let h = 0; h < c.h; h++) {
                  decodeBlock(r, c, qt[c.tq]!, coef);
                  idctInto(coef, c.plane, c.blocksPerLine * 8, (mx * c.h + h) * 8, (my * c.v + v) * 8);
                }
          }
        }
        // continue after the entropy-coded data: find the next real marker
        let p = r.pos;
        while (p + 1 < buf.length && !(buf[p] === 0xff && buf[p + 1] !== 0 && !(buf[p + 1]! >= 0xd0 && buf[p + 1]! <= 0xd7))) p++;
        pos = p;
        continue;
      }
      default:
        break;
    }
    pos += len;
  }

  if (!width || !height || !comps.length) throw new Error("JPEG: no image data");
  const data = new Float32Array(width * height);
  const sample = (c: Component, x: number, y: number) =>
    c.plane[Math.floor((y * c.v) / vMax) * c.blocksPerLine * 8 + Math.floor((x * c.h) / hMax)]!;
  const rgb = comps.length === 3 && adobeTransform === 0;
  if (comps.length !== 1 && comps.length !== 3) throw new Error("JPEG: CMYK files are not supported");
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const lum = rgb
        ? sample(comps[0]!, x, y) * 0.299 + sample(comps[1]!, x, y) * 0.587 + sample(comps[2]!, x, y) * 0.114
        : sample(comps[0]!, x, y);
      data[y * width + x] = lum / 255;
    }
  return { width, height, data, orientation };
}
