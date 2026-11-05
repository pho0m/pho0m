import type { TableRow } from "../model.ts";
import { dotText, pxBox } from "./kit.ts";
import type { Theme } from "./theme.ts";
import { n, svgDocument } from "./xml.ts";

export const BADGE_H = 24;
const DOT = 2;
const PAD = 7;

function star(x: number, y: number, r: number, fill: string): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 ? r * 0.45 : r;
    pts.push(`${n(x + Math.cos(a) * rad)},${n(y + Math.sin(a) * rad)}`);
  }
  return `<polygon points="${pts.join(" ")}" fill="${fill}"/>`;
}

/**
 * Row badge drawn as a dot-matrix LED readout: [2023][SCHOOL][★ 12].
 * Uses no font file, so each badge stays around 1–2 KB.
 */
export function badgeCard(b: TableRow["badge"], t: Theme): string {
  const colour = { led: t.led, text: t.text, accent: t.accent };
  const parts: { w: number; draw: (x: number) => string }[] = b.segments.map((seg) => {
    const probe = dotText(seg.text, 0, 0, DOT, "");
    return { w: probe.width + 2 * PAD, draw: (x: number) => dotText(seg.text, x + PAD, 5, DOT, colour[seg.tone]).svg };
  });
  if (b.stars !== null) {
    const v = String(b.stars);
    const num = dotText(v, 0, 0, DOT, "");
    parts.push({
      w: PAD + 12 + 5 + num.width + PAD,
      draw: (x) => star(x + PAD + 6, 12, 6.5, t.accent) + dotText(v, x + PAD + 17, 5, DOT, t.text).svg,
    });
  }
  const W = Math.ceil(parts.reduce((a, p) => a + p.w, 0) + 2);
  let s = pxBox(0, 0, W, BADGE_H, { fill: t.panel, stroke: t.line2, border: 1, step: 2 });
  let x = 1;
  parts.forEach((p, i) => {
    if (i > 0) s += `<rect x="${n(x)}" y="4" width="1" height="${BADGE_H - 8}" fill="${t.line2}" shape-rendering="crispEdges"/>`;
    s += p.draw(x);
    x += p.w;
  });
  return svgDocument(W, BADGE_H, badgeLabel(b), s);
}

/** Plain-text version of a badge (alt text and SVG title). */
export function badgeLabel(b: TableRow["badge"]): string {
  return [...b.segments.map((s) => s.text), b.stars !== null ? `${b.stars} GitHub stars` : ""].filter(Boolean).join(" · ");
}
