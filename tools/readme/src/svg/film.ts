import { frameStamp } from "@pho0m/content";
import { fit, wrap } from "../font/fonts.ts";
import type { FilmFrame } from "../model.ts";
import { CARD_W, ditherDefs, ditherFill, pxBox, sprite, sprockets, text, triangle } from "./kit.ts";
import { FILM, type Theme } from "./theme.ts";
import { n, svgDocument } from "./xml.ts";

const PRINT_W = 148;
const PRINT_H = 112;
const HORIZON = 88;

/** One frame's paper print: dithered sky, horizon, ground, the sprite as a two-tone print and a date imprint. */
function print(f: FilmFrame, x: number, y: number, newest: boolean, t: Theme): string {
  const P = "fd";
  let s = `<g transform="translate(${n(x)} ${n(y)})">`;
  s += `<rect width="${PRINT_W}" height="${PRINT_H}" fill="${FILM.paper}"/>`;
  // sky: darker at the top, fading to paper (2x2 Bayer tiles)
  const bands: [number, number, number][] = [[0, 6, 2], [6, 18, 1]];
  for (const [y0, y1, level] of bands) {
    s += `<rect y="${y0}" width="${PRINT_W}" height="${y1 - y0}" fill="${ditherFill(P, level)}"/>`;
  }
  s += `<rect y="${HORIZON + 2}" width="${PRINT_W}" height="6" fill="${ditherFill(P, 1)}"/>`;
  s += `<rect y="${HORIZON}" width="${PRINT_W}" height="2" fill="${FILM.ink}"/>`;
  // 16x16 sprite at 4x, aligned to the 4 px dither grid, standing on the horizon
  s += sprite(f.frame.icon, 40, HORIZON - 64, 4, "print", P);
  s += text(PRINT_W - 6, PRINT_H - 5, frameStamp(f.frame), { font: "led", size: 17, fill: FILM.stamp, anchor: "end", spacing: 1 });
  s += `</g>`;
  if (newest) {
    s += `<rect x="${n(x - 3)}" y="${n(y - 3)}" width="${PRINT_W + 6}" height="${PRINT_H + 6}" fill="none" stroke="${FILM.stamp}" stroke-width="2" shape-rendering="crispEdges"/>`;
  }
  return s;
}

/** The latest timeline frames on a 35 mm strip, newest on the right (the film runs to the right). */
export function filmCard(frames: FilmFrame[], handle: string, t: Theme): string {
  const H = 300;
  const stripY = 14;
  const stripH = H - 28;
  let s = pxBox(0, 0, CARD_W, H, { fill: t.bg, stroke: t.line2, border: 2, step: 4 });
  s += `<rect x="2" y="${stripY}" width="${CARD_W - 4}" height="${stripH}" fill="${FILM.base}"/>`;
  s += sprockets(10, CARD_W - 10, stripY + 10, { fill: t.name === "dark" ? FILM.hole : t.bg, w: 14, h: 10, pitch: 26 });
  s += sprockets(10, CARD_W - 10, stripY + stripH - 20, { fill: t.name === "dark" ? FILM.hole : t.bg, w: 14, h: 10, pitch: 26 });

  const count = Math.max(1, frames.length);
  const margin = 24;
  const gap = count > 1 ? (CARD_W - 2 * margin - count * PRINT_W) / (count - 1) : 0;
  const printY = stripY + 52;
  const edgeY = stripY + 42;
  const edge = `${handle.toUpperCase()} 400`;
  s += text(margin, edgeY, edge, { font: "led", size: 16, fill: FILM.edge, spacing: 2, opacity: 0.85 });

  frames.forEach((f, i) => {
    const x = count > 1 ? margin + i * (PRINT_W + gap) : (CARD_W - PRINT_W) / 2;
    const numX = x + PRINT_W;
    s += triangle(numX - 34, edgeY - 5, 9, FILM.edge);
    s += text(numX, edgeY, String(f.number).padStart(2, "0"), { font: "led", size: 16, fill: FILM.edge, anchor: "end", spacing: 1 });
    // dark gap of the frame window around the print
    s += `<rect x="${n(x - 5)}" y="${printY - 5}" width="${PRINT_W + 10}" height="${PRINT_H + 10}" fill="#160403"/>`;
    s += print(f, x, printY, i === frames.length - 1, t);
    const capY = printY + PRINT_H + 26;
    s += text(x, capY, fit(f.date.toUpperCase(), "led", 19, PRINT_W, 1), { font: "led", size: 19, fill: FILM.edge, spacing: 1 });
    wrap(f.title, "b6", 13, PRINT_W, 2).forEach((line, j) => {
      s += text(x, capY + 20 + j * 17, line, { font: "b6", size: 13, fill: FILM.text });
    });
  });
  const title = `Film strip: the latest ${frames.length} timeline frames`;
  return svgDocument(CARD_W, H, title, s, ditherDefs("fd"));
}
