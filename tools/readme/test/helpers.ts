import { join } from "node:path";
import { seed, type Content } from "@pho0m/content";
import { generate, type GenerateInput, type Output } from "../src/generate.ts";
import { createMediaLoader } from "../src/media.ts";
import { repoRoot } from "../src/paths.ts";

export const ROOT = repoRoot();

export const WAKA_SAMPLE = [
  "<!--START_SECTION:waka-->",
  "",
  "```txt",
  "Markdown     6 hrs 9 mins          ████████████░░░░░░░░░░░░░   47.57 %",
  "TypeScript   1 hr 26 mins          ██▓░░░░░░░░░░░░░░░░░░░░░░   11.19 %   ",
  "Weird        <b>&amp;</b> | * _ `  ░░░░░░░░░░░░░░░░░░░░░░░░░   00.01 %",
  "```",
  "",
  "<!--END_SECTION:waka-->",
].join("\n");

export const README_SAMPLE = `# Hi\n\nOld intro.\n\n${WAKA_SAMPLE}\n\nOld footer.\n`;

export function clone(content: Content = seed): Content {
  return structuredClone(content);
}

export async function run(overrides: Partial<GenerateInput> = {}): Promise<Output> {
  const content = overrides.content ?? seed;
  return generate({
    content,
    github: null,
    media: createMediaLoader({ publicDir: join(ROOT, "web", "public"), siteUrl: content.site.url, warn: () => {} }),
    currentReadme: README_SAMPLE,
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
