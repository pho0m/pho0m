import type { IconName } from "@pho0m/content";
import { measure, wrap } from "../font/fonts.ts";
import { CARD_W, pxBox, sprite, sprockets, text } from "./kit.ts";
import type { Theme } from "./theme.ts";
import { svgDocument } from "./xml.ts";

export type BandData = { number: number; title: string; description: string; icon: IconName };

/** Section divider: a strip of film leader with a frame number, title, line of text and a sprite. */
export function bandCard(d: BandData, t: Theme): string {
  const H = 100;
  let s = pxBox(0, 0, CARD_W, H, { fill: t.strip, stroke: t.line2, border: 2, step: 4 });
  s += sprockets(18, CARD_W - 18, 9, { fill: t.stripHole, w: 12, h: 8, pitch: 24 });
  s += sprockets(18, CARD_W - 18, H - 17, { fill: t.stripHole, w: 12, h: 8, pitch: 24 });

  const num = String(d.number).padStart(2, "0");
  const numW = measure(num, "led", 44);
  s += text(28, 65, num, { font: "led", size: 44, fill: t.accent });
  const title = d.title.toUpperCase();
  const titleX = 28 + numW + 12;
  s += text(titleX, 63, title, { font: "px7", size: 34, fill: t.stripText, spacing: 1 });
  const titleEnd = titleX + measure(title, "px7", 34, 1);

  const spriteX = CARD_W - 28 - 48;
  const descX = Math.max(titleEnd + 28, 300);
  const lines = wrap(d.description, "b4", 15, spriteX - 24 - descX, 2);
  const top = lines.length > 1 ? 47 : 56;
  lines.forEach((line, i) => {
    s += text(descX, top + i * 20, line, { font: "b4", size: 15, fill: t.stripMuted });
  });
  s += `<rect x="${descX - 14}" y="30" width="2" height="40" fill="${t.line2}" shape-rendering="crispEdges"/>`;
  s += sprite(d.icon, spriteX, 26, 3, "color");
  return svgDocument(CARD_W, H, `${d.title} — ${d.description}`, s);
}
