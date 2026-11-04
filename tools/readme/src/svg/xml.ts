import { fontCss } from "../font/fonts.ts";

/** Escape text for XML element content and attribute values. */
export function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // characters XML 1.0 does not allow at all
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "");
}

/** Compact, deterministic number formatting for coordinates. */
export function n(v: number): string {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? "0" : String(r);
}

type AttrValue = string | number | undefined | null | false;

/** Attribute string; undefined/null/false values are skipped, strings are escaped. */
export function attrs(a: Record<string, AttrValue>): string {
  let out = "";
  for (const [k, v] of Object.entries(a)) {
    if (v === undefined || v === null || v === false) continue;
    out += ` ${k}="${typeof v === "number" ? n(v) : esc(v)}"`;
  }
  return out;
}

export function el(name: string, a: Record<string, AttrValue>, children?: string): string {
  return children === undefined ? `<${name}${attrs(a)}/>` : `<${name}${attrs(a)}>${children}</${name}>`;
}

/**
 * Wrap a card body in a standalone SVG document with an accessible title and only
 * the @font-face rules the body uses. `css` is appended to the stylesheet (animations;
 * wrap them with motionCss() so viewers who prefer reduced motion get the static card).
 */
export function svgDocument(width: number, height: number, title: string, body: string, defs = "", css = ""): string {
  const rules = fontCss(body) + css;
  const style = rules ? `<style>${rules}</style>` : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(width)}" height="${n(height)}" viewBox="0 0 ${n(width)} ${n(height)}" role="img" aria-labelledby="title">` +
    `<title id="title">${esc(title)}</title>` +
    (style || defs ? `<defs>${style}${defs}</defs>` : "") +
    body +
    `</svg>\n`
  );
}
