import type { IconName } from "@pho0m/content";
import { measure, wrap } from "../font/fonts.ts";
import { CARD_W, pxBox, sprite, sprockets, text } from "./kit.ts";
import { motionCss, sec } from "./motion.ts";
import type { Theme } from "./theme.ts";
import { n, svgDocument } from "./xml.ts";

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
  // pixel shadow + the sprite, which hops in place (static card: standing still)
  s += `<rect class="shd" x="${spriteX + 9}" y="75" width="30" height="3" fill="${t.stripMuted}" fill-opacity="0.35" shape-rendering="crispEdges"/>`;
  s += `<g class="bob">${sprite(d.icon, spriteX, 26, 3)}</g>`;
  return svgDocument(CARD_W, H, `${d.title} — ${d.description}`, s, "", motionCss(bounceCss(-0.45 * d.number)));
}

/** Seconds per hop. */
export const HOP = 1.8;

/**
 * A pixel-art hop: anticipation squash, jump (in 3 px steps, one sprite pixel), stretch at the top,
 * land, squash, recover, rest. steps() keeps every pose on the pixel grid instead of gliding.
 */
export function bounceCss(delay: number): string {
  const pose = (at: number, y: number, sx: number, sy: number, steps: number) =>
    `${at}%{transform:translate(0px,${y}px) scale(${n(sx)},${n(sy)});animation-timing-function:steps(${steps},end)}`;
  const bob = [
    pose(0, 0, 1, 1, 1),
    pose(10, 0, 1.12, 0.84, 4),
    pose(30, -12, 0.92, 1.1, 2),
    pose(40, -12, 1, 1, 4),
    pose(58, 0, 0.94, 1.08, 1),
    pose(62, 0, 1.2, 0.78, 2),
    pose(72, 0, 1, 1, 1),
    pose(100, 0, 1, 1, 1),
  ].join("");
  const shadow = ["0%{transform:scale(1,1);animation-timing-function:steps(1,end)}", "10%{transform:scale(1.15,1);animation-timing-function:steps(4,end)}", "30%{transform:scale(.6,1);animation-timing-function:steps(1,end)}", "40%{transform:scale(.6,1);animation-timing-function:steps(4,end)}", "58%{transform:scale(1,1);animation-timing-function:steps(1,end)}", "62%{transform:scale(1.25,1);animation-timing-function:steps(2,end)}", "72%{transform:scale(1,1)}", "100%{transform:scale(1,1)}"].join("");
  return (
    `.bob,.shd{transform-box:fill-box;animation:bob ${sec(HOP)} ${sec(delay)} infinite}` +
    `.bob{transform-origin:50% 100%}.shd{transform-origin:50% 50%;animation-name:shd}` +
    `@keyframes bob{${bob}}@keyframes shd{${shadow}}`
  );
}
