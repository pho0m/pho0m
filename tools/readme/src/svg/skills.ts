import type { SkillGroup } from "@pho0m/content";
import { fit, measure } from "../font/fonts.ts";
import { en } from "../model.ts";
import { brandIcon } from "./glyphs.ts";
import { CARD_W, brandPath, cardFrame, levelDots, monogram, pxBox, text } from "./kit.ts";
import type { Theme } from "./theme.ts";
import { svgDocument } from "./xml.ts";

const CHIP_H = 32;
const GAP = 8;

/** One skill tier: title, level dots, description, and wrapped logo chips. */
export function skillsCard(g: SkillGroup, t: Theme): string {
  const pad = 28;
  const title = en(g.title);
  const desc = en(g.description);
  let s = "";
  s += text(pad, 50, fit(title, "px7", 26, 420), { font: "px7", size: 26, fill: t.text });
  const dotsX = pad + Math.min(420, measure(title, "px7", 26)) + 18;
  s += levelDots(g.level, 3, dotsX, 33, 13, 5, t);
  s += text(dotsX + 3 * 18 + 10, 46, `LV ${g.level}/3`, { font: "led", size: 18, fill: t.led, spacing: 1 });
  const count = `${g.items.length} ${g.items.length === 1 ? "ITEM" : "ITEMS"}`;
  s += text(CARD_W - pad, 46, count, { font: "led", size: 18, fill: t.muted, anchor: "end", spacing: 1 });
  if (desc) s += text(pad, 76, fit(desc, "b4", 14, CARD_W - 2 * pad), { font: "b4", size: 14, fill: t.muted });

  let x = pad;
  let y = desc ? 96 : 72;
  const maxX = CARD_W - pad;
  for (const item of g.items) {
    const name = fit(item.name, "b6", 14, 300);
    const w = Math.ceil(10 + 16 + 8 + measure(name, "b6", 14) + 12);
    if (x + w > maxX && x > pad) {
      x = pad;
      y += CHIP_H + GAP;
    }
    s += pxBox(x, y, w, CHIP_H, { fill: t.panel, stroke: t.line, border: 2, step: 3 });
    const icon = brandIcon(item.slug);
    if (icon) s += brandPath(icon.path, x + 10, y + 8, 16, t.led);
    else s += monogram(item.name, x + 10, y + 8, 16, t.accent, t.onAccent);
    s += text(x + 34, y + 21, name, { font: "b6", size: 14, fill: t.text });
    x += w + GAP;
  }
  const H = y + (g.items.length ? CHIP_H : 0) + 26;
  const frame = cardFrame(CARD_W, H, t, `sk${g.level}`, null);
  return svgDocument(CARD_W, H, `${title}: ${g.items.map((i) => i.name).join(", ")}`, frame.body + s, frame.defs);
}
