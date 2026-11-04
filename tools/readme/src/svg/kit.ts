import { spritePixels, type IconName } from "@pho0m/content";
import { measure, type FontKey } from "../font/fonts.ts";
import type { Theme } from "./theme.ts";
import { GLYPHS, dotMatrixRows, dotMatrixWidth, monogramLetters, monogramRows, type GlyphName, type LinkIcon } from "./glyphs.ts";
import { el, esc, n } from "./xml.ts";

/** Shared drawing primitives for the darkroom cards. */

/** Width of every full-width card; GitHub shows the README column at about this size. */
export const CARD_W = 840;

export type TextOpts = {
  font: FontKey;
  size: number;
  fill: string;
  anchor?: "start" | "middle" | "end";
  spacing?: number;
  opacity?: number;
};

export function text(x: number, y: number, value: string, o: TextOpts): string {
  return (
    `<text x="${n(x)}" y="${n(y)}" class="f-${o.font}" font-size="${n(o.size)}" fill="${o.fill}"` +
    (o.anchor && o.anchor !== "start" ? ` text-anchor="${o.anchor}"` : "") +
    (o.spacing ? ` letter-spacing="${n(o.spacing)}"` : "") +
    (o.opacity !== undefined ? ` fill-opacity="${n(o.opacity)}"` : "") +
    `>${esc(value)}</text>`
  );
}

export function textWidth(value: string, o: Pick<TextOpts, "font" | "size" | "spacing">): number {
  return measure(value, o.font, o.size, o.spacing ?? 0);
}

/** Rectangle with stepped "pixel" corners (two steps of `s` px), as a path. */
export function pxRectPath(x: number, y: number, w: number, h: number, s: number): string {
  const r = x + w;
  const b = y + h;
  const p = [
    [x + 2 * s, y], [r - 2 * s, y], [r - 2 * s, y + s], [r - s, y + s], [r - s, y + 2 * s], [r, y + 2 * s],
    [r, b - 2 * s], [r - s, b - 2 * s], [r - s, b - s], [r - 2 * s, b - s], [r - 2 * s, b],
    [x + 2 * s, b], [x + 2 * s, b - s], [x + s, b - s], [x + s, b - 2 * s], [x, b - 2 * s],
    [x, y + 2 * s], [x + s, y + 2 * s], [x + s, y + s], [x + 2 * s, y + s],
  ];
  return "M" + p.map(([px, py]) => `${n(px!)} ${n(py!)}`).join("L") + "Z";
}

/** A stepped-corner box with a crisp `border` px outline (outer shape + inset fill). */
export function pxBox(
  x: number,
  y: number,
  w: number,
  h: number,
  o: { fill: string; stroke?: string; border?: number; step?: number; opacity?: number },
): string {
  const s = o.step ?? 3;
  const b = o.stroke ? (o.border ?? 2) : 0;
  const op = o.opacity !== undefined ? ` fill-opacity="${n(o.opacity)}"` : "";
  let out = "";
  if (b) out += `<path d="${pxRectPath(x, y, w, h, s)}" fill="${o.stroke}"${op}/>`;
  out += `<path d="${pxRectPath(x + b, y + b, w - 2 * b, h - 2 * b, s)}" fill="${o.fill}"${op}/>`;
  return out;
}

/** The outer frame of every full card: background, pixel border and an optional safelight glow. */
export function cardFrame(w: number, h: number, t: Theme, id: string, glow: { x: number; y: number } | null = { x: 0.12, y: 0 }): { defs: string; body: string } {
  let defs = "";
  let body = pxBox(0, 0, w, h, { fill: t.bg, stroke: t.line2, border: 2, step: 4 });
  if (glow) {
    defs += `<radialGradient id="${id}-glow" cx="${n(glow.x)}" cy="${n(glow.y)}" r="0.9" gradientTransform="translate(${n(glow.x)} ${n(glow.y)}) scale(1 ${n(w / h)}) translate(${n(-glow.x)} ${n(-glow.y)})"><stop offset="0" stop-color="${t.glow}" stop-opacity="${n(t.glowOpacity)}"/><stop offset="1" stop-color="${t.glow}" stop-opacity="0"/></radialGradient>`;
    body += `<path d="${pxRectPath(2, 2, w - 4, h - 4, 4)}" fill="url(#${id}-glow)"/>`;
  }
  return { defs, body };
}

/** A row of film sprocket holes from x0 to x1. */
export function sprockets(x0: number, x1: number, y: number, o: { fill: string; w?: number; h?: number; pitch?: number }): string {
  const w = o.w ?? 12;
  const h = o.h ?? 8;
  const pitch = o.pitch ?? 22;
  const count = Math.floor((x1 - x0 - w) / pitch) + 1;
  const start = x0 + (x1 - x0 - ((count - 1) * pitch + w)) / 2;
  let d = "";
  for (let i = 0; i < count; i++) {
    const x = start + i * pitch;
    // rounded-ish pixel hole: notch the corners by 1px
    d += `M${n(x + 1)} ${n(y)}h${n(w - 2)}v1h1v${n(h - 2)}h-1v1h${n(-(w - 2))}v-1h-1v${n(-(h - 2))}h1z`;
  }
  return `<path d="${d}" fill="${o.fill}"/>`;
}

/** Small right-pointing triangle (the fonts' latin subset has no arrow glyphs). */
export function triangle(x: number, y: number, size: number, fill: string): string {
  return `<path d="M${n(x)} ${n(y - size / 2)}L${n(x + size * 0.8)} ${n(y)}L${n(x)} ${n(y + size / 2)}Z" fill="${fill}"/>`;
}

/** Path of "#" pixels from rows of characters, each pixel `scale` px. */
export function pixelRowsPath(rows: readonly string[], x: number, y: number, scale: number): string {
  let d = "";
  rows.forEach((row, j) => {
    let i = 0;
    while (i < row.length) {
      if (row[i] !== "#") {
        i++;
        continue;
      }
      let k = i;
      while (k < row.length && row[k] === "#") k++;
      d += `M${n(x + i * scale)} ${n(y + j * scale)}h${n((k - i) * scale)}v${n(scale)}h${n(-(k - i) * scale)}z`;
      i = k;
    }
  });
  return d;
}

/** Dot-matrix LED text (5x7 font, `scale` px per dot). Returns markup and width in px. */
export function dotText(value: string, x: number, y: number, scale: number, fill: string): { svg: string; width: number } {
  const d = pixelRowsPath(dotMatrixRows(value), x, y, scale);
  return { svg: d ? `<path d="${d}" fill="${fill}" shape-rendering="crispEdges"/>` : "", width: dotMatrixWidth(value) * scale };
}

export function glyph(name: GlyphName, x: number, y: number, size: number, fill: string): string {
  return `<path d="${pixelRowsPath(GLYPHS[name], x, y, size / 8)}" fill="${fill}" shape-rendering="crispEdges"/>`;
}

/** A simple-icons logo (24x24 path) scaled into a `size` square. */
export function brandPath(path: string, x: number, y: number, size: number, fill: string): string {
  return `<path transform="translate(${n(x)} ${n(y)}) scale(${n(size / 24)})" d="${esc(path)}" fill="${fill}"/>`;
}

export function linkIconSvg(icon: LinkIcon, x: number, y: number, size: number, fill: string): string {
  return icon.type === "brand" ? brandPath(icon.icon.path, x, y, size, fill) : glyph(icon.glyph, x, y, size, fill);
}

/** Pixel monogram tile (3x5 letters) for skills without a logo. */
export function monogram(name: string, x: number, y: number, size: number, bg: string, fg: string): string {
  const rows = monogramRows(monogramLetters(name));
  const cols = rows[0]?.length ?? 3;
  const scale = Math.max(1, Math.floor(Math.min((size - 2) / cols, (size - 2) / 5)));
  const gx = x + Math.floor((size - cols * scale) / 2);
  const gy = y + Math.floor((size - 5 * scale) / 2);
  return (
    `<path d="${pxRectPath(x, y, size, size, 1)}" fill="${bg}"/>` +
    `<path d="${pixelRowsPath(rows, gx, gy, scale)}" fill="${fg}" shape-rendering="crispEdges"/>`
  );
}

/** Level dots (filled squares up to `level`, outlined after). */
export function levelDots(level: number, max: number, x: number, y: number, size: number, gap: number, t: Theme): string {
  let out = "";
  for (let i = 0; i < max; i++) {
    const cx = x + i * (size + gap);
    out +=
      i < level
        ? el("rect", { x: cx, y, width: size, height: size, fill: t.accent })
        : el("rect", { x: cx + 1, y: y + 1, width: size - 2, height: size - 2, fill: "none", stroke: t.line2, "stroke-width": 2 });
  }
  return `<g shape-rendering="crispEdges">${out}</g>`;
}

/** A 16x16 sprite in its own colours, one <rect> per opaque pixel (exactly spritePixels(icon)). */
export function sprite(icon: IconName, x: number, y: number, scale: number): string {
  const groups = new Map<string, string[]>();
  for (const px of spritePixels(icon)) {
    const list = groups.get(px.color) ?? [];
    list.push(`<rect x="${n(x + px.x * scale)}" y="${n(y + px.y * scale)}" width="${n(scale)}" height="${n(scale)}"/>`);
    groups.set(px.color, list);
  }
  const body = [...groups.entries()].map(([fill, rects]) => `<g fill="${fill}">${rects.join("")}</g>`).join("");
  return `<g data-sprite="${icon}" shape-rendering="crispEdges">${body}</g>`;
}
