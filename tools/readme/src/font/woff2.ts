import { brotliDecompressSync } from "node:zlib";

/**
 * Minimal WOFF2 reader: just enough to get advance widths (head, hhea, hmtx, cmap)
 * so the SVG cards can measure text set in the same fonts they embed.
 * Glyph outlines are never needed, so the transformed glyf/loca tables are skipped.
 */

const KNOWN_TAGS = [
  "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ",
  "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS",
  "GSUB", "EBSC", "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc",
  "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop",
  "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill",
];

export type FontMetrics = {
  unitsPerEm: number;
  ascender: number;
  descender: number;
  /** Advance width in font units, or undefined when the font has no glyph for the code point. */
  advance(codePoint: number): number | undefined;
};

type Table = { tag: string; offset: number; length: number; transformed: boolean };

export function readWoff2Metrics(file: Uint8Array): FontMetrics {
  const buf = Buffer.from(file.buffer, file.byteOffset, file.byteLength);
  if (buf.toString("latin1", 0, 4) !== "wOF2") throw new Error("not a WOFF2 file");
  const numTables = buf.readUInt16BE(12);
  const compressedSize = buf.readUInt32BE(20);
  let p = 48;
  const base128 = (): number => {
    let v = 0;
    for (let i = 0; i < 5; i++) {
      const c = buf[p++]!;
      v = v * 128 + (c & 0x7f);
      if (!(c & 0x80)) return v;
    }
    throw new Error("bad UIntBase128");
  };
  const tables: Table[] = [];
  let offset = 0;
  for (let i = 0; i < numTables; i++) {
    const flags = buf[p++]!;
    const index = flags & 0x3f;
    const version = flags >> 6;
    let tag: string;
    if (index === 63) {
      tag = buf.toString("latin1", p, p + 4);
      p += 4;
    } else tag = KNOWN_TAGS[index] ?? "????";
    const origLength = base128();
    const transformed = tag === "glyf" || tag === "loca" ? version !== 3 : version !== 0;
    const length = transformed ? base128() : origLength;
    tables.push({ tag, offset, length, transformed });
    offset += length;
  }
  const data = brotliDecompressSync(buf.subarray(p, p + compressedSize));
  const table = (tag: string): Buffer => {
    const t = tables.find((x) => x.tag === tag);
    if (!t) throw new Error(`font has no ${tag} table`);
    return data.subarray(t.offset, t.offset + t.length);
  };

  const head = table("head");
  const hhea = table("hhea");
  const unitsPerEm = head.readUInt16BE(18);
  const ascender = hhea.readInt16BE(4);
  const descender = hhea.readInt16BE(6);
  const numHMetrics = hhea.readUInt16BE(34);

  // hmtx: untransformed = (advance, lsb) pairs; transformed (version 1) = flags byte + advances.
  const hmtxEntry = tables.find((x) => x.tag === "hmtx")!;
  const hmtx = table("hmtx");
  const advances: number[] = [];
  for (let i = 0; i < numHMetrics; i++) {
    advances.push(hmtxEntry.transformed ? hmtx.readUInt16BE(1 + i * 2) : hmtx.readUInt16BE(i * 4));
  }
  const glyphAdvance = (gid: number) => advances[Math.min(gid, numHMetrics - 1)] ?? 0;

  const lookup = readCmap(table("cmap"));
  return {
    unitsPerEm,
    ascender,
    descender,
    advance(cp) {
      const gid = lookup(cp);
      return gid ? glyphAdvance(gid) : undefined;
    },
  };
}

/** Build a code point → glyph id lookup from the best Unicode cmap subtable (format 12 or 4). */
function readCmap(cmap: Buffer): (cp: number) => number {
  const n = cmap.readUInt16BE(2);
  let best: { offset: number; format: number } | null = null;
  for (let i = 0; i < n; i++) {
    const platform = cmap.readUInt16BE(4 + i * 8);
    const encoding = cmap.readUInt16BE(6 + i * 8);
    const offset = cmap.readUInt32BE(8 + i * 8);
    const format = cmap.readUInt16BE(offset);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode || (format !== 4 && format !== 12)) continue;
    if (!best || format > best.format) best = { offset, format };
  }
  if (!best) return () => 0;
  const o = best.offset;
  if (best.format === 12) {
    const groups = cmap.readUInt32BE(o + 12);
    const list: [number, number, number][] = [];
    for (let i = 0; i < groups; i++) {
      const g = o + 16 + i * 12;
      list.push([cmap.readUInt32BE(g), cmap.readUInt32BE(g + 4), cmap.readUInt32BE(g + 8)]);
    }
    return (cp) => {
      for (const [start, end, gid] of list) if (cp >= start && cp <= end) return gid + (cp - start);
      return 0;
    };
  }
  const segX2 = cmap.readUInt16BE(o + 6);
  const ends = o + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  const rangeOffsets = deltas + segX2;
  return (cp) => {
    if (cp > 0xffff) return 0;
    for (let s = 0; s < segX2 / 2; s++) {
      const end = cmap.readUInt16BE(ends + s * 2);
      if (cp > end) continue;
      const start = cmap.readUInt16BE(starts + s * 2);
      if (cp < start) return 0;
      const delta = cmap.readInt16BE(deltas + s * 2);
      const ro = cmap.readUInt16BE(rangeOffsets + s * 2);
      if (ro === 0) return (cp + delta) & 0xffff;
      const at = rangeOffsets + s * 2 + ro + (cp - start) * 2;
      const gid = cmap.readUInt16BE(at);
      return gid === 0 ? 0 : (gid + delta) & 0xffff;
    }
    return 0;
  };
}
