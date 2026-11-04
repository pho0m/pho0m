import subsetFont from "subset-font";
import { FONT_KEYS, fontFile, type FontKey } from "./fonts.ts";

/**
 * Cut every font a finished SVG embeds down to the glyphs that SVG draws (harfbuzz hb-subset,
 * re-encoded as WOFF2). fontCss() embeds whole latin files, and a pill button that shows
 * nine letters does not need the other ninety glyphs. Hinting and layout tables are kept, so the
 * glyphs render exactly as before, and advance widths are unchanged, so measure() still matches.
 * The output depends only on the fonts and the text (the same bytes on every machine).
 */

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** XML text content → plain text (the entities esc() writes, plus numeric references). */
function unescapeXml(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, ref: string) => {
    if (ref[0] === "#") {
      const cp = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return ENTITY[ref] ?? m;
  });
}

const TEXT = /<text\b[^>]*\bclass="f-(led|px7|b4|b6)"[^>]*>([^<]*)<\/text>/g;

/** The code points each font key draws in `svg` (from its `<text class="f-…">` elements), sorted. */
export function usedText(svg: string): Map<FontKey, string> {
  const chars = new Map<FontKey, Set<string>>();
  for (const m of svg.matchAll(TEXT)) {
    const key = m[1] as FontKey;
    const set = chars.get(key) ?? new Set<string>([" "]);
    for (const ch of unescapeXml(m[2]!)) set.add(ch);
    chars.set(key, set);
  }
  const out = new Map<FontKey, string>();
  for (const key of FONT_KEYS) {
    const set = chars.get(key);
    if (set) out.set(key, [...set].sort((a, b) => a.codePointAt(0)! - b.codePointAt(0)!).join(""));
  }
  return out;
}

const cache = new Map<string, Promise<string>>();

/** Base64 WOFF2 of `key` with only the glyphs for `text` (cached: dark and light cards share them). */
export function subsetBase64(key: FontKey, text: string): Promise<string> {
  const id = `${key}\u0000${text}`;
  let hit = cache.get(id);
  if (!hit) {
    hit = subsetFont(fontFile(key).bytes, text, { targetFormat: "woff2" }).then((b) => Buffer.from(b).toString("base64"));
    cache.set(id, hit);
  }
  return hit;
}

/** `svg` with each embedded whole font replaced by its subset for the text the SVG draws. */
export async function subsetSvgFonts(svg: string): Promise<string> {
  let out = svg;
  let used: Map<FontKey, string> | null = null;
  for (const key of FONT_KEYS) {
    const whole = `url(data:font/woff2;base64,${fontFile(key).base64})`;
    if (!out.includes(whole)) continue;
    used ??= usedText(svg);
    const subset = `url(data:font/woff2;base64,${await subsetBase64(key, used.get(key) ?? " ")})`;
    out = out.split(whole).join(subset);
  }
  return out;
}
