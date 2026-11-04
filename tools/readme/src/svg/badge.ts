import { measure } from "../font/fonts.ts";
import type { TableRow } from "../model.ts";
import { pxBox, text } from "./kit.ts";
import type { Theme } from "./theme.ts";
import { n, svgDocument } from "./xml.ts";

export const BADGE_H = 24;

function star(x: number, y: number, r: number, fill: string): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 ? r * 0.45 : r;
    pts.push(`${n(x + Math.cos(a) * rad)},${n(y + Math.sin(a) * rad)}`);
  }
  return `<polygon points="${pts.join(" ")}" fill="${fill}"/>`;
}

/** Small row badge: [year] [GROUP] [★ stars], like an LED readout. */
export function badgeCard(b: TableRow["badge"], t: Theme): string {
  const size = 18;
  type Seg = { w: number; draw: (x: number) => string };
  const segs: Seg[] = [];
  if (b.year) {
    const w = measure(b.year, "led", size, 1) + 16;
    segs.push({ w, draw: (x) => text(x + 8, 17, b.year, { font: "led", size, fill: t.led, spacing: 1 }) });
  }
  const group = b.group.toUpperCase();
  const gw = measure(group, "led", size, 1) + 16;
  segs.push({ w: gw, draw: (x) => text(x + 8, 17, group, { font: "led", size, fill: t.text, spacing: 1 }) });
  if (b.featured && !b.year) {
    const fw = measure("FEATURED", "led", size, 1) + 16;
    segs.push({ w: fw, draw: (x) => text(x + 8, 17, "FEATURED", { font: "led", size, fill: t.accent, spacing: 1 }) });
  }
  if (b.stars !== null) {
    const v = String(b.stars);
    const w = 8 + 12 + 5 + measure(v, "led", size) + 8;
    segs.push({ w, draw: (x) => star(x + 14, 12, 6.5, t.accent) + text(x + 25, 17, v, { font: "led", size, fill: t.text }) });
  }
  const W = Math.ceil(segs.reduce((a, s) => a + s.w, 0) + 4);
  let s = pxBox(0, 0, W, BADGE_H, { fill: t.panel, stroke: t.line2, border: 1, step: 2 });
  let x = 2;
  segs.forEach((seg, i) => {
    if (i > 0) s += `<rect x="${n(x)}" y="4" width="1" height="${BADGE_H - 8}" fill="${t.line2}" shape-rendering="crispEdges"/>`;
    s += seg.draw(x);
    x += seg.w;
  });
  const title = [b.year, b.group, b.featured && !b.year ? "featured" : "", b.stars !== null ? `${b.stars} stars` : ""]
    .filter(Boolean)
    .join(" · ");
  return svgDocument(W, BADGE_H, title, s);
}
