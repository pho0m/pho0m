import { fit, measure } from "../font/fonts.ts";
import type { LinkItem } from "../model.ts";
import { linkIcon } from "./glyphs.ts";
import { glyph, linkIconSvg, pxBox, text } from "./kit.ts";
import { FILM, type Theme } from "./theme.ts";
import { esc, n, svgDocument } from "./xml.ts";

export const BUTTON_H = 32;

/**
 * A pill-shaped key with pixel corners: icon, LED label, and a small indicator light.
 * `style: "pill"` (top row, uppercase names) or `"link"` (footer, the address as typed).
 */
export function buttonCard(item: LinkItem, t: Theme, opts: { style: "pill" | "link"; logo?: string | null }): string {
  const pill = opts.style === "pill";
  const label = pill ? item.label.toUpperCase() : item.label;
  const size = pill ? 21 : 20;
  const spacing = pill ? 1 : 0;
  const shown = fit(label, "led", size, 260, spacing);
  const lw = measure(shown, "led", size, spacing);
  const iconX = 11;
  const iconSize = 16;
  const textX = iconX + iconSize + 9;
  const w = Math.ceil(textX + lw + 10 + 6 + 12);
  const H = BUTTON_H;

  let s = pxBox(0, 0, w, H, { fill: pill ? t.panel : t.bg, stroke: pill ? t.line2 : t.line, border: 2, step: 3 });
  const iy = (H - iconSize) / 2;
  if (item.company && opts.logo) {
    s += pxBox(iconX - 2, iy - 2, iconSize + 4, iconSize + 4, { fill: FILM.paper, step: 1 });
    s += `<image x="${n(iconX)}" y="${n(iy)}" width="${iconSize}" height="${iconSize}" href="${esc(opts.logo)}"/>`;
  } else if (item.kind === "website" && !item.company && pill) {
    s += glyph("film", iconX, iy, iconSize, t.led);
  } else {
    s += linkIconSvg(linkIcon(item.kind), iconX, iy, iconSize, t.led);
  }
  s += text(textX, 22, shown, { font: "led", size, fill: t.text, spacing });
  s += `<rect x="${w - 16}" y="${H / 2 - 3}" width="6" height="6" fill="${t.accent}" shape-rendering="crispEdges"/>`;
  return svgDocument(w, H, item.label, s);
}
