import { fit, measure, wrap } from "../font/fonts.ts";
import { CARD_W, cardFrame, monogram, pxBox, text } from "./kit.ts";
import { FILM, type Theme } from "./theme.ts";
import { esc, svgDocument } from "./xml.ts";

export type UtotechData = {
  name: string;
  shortName: string;
  tagline: string;
  slogan: string;
  role: string;
  logo: string | null;
  stats: { label: string; value: string }[];
  customers: string[];
  services: { title: string; subtitle: string; price: string }[];
};

/** Company card: logo print, tagline, key numbers, customers, and the service price list. */
export function utotechCard(d: UtotechData, t: Theme): string {
  const pad = 30;
  const leftW = 270;
  const rightX = pad + leftW + 34;
  const rightW = CARD_W - rightX - pad;
  let s = "";

  // header
  const tile = 92;
  s += pxBox(pad, 30, tile, tile, { fill: FILM.paper, step: 3, stroke: t.name === "light" ? t.line2 : undefined, border: 2 });
  if (d.logo) s += `<image x="${pad + 8}" y="38" width="${tile - 16}" height="${tile - 16}" href="${esc(d.logo)}"/>`;
  else s += monogram(d.shortName || d.name, pad + 14, 44, tile - 28, FILM.ink, FILM.paper);
  const hx = pad + tile + 22;
  const headW = CARD_W - hx - pad - 120;
  s += text(hx, 66, fit(d.name, "px7", 30, headW), { font: "px7", size: 30, fill: t.text });
  s += text(hx, 94, fit(d.tagline, "b4", 17, headW), { font: "b4", size: 17, fill: t.muted });
  if (d.slogan) s += text(hx, 118, fit(d.slogan.toUpperCase(), "led", 20, headW, 1), { font: "led", size: 20, fill: t.accent, spacing: 1 });
  if (d.role) {
    const label = `MY ROLE ${d.role.toUpperCase()}`;
    const w = Math.ceil(measure(label, "led", 18, 1)) + 20;
    s += pxBox(CARD_W - pad - w, 34, w, 28, { fill: t.accent, step: 2 });
    s += text(CARD_W - pad - w / 2, 54, label, { font: "led", size: 18, fill: t.onAccent, anchor: "middle", spacing: 1 });
  }
  s += `<rect x="${pad}" y="142" width="${CARD_W - 2 * pad}" height="2" fill="${t.line}" shape-rendering="crispEdges"/>`;

  // left: numbers grid + customers
  const cellW = (leftW - 10) / 2;
  d.stats.slice(0, 4).forEach((st, i) => {
    const cx = pad + (i % 2) * (cellW + 10);
    const cy = 160 + Math.floor(i / 2) * 70;
    s += pxBox(cx, cy, cellW, 60, { fill: t.panel, stroke: t.line, border: 2, step: 3 });
    s += text(cx + 12, cy + 22, st.label.toUpperCase(), { font: "led", size: 16, fill: t.muted, spacing: 1 });
    s += text(cx + 12, cy + 50, fit(st.value, "led", 32, cellW - 20), { font: "led", size: 32, fill: t.led });
  });
  let ly = 160 + Math.ceil(Math.min(4, d.stats.length) / 2) * 70 + 12;
  if (d.customers.length) {
    s += text(pad, ly + 4, "CUSTOMERS", { font: "led", size: 16, fill: t.muted, spacing: 1 });
    ly += 24;
    for (const line of wrap(d.customers.join(" · "), "b4", 13, leftW, 5)) {
      s += text(pad, ly, line, { font: "b4", size: 13, fill: t.text });
      ly += 18;
    }
  }

  // right: services price list
  let ry = 164;
  s += text(rightX, ry, "SERVICES", { font: "led", size: 16, fill: t.muted, spacing: 1 });
  ry += 12;
  for (const sv of d.services) {
    const priceW = measure(sv.price, "led", 20);
    s += pxBox(rightX, ry, rightW, 50, { fill: t.panel, stroke: t.line, border: 1, step: 2 });
    s += `<rect x="${rightX + 1}" y="${ry + 1}" width="4" height="48" fill="${t.accent}" shape-rendering="crispEdges"/>`;
    s += text(rightX + 16, ry + 21, fit(sv.title, "b6", 15, rightW - 30), { font: "b6", size: 15, fill: t.text });
    if (sv.subtitle) s += text(rightX + 16, ry + 40, fit(sv.subtitle, "b4", 12, rightW - 30 - priceW - 16), { font: "b4", size: 12, fill: t.muted });
    s += text(rightX + rightW - 12, ry + 41, sv.price, { font: "led", size: 20, fill: t.led, anchor: "end" });
    ry += 56;
  }
  const H = Math.max(ly, ry) + 22;
  const frame = cardFrame(CARD_W, H, t, "uto", { x: 0.95, y: 0 });
  return svgDocument(CARD_W, H, `${d.name} — ${d.tagline}`, frame.body + s, frame.defs);
}
