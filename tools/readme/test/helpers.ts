import { join } from "node:path";
import { type Content } from "@pho0m/content";
import { seed } from "@pho0m/content/seed";
import { generate, type GenerateInput, type Output } from "../src/generate.ts";
import { createMediaLoader } from "../src/media.ts";
import { repoRoot } from "../src/paths.ts";

export const ROOT = repoRoot();

/** An old README with a leftover WakaTime block: regenerating must replace all of it. */
export const README_SAMPLE = `# Hi\n\nOld intro.\n\n<!--START_SECTION:waka-->\nold stats\n<!--END_SECTION:waka-->\n\nOld footer.\n`;

export function clone(content: Content = seed): Content {
  return structuredClone(content);
}

export async function run(overrides: Partial<GenerateInput> = {}): Promise<Output> {
  const content = overrides.content ?? seed;
  return generate({
    content,
    github: null,
    media: createMediaLoader({ publicDir: join(ROOT, "web", "public"), siteUrl: content.site.url, warn: () => {} }),
    assetPath: "assets/readme",
    warn: () => {},
    ...overrides,
  });
}

/** Relative asset paths referenced from README markdown (src= and srcset=). */
export function referencedAssets(readme: string): string[] {
  const out = new Set<string>();
  for (const m of readme.matchAll(/\b(?:src|srcset)="([^"]+)"/g)) {
    const url = m[1]!;
    if (!/^[a-z]+:/i.test(url)) out.add(url);
  }
  return [...out];
}

export type GifInfo = {
  version: string;
  width: number;
  height: number;
  globalColors: number;
  /** NETSCAPE2.0 loop count (0 = forever), or null when the GIF does not loop. */
  loop: number | null;
  frames: { delay: number; transparent: boolean; dispose: number; x: number; y: number; w: number; h: number }[];
};

/** Walk the GIF block structure (header, colour tables, extensions, images) without decoding pixels. */
export function parseGif(b: Uint8Array): GifInfo {
  const u16 = (i: number) => b[i]! | (b[i + 1]! << 8);
  const version = String.fromCharCode(...b.subarray(0, 6));
  const width = u16(6);
  const height = u16(8);
  const packed = b[10]!;
  const globalColors = packed & 0x80 ? 1 << ((packed & 7) + 1) : 0;
  let pos = 13 + globalColors * 3;
  let loop: number | null = null;
  const frames: GifInfo["frames"] = [];
  let gce = { delay: 0, transparent: false, dispose: 0 };
  const skipSubBlocks = () => {
    while (b[pos] !== 0) pos += b[pos]! + 1;
    pos++;
  };
  for (;;) {
    const id = b[pos++];
    if (id === 0x3b) break;
    if (id === 0x21) {
      const label = b[pos++];
      if (label === 0xf9) {
        const flags = b[pos + 1]!;
        gce = { delay: u16(pos + 2) * 10, transparent: !!(flags & 1), dispose: (flags >> 2) & 7 };
        pos += b[pos]! + 1;
        skipSubBlocks();
      } else if (label === 0xff) {
        const app = String.fromCharCode(...b.subarray(pos + 1, pos + 12));
        pos += b[pos]! + 1;
        if (app === "NETSCAPE2.0" && b[pos] === 3 && b[pos + 1] === 1) loop = u16(pos + 2);
        skipSubBlocks();
      } else skipSubBlocks();
    } else if (id === 0x2c) {
      const x = u16(pos);
      const y = u16(pos + 2);
      const w = u16(pos + 4);
      const h = u16(pos + 6);
      const p = b[pos + 8]!;
      pos += 9;
      if (p & 0x80) pos += (1 << ((p & 7) + 1)) * 3;
      pos++; // LZW minimum code size
      skipSubBlocks();
      frames.push({ ...gce, x, y, w, h });
      gce = { delay: 0, transparent: false, dispose: 0 };
    } else throw new Error(`GIF: unexpected block 0x${(id ?? 0).toString(16)} at ${pos - 1}`);
    if (pos > b.length) throw new Error("GIF: truncated");
  }
  return { version, width, height, globalColors, loop, frames };
}

/** The part of a stylesheet outside `@media (prefers-reduced-motion: no-preference){…}` blocks. */
export function outsideMotionQuery(css: string): string {
  const marker = "@media (prefers-reduced-motion: no-preference){";
  let out = "";
  let i = 0;
  for (;;) {
    const at = css.indexOf(marker, i);
    if (at < 0) return out + css.slice(i);
    out += css.slice(i, at);
    let depth = 1;
    let k = at + marker.length;
    while (k < css.length && depth) {
      if (css[k] === "{") depth++;
      else if (css[k] === "}") depth--;
      k++;
    }
    i = k;
  }
}

/** Concatenated <style> contents of an SVG. */
export function styleOf(svg: string): string {
  return [...svg.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("");
}

/** GIF LZW decoder (for checking the encoder's output, not for speed). */
function lzwDecode(minCodeSize: number, data: Uint8Array, count: number): Uint8Array {
  const out = new Uint8Array(count);
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let size = minCodeSize + 1;
  let dict: number[][] = [];
  const reset = () => {
    dict = Array.from({ length: clear + 2 }, (_, i) => (i < clear ? [i] : []));
    size = minCodeSize + 1;
  };
  reset();
  let bit = 0;
  let n = 0;
  let prev: number[] | null = null;
  while (n < count && bit + size <= data.length * 8) {
    let code = 0;
    for (let i = 0; i < size; i++, bit++) code |= ((data[bit >> 3]! >> (bit & 7)) & 1) << i;
    if (code === clear) {
      reset();
      prev = null;
      continue;
    }
    if (code === eoi) break;
    const entry: number[] = code < dict.length ? dict[code]! : [...prev!, prev![0]!];
    for (const v of entry) if (n < count) out[n++] = v;
    if (prev && dict.length < 4096) dict.push([...prev, entry[0]!]);
    if (dict.length === 1 << size && size < 12) size++;
    prev = entry;
  }
  return out;
}

/** Decode every frame of a GIF and composite it (transparency + "do not dispose") into full palette-index canvases. */
export function decodeGifFrames(b: Uint8Array): Uint8Array[] {
  const info = parseGif(b);
  const canvas = new Uint8Array(info.width * info.height);
  const frames: Uint8Array[] = [];
  let pos = 13 + info.globalColors * 3;
  let transparentIndex = -1;
  const u16 = (i: number) => b[i]! | (b[i + 1]! << 8);
  const subBlocks = () => {
    const parts: number[] = [];
    while (b[pos] !== 0) {
      parts.push(...b.subarray(pos + 1, pos + 1 + b[pos]!));
      pos += b[pos]! + 1;
    }
    pos++;
    return Uint8Array.from(parts);
  };
  for (;;) {
    const id = b[pos++];
    if (id === 0x3b) break;
    if (id === 0x21) {
      const label = b[pos++];
      if (label === 0xf9) transparentIndex = b[pos + 1]! & 1 ? b[pos + 4]! : -1;
      pos += b[pos]! + 1;
      subBlocks();
    } else if (id === 0x2c) {
      const [x, y, w, h] = [u16(pos), u16(pos + 2), u16(pos + 4), u16(pos + 6)];
      const p = b[pos + 8]!;
      pos += 9 + (p & 0x80 ? (1 << ((p & 7) + 1)) * 3 : 0);
      const min = b[pos++]!;
      const px = lzwDecode(min, subBlocks(), w * h);
      for (let j = 0; j < h; j++)
        for (let i = 0; i < w; i++) {
          const v = px[j * w + i]!;
          if (v !== transparentIndex) canvas[(y + j) * info.width + x + i] = v;
        }
      frames.push(canvas.slice());
    }
  }
  return frames;
}
