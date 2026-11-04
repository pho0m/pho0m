import { CARD_W, sprockets, text } from "./kit.ts";
import type { Theme } from "./theme.ts";
import { svgDocument } from "./xml.ts";

/** Thin film tail that closes the README: "END OF ROLL" between two rows of sprocket holes. */
export function rollEndCard(label: string, t: Theme): string {
  const H = 44;
  let s = `<rect width="${CARD_W}" height="${H}" fill="${t.strip}"/>`;
  s += sprockets(8, CARD_W - 8, 5, { fill: t.stripHole, w: 10, h: 7, pitch: 20 });
  s += sprockets(8, CARD_W - 8, H - 12, { fill: t.stripHole, w: 10, h: 7, pitch: 20 });
  s += text(CARD_W / 2, 27, label, { font: "led", size: 16, fill: t.stripEdge, anchor: "middle", spacing: 3 });
  return svgDocument(CARD_W, H, label, s);
}
