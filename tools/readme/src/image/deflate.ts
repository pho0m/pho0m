/**
 * A small, deterministic zlib/deflate compressor (LZ77 with hash chains + one dynamic
 * Huffman block). Node's zlib would compress better, but its output bytes may change
 * between zlib versions, and every generated file must be byte-for-byte reproducible on
 * any Node so `npm run readme -- --check` works in CI. Same input → same bytes, always.
 */

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

const WINDOW = 32768;
const MAX_MATCH = 258;
const MAX_CHAIN = 96;
const HASH_BITS = 15;

/** Code index for a match length (3..258) or distance (1..32768): last base <= value. */
function codeIndex(base: readonly number[], value: number): number {
  let i = base.length - 1;
  while (base[i]! > value) i--;
  return i;
}

class BitWriter {
  private bytes: number[] = [];
  private acc = 0;
  private count = 0;
  /** Write `n` bits of `value`, least significant bit first. */
  bits(value: number, n: number) {
    for (let i = 0; i < n; i++) {
      this.acc |= ((value >>> i) & 1) << this.count;
      if (++this.count === 8) {
        this.bytes.push(this.acc);
        this.acc = 0;
        this.count = 0;
      }
    }
  }
  /** Write a Huffman code (stored most significant bit first). */
  code(code: number, len: number) {
    for (let i = len - 1; i >= 0; i--) this.bits((code >>> i) & 1, 1);
  }
  finish(): number[] {
    if (this.count) this.bytes.push(this.acc);
    this.acc = 0;
    this.count = 0;
    return this.bytes;
  }
}

/**
 * Length-limited Huffman code lengths for `freq` (JPEG Annex K.3 style adjustment).
 * At least two symbols always get a code so every decoder accepts the table.
 */
export function huffmanLengths(freq: readonly number[], limit: number): number[] {
  const used = freq.map((f, sym) => ({ f, sym })).filter((x) => x.f > 0);
  for (let s = 0; used.length < 2 && s < freq.length; s++) if (!used.some((u) => u.sym === s)) used.push({ f: 1, sym: s });
  // Build the tree with a deterministic order: by frequency, then by symbol / creation order.
  type Node = { f: number; order: number; sym: number; left?: Node; right?: Node };
  let order = 0;
  let nodes: Node[] = used.map((u) => ({ f: u.f, order: order++, sym: u.sym }));
  const byWeight = (a: Node, b: Node) => a.f - b.f || a.order - b.order;
  nodes.sort(byWeight);
  while (nodes.length > 1) {
    const a = nodes.shift()!;
    const b = nodes.shift()!;
    const parent: Node = { f: a.f + b.f, order: order++, sym: -1, left: a, right: b };
    let i = 0;
    while (i < nodes.length && byWeight(nodes[i]!, parent) <= 0) i++;
    nodes.splice(i, 0, parent);
  }
  const depth = new Map<number, number>();
  const walk = (n: Node, d: number) => {
    if (n.sym >= 0) depth.set(n.sym, Math.max(1, d));
    if (n.left) walk(n.left, d + 1);
    if (n.right) walk(n.right, d + 1);
  };
  walk(nodes[0]!, 0);
  // Count codes per length and squeeze anything longer than the limit.
  const maxDepth = Math.max(...depth.values());
  const bits = new Array<number>(Math.max(maxDepth, limit) + 2).fill(0);
  for (const d of depth.values()) bits[d]!++;
  for (let i = bits.length - 1; i > limit; i--) {
    while (bits[i]! > 0) {
      let j = i - 2;
      while (j > 0 && bits[j] === 0) j--;
      bits[i]! -= 2;
      bits[i - 1]!++;
      bits[j + 1]! += 2;
      bits[j]!--;
    }
  }
  // Most frequent symbols get the shortest codes.
  const ranked = [...used].sort((a, b) => b.f - a.f || a.sym - b.sym);
  const lengths = new Array<number>(freq.length).fill(0);
  let k = 0;
  for (let len = 1; len <= limit; len++) for (let c = 0; c < bits[len]!; c++) lengths[ranked[k++]!.sym] = len;
  return lengths;
}

/** Canonical Huffman codes for the given lengths (RFC 1951 §3.2.2). */
function canonicalCodes(lengths: readonly number[]): number[] {
  const max = Math.max(0, ...lengths);
  const blCount = new Array<number>(max + 1).fill(0);
  for (const l of lengths) if (l) blCount[l]!++;
  const next = new Array<number>(max + 2).fill(0);
  let code = 0;
  for (let bits = 1; bits <= max; bits++) {
    code = (code + blCount[bits - 1]!) << 1;
    next[bits] = code;
  }
  return lengths.map((l) => (l ? next[l]!++ : 0));
}

type Token = number; // literal 0..255, or (length << 16 | distance) for matches

function lz77(data: Uint8Array): Token[] {
  const n = data.length;
  const head = new Int32Array(1 << HASH_BITS).fill(-1);
  const prev = new Int32Array(n).fill(-1);
  const hashAt = (i: number) => ((data[i]! << 10) ^ (data[i + 1]! << 5) ^ data[i + 2]!) & ((1 << HASH_BITS) - 1);
  const insert = (i: number) => {
    if (i + 2 >= n) return;
    const h = hashAt(i);
    prev[i] = head[h]!;
    head[h] = i;
  };
  const tokens: Token[] = [];
  let i = 0;
  while (i < n) {
    let bestLen = 0;
    let bestDist = 0;
    if (i + 2 < n) {
      let cand = head[hashAt(i)]!;
      const max = Math.min(MAX_MATCH, n - i);
      for (let chain = 0; cand >= 0 && i - cand <= WINDOW && chain < MAX_CHAIN; chain++) {
        if (data[cand + bestLen] === data[i + bestLen]) {
          let len = 0;
          while (len < max && data[cand + len] === data[i + len]) len++;
          if (len > bestLen) {
            bestLen = len;
            bestDist = i - cand;
            if (len === max) break;
          }
        }
        cand = prev[cand]!;
      }
    }
    if (bestLen >= 3) {
      tokens.push((bestLen << 16) | bestDist);
      for (let k = 0; k < bestLen; k++) insert(i + k);
      i += bestLen;
    } else {
      tokens.push(data[i]!);
      insert(i);
      i++;
    }
  }
  return tokens;
}

/** Raw deflate stream (one dynamic-Huffman block). */
export function deflateRaw(data: Uint8Array): Uint8Array {
  const tokens = lz77(data);
  const litFreq = new Array<number>(286).fill(0);
  const distFreq = new Array<number>(30).fill(0);
  for (const t of tokens) {
    if (t < 256) litFreq[t]!++;
    else {
      litFreq[257 + codeIndex(LEN_BASE, t >>> 16)]!++;
      distFreq[codeIndex(DIST_BASE, t & 0xffff)]!++;
    }
  }
  litFreq[256]!++;
  const litLen = huffmanLengths(litFreq, 15);
  const distLen = huffmanLengths(distFreq, 15);
  const litCode = canonicalCodes(litLen);
  const distCode = canonicalCodes(distLen);

  let hlit = 286;
  while (hlit > 257 && litLen[hlit - 1] === 0) hlit--;
  let hdist = 30;
  while (hdist > 1 && distLen[hdist - 1] === 0) hdist--;

  // Run-length encode the code lengths with symbols 16/17/18.
  const all = [...litLen.slice(0, hlit), ...distLen.slice(0, hdist)];
  const rle: [number, number][] = []; // [symbol, extra bits value]
  for (let i = 0; i < all.length; ) {
    const v = all[i]!;
    let run = 1;
    while (i + run < all.length && all[i + run] === v) run++;
    if (v === 0 && run >= 3) {
      const r = Math.min(run, 138);
      rle.push(r >= 11 ? [18, r - 11] : [17, r - 3]);
      i += r;
    } else if (v !== 0 && run >= 4) {
      rle.push([v, 0]);
      const r = Math.min(run - 1, 6);
      rle.push([16, r - 3]);
      i += 1 + r;
    } else {
      rle.push([v, 0]);
      i++;
    }
  }
  const clFreq = new Array<number>(19).fill(0);
  for (const [sym] of rle) clFreq[sym]!++;
  const clLen = huffmanLengths(clFreq, 7);
  const clCode = canonicalCodes(clLen);
  let hclen = 19;
  while (hclen > 4 && clLen[CL_ORDER[hclen - 1]!] === 0) hclen--;

  const w = new BitWriter();
  w.bits(1, 1); // final block
  w.bits(2, 2); // dynamic Huffman
  w.bits(hlit - 257, 5);
  w.bits(hdist - 1, 5);
  w.bits(hclen - 4, 4);
  for (let i = 0; i < hclen; i++) w.bits(clLen[CL_ORDER[i]!]!, 3);
  for (const [sym, extra] of rle) {
    w.code(clCode[sym]!, clLen[sym]!);
    if (sym === 16) w.bits(extra, 2);
    else if (sym === 17) w.bits(extra, 3);
    else if (sym === 18) w.bits(extra, 7);
  }
  for (const t of tokens) {
    if (t < 256) {
      w.code(litCode[t]!, litLen[t]!);
      continue;
    }
    const len = t >>> 16;
    const dist = t & 0xffff;
    const li = codeIndex(LEN_BASE, len);
    w.code(litCode[257 + li]!, litLen[257 + li]!);
    w.bits(len - LEN_BASE[li]!, LEN_EXTRA[li]!);
    const di = codeIndex(DIST_BASE, dist);
    w.code(distCode[di]!, distLen[di]!);
    w.bits(dist - DIST_BASE[di]!, DIST_EXTRA[di]!);
  }
  w.code(litCode[256]!, litLen[256]!);
  return Uint8Array.from(w.finish());
}

/** zlib stream (RFC 1950): header, deflate data, Adler-32. */
export function zlibDeflate(data: Uint8Array): Uint8Array {
  const body = deflateRaw(data);
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  const out = new Uint8Array(body.length + 6);
  out[0] = 0x78;
  out[1] = 0x9c;
  out.set(body, 2);
  const adler = ((b << 16) | a) >>> 0;
  out[out.length - 4] = adler >>> 24;
  out[out.length - 3] = (adler >>> 16) & 0xff;
  out[out.length - 2] = (adler >>> 8) & 0xff;
  out[out.length - 1] = adler & 0xff;
  return out;
}
