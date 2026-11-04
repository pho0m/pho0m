import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { readWoff2Metrics, type FontMetrics } from "./woff2.ts";

/**
 * The three darkroom typefaces, embedded into each SVG as base64 @font-face (latin subset)
 * and measured from the same files so layouts line up with what GitHub renders.
 *   led  VT323               — LED / LCD labels and numbers
 *   px7  Pixelify Sans 700   — pixel display headings
 *   b4/b6 Chakra Petch 400/600 — body text and labels
 * Only these four files are ever embedded, and each SVG gets just the ones it uses.
 */
export type FontKey = "led" | "px7" | "b4" | "b6";

const DEFS: Record<FontKey, { pkg: string; file: string; family: string; weight: number; fallback: string }> = {
  led: { pkg: "@fontsource/vt323", file: "vt323-latin-400-normal.woff2", family: "PxLed", weight: 400, fallback: "monospace" },
  px7: { pkg: "@fontsource/pixelify-sans", file: "pixelify-sans-latin-700-normal.woff2", family: "PxDisplay", weight: 700, fallback: "monospace" },
  b4: { pkg: "@fontsource/chakra-petch", file: "chakra-petch-latin-400-normal.woff2", family: "PxBody", weight: 400, fallback: "sans-serif" },
  b6: { pkg: "@fontsource/chakra-petch", file: "chakra-petch-latin-600-normal.woff2", family: "PxBody", weight: 600, fallback: "sans-serif" },
};
export const FONT_KEYS = Object.keys(DEFS) as FontKey[];

type Loaded = { base64: string; metrics: FontMetrics };
const cache = new Map<FontKey, Loaded>();
const require = createRequire(import.meta.url);

function load(key: FontKey): Loaded {
  const hit = cache.get(key);
  if (hit) return hit;
  const def = DEFS[key];
  const dir = dirname(require.resolve(`${def.pkg}/package.json`));
  const bytes = readFileSync(join(dir, "files", def.file));
  const loaded = { base64: bytes.toString("base64"), metrics: readWoff2Metrics(bytes) };
  cache.set(key, loaded);
  return loaded;
}

/** Width of a code point the font lacks (the browser falls back to a system font). */
const MISSING_EM = 0.6;

/** Rendered width of `text` in px. Kerning and ligatures are switched off in the SVG CSS to match. */
export function measure(text: string, font: FontKey, size: number, letterSpacing = 0): number {
  const m = load(font).metrics;
  let units = 0;
  let count = 0;
  for (const ch of text) {
    const adv = m.advance(ch.codePointAt(0)!);
    units += adv ?? MISSING_EM * m.unitsPerEm;
    count++;
  }
  return (units / m.unitsPerEm) * size + letterSpacing * count;
}

export function hasGlyphs(text: string, font: FontKey): boolean {
  const m = load(font).metrics;
  for (const ch of text) if (m.advance(ch.codePointAt(0)!) === undefined) return false;
  return true;
}

function ellipsis(font: FontKey): string {
  return hasGlyphs("…", font) ? "…" : "...";
}

/** Cut `text` so it fits `maxWidth`, adding an ellipsis when anything was removed. */
export function fit(text: string, font: FontKey, size: number, maxWidth: number, letterSpacing = 0): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (measure(clean, font, size, letterSpacing) <= maxWidth) return clean;
  const dots = ellipsis(font);
  const chars = Array.from(clean);
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = chars.slice(0, mid).join("").trimEnd() + dots;
    if (measure(candidate, font, size, letterSpacing) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 ? "" : chars.slice(0, lo).join("").trimEnd().replace(/[\s,;:·–-]+$/, "") + dots;
}

/** Greedy word wrap into at most `maxLines`; the last line gets an ellipsis when text is left over. */
export function wrap(text: string, font: FontKey, size: number, maxWidth: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  let i = 0;
  for (; i < words.length; i++) {
    const word = words[i]!;
    const next = line ? `${line} ${word}` : word;
    if (!line || measure(next, font, size) <= maxWidth) {
      line = next;
      continue;
    }
    lines.push(line);
    if (lines.length === maxLines) {
      line = "";
      break;
    }
    line = word;
  }
  if (line && lines.length < maxLines) {
    lines.push(line);
    i = words.length;
  }
  const leftover = i < words.length;
  const out = lines.map((l) => fit(l, font, size, maxWidth));
  if (leftover && out.length) {
    const last = out.length - 1;
    out[last] = fit(`${out[last]} ${words.slice(i).join(" ")}`, font, size, maxWidth);
  }
  return out;
}

/**
 * Split prose into sentences. A boundary is . ! or ? followed by a space and a capital letter,
 * digit or quote (or the end), so "Co., Ltd" and "4.5" stay inside their sentence.
 */
export function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?]["')\]]?)\s+(?=["'(A-Z0-9])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Leading sentences of `text` that fit in `maxLines` lines without cutting a sentence. */
export function sentencesThatFit(text: string, font: FontKey, size: number, maxWidth: number, maxLines: number): string {
  let picked = "";
  for (const s of sentences(text)) {
    const next = `${picked} ${s}`.trim();
    const lines = wrap(next, font, size, maxWidth, maxLines + 1);
    if (lines.length > maxLines) break;
    picked = next;
  }
  return picked.trim() || text;
}

/** CSS for the fonts a finished SVG body actually uses (found by its `f-<key>` classes). */
export function fontCss(body: string): string {
  const used = FONT_KEYS.filter((k) => body.includes(`f-${k}"`) || body.includes(`f-${k} `));
  const faces = new Map<string, string>();
  const rules: string[] = [];
  for (const key of used) {
    const def = DEFS[key];
    const { base64 } = load(key);
    faces.set(
      `${def.family}-${def.weight}`,
      `@font-face{font-family:"${def.family}";font-weight:${def.weight};font-style:normal;src:url(data:font/woff2;base64,${base64}) format("woff2")}`,
    );
    rules.push(`.f-${key}{font-family:"${def.family}",${def.fallback};font-weight:${def.weight}}`);
  }
  if (!used.length) return "";
  return [...faces.values(), ...rules, "text{font-kerning:none;font-variant-ligatures:none}"].join("");
}
