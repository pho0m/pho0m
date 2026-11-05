import { frameStamp } from "@pho0m/content";
import { fit, wrap } from "../font/fonts.ts";
import type { FilmFrame } from "../model.ts";
import { duotoneFilter, negativeFilter } from "./filters.ts";
import { CARD_W, pxBox, text, triangle } from "./kit.ts";
import { motionCss, opacityKeyframes, pct, sec, type Stop } from "./motion.ts";
import { FILM, type Theme } from "./theme.ts";
import { esc, n, svgDocument } from "./xml.ts";

/** A frame's print, ready to embed (data URIs). */
export type FilmPrint = {
  /** Clear print as greyscale levels; the duotone filter turns it into ink/paper, the negative filter into the safelight negative. */
  clear: string;
  /** Two-tone developing stages, lightest first. */
  developing: string[];
  /** Pixel-art scenes are drawn pixelated; photos smooth. */
  pixelated: boolean;
};
export type FilmCardFrame = FilmFrame & { print: FilmPrint };

const IMG_W = 128;
const IMG_H = 88;
const PAD = 6;
const PW = IMG_W + 2 * PAD;
const PH = IMG_H + 2 * PAD;
const H = 300;
const STRIP_Y = 14;
const STRIP_H = H - 28;
const EDGE_Y = 52;
const PRINT_Y = 62;

/**
 * Timing of the strip, in seconds. Each step the film rests while the frame in the gate
 * flashes and develops from the dither into the clear print (DEV → STOP → FIX → DRY), then
 * advances one frame to the RIGHT in pixel-y jumps (the last `move` seconds of the step).
 */
export const ROLL = { step: 2.4, move: 0.5, flash: 0.16, stage: 0.45, fix: 1.05, dry: 1.55 } as const;

function holes(slots: number[], pitch: number, y: number, fill: string): string {
  const per = Math.max(1, Math.round(pitch / 26));
  const gap = pitch / per;
  const w = 14;
  const h = 10;
  let d = "";
  for (const s of slots)
    for (let k = 0; k < per; k++) {
      const x = s * pitch + (k + 0.5) * gap - w / 2;
      d += `M${n(x + 1)} ${y}h${w - 2}v1h1v${h - 2}h-1v1h${-(w - 2)}v-1h-1v${-(h - 2)}h1z`;
    }
  return `<path d="${d}" fill="${fill}"/>`;
}

/** Gate brackets at a slot (fixed; the film moves under them). */
function gate(x: number): string {
  const x0 = x - 9;
  const y0 = PRINT_Y - 9;
  const x1 = x + PW + 9;
  const y1 = PRINT_Y + PH + 9;
  const L = 16;
  const T = 3;
  const d =
    `M${x0} ${y0}h${L}v${T}h${-(L - T)}v${L - T}h${-T}z` +
    `M${x1} ${y0}h${-L}v${T}h${L - T}v${L - T}h${T}z` +
    `M${x0} ${y1}h${L}v${-T}h${-(L - T)}v${-(L - T)}h${-T}z` +
    `M${x1} ${y1}h${-L}v${-T}h${L - T}v${-(L - T)}h${T}z`;
  return `<path d="${d}" fill="${FILM.stamp}" shape-rendering="crispEdges"/>`;
}

/**
 * The latest timeline frames on a 35 mm strip. Like the site, newer frames sit further LEFT and
 * the film runs to the RIGHT, so frames reach the gate in date order. Static card: the newest
 * `visible` frames as clear prints. Animated: the strip loops through every frame given; frames
 * left of the gate are negatives, each one flashes and develops in the gate, and leaves as a print.
 */
export function filmCard(frames: FilmCardFrame[], handle: string, t: Theme, visible = 5): string {
  const N = frames.length;
  const V = Math.max(1, Math.min(visible, N));
  const p = CARD_W / V;
  const g = Math.floor(V / 2);
  const animate = N >= 2;
  const cycle = N * ROLL.step;
  const offset = (p - PW) / 2;

  let defs = duotoneFilter("duo") + negativeFilter("neg");
  defs += `<clipPath id="strip"><rect x="2" y="${STRIP_Y}" width="${CARD_W - 4}" height="${STRIP_H}"/></clipPath>`;
  defs += `<radialGradient id="gate-glow"><stop offset="0" stop-color="#fffaf0" stop-opacity="0.55"/><stop offset="1" stop-color="${FILM.stamp}" stop-opacity="0"/></radialGradient>`;
  frames.forEach((f, j) => {
    const pix = f.print.pixelated ? ` image-rendering="optimizeSpeed" style="image-rendering:pixelated"` : "";
    defs += `<image id="c${j}" width="${IMG_W}" height="${IMG_H}" href="${esc(f.print.clear)}" preserveAspectRatio="none"${pix}/>`;
    f.print.developing.forEach((uri, k) => {
      defs += `<image id="d${j}-${k}" width="${IMG_W}" height="${IMG_H}" href="${esc(uri)}" preserveAspectRatio="none" image-rendering="optimizeSpeed" style="image-rendering:pixelated"/>`;
    });
  });

  let body = pxBox(0, 0, CARD_W, H, { fill: t.bg, stroke: t.line2, border: 2, step: 4 });
  body += `<rect x="2" y="${STRIP_Y}" width="${CARD_W - 4}" height="${STRIP_H}" fill="${FILM.base}"/>`;

  const slots: number[] = [];
  for (let s = animate ? -N : 0; s < Math.max(N, V); s++) slots.push(s);
  const holeFill = t.name === "dark" ? FILM.hole : t.bg;
  let roll = holes(slots, p, STRIP_Y + 8, holeFill) + holes(slots, p, STRIP_Y + STRIP_H - 18, holeFill);

  let css = "";
  let e = 0;
  const edge = `${handle.toUpperCase()} 400`;
  for (const set of animate ? [-1, 0] : [0]) {
    frames.forEach((f, j) => {
      const slot = N - 1 - j + set * N;
      const x = slot * p + offset;
      // after how many advances this copy rests in the gate (0..N-1), if it does in this loop
      const step = g - slot;
      const exposed = animate && step >= 0 && step < N;
      const negative = animate && !exposed && set < 0;
      let s = `<g transform="translate(${n(x)} 0)">`;
      s += text(0, EDGE_Y, fit(edge, "led", 14, PW - 40, 1), { font: "led", size: 14, fill: FILM.edge, spacing: 1, opacity: 0.75 });
      s += triangle(PW - 30, EDGE_Y - 5, 9, FILM.edge);
      s += text(PW, EDGE_Y, String(f.number).padStart(2, "0"), { font: "led", size: 16, fill: FILM.edge, anchor: "end", spacing: 1 });
      s += `<rect x="-5" y="${PRINT_Y - 5}" width="${PW + 10}" height="${PH + 10}" fill="#160403"/>`;
      s += `<rect y="${PRINT_Y}" width="${PW}" height="${PH}" fill="${FILM.paper}"/>`;
      s += `<use href="#c${j}" x="${PAD}" y="${PRINT_Y + PAD}" filter="url(#duo)"/>`;
      if (exposed) {
        f.print.developing.forEach((_, k) => {
          s += `<use class="d${e}-${k}" href="#d${j}-${k}" x="${PAD}" y="${PRINT_Y + PAD}" opacity="0"/>`;
        });
      }
      if (exposed || negative) {
        s += `<g class="ng${e}" opacity="${negative ? 1 : 0}"><rect y="${PRINT_Y}" width="${PW}" height="${PH}" fill="${FILM.base}"/>`;
        s += `<use href="#c${j}" x="${PAD}" y="${PRINT_Y + PAD}" filter="url(#neg)"/></g>`;
      }
      s += text(PW - PAD - 3, PRINT_Y + PH - PAD - 4, frameStamp(f.frame), { font: "led", size: 15, fill: FILM.stamp, anchor: "end", spacing: 1 });
      if (j === N - 1) {
        s += `<rect x="-3" y="${PRINT_Y - 3}" width="${PW + 6}" height="${PH + 6}" fill="none" stroke="${FILM.stamp}" stroke-width="2" shape-rendering="crispEdges"/>`;
      }
      const capY = PRINT_Y + PH + 26;
      s += text(0, capY, fit(f.date.toUpperCase(), "led", 19, PW, 1), { font: "led", size: 19, fill: FILM.edge, spacing: 1 });
      wrap(f.title, "b6", 13, PW, 2).forEach((line, li) => {
        s += text(0, capY + 20 + li * 17, line, { font: "b6", size: 13, fill: FILM.text });
      });
      s += `</g>`;
      roll += s;

      if (exposed) {
        const h = step * ROLL.step;
        const R = ROLL;
        css += `.ng${e}{animation:ng${e} ${sec(cycle)} steps(1,end) infinite}`;
        css += opacityKeyframes(`ng${e}`, cycle, h > 0 ? [{ at: 0, opacity: 1 }, { at: h, opacity: 0 }, { at: cycle, opacity: 0 }] : [{ at: 0, opacity: 0 }, { at: cycle, opacity: 0 }]);
        const stages = f.print.developing.length;
        const each = R.fix / Math.max(1, stages);
        f.print.developing.forEach((_, k) => {
          const start = h + k * each;
          const before: Stop[] = start > 0 ? [{ at: 0, opacity: 0 }] : [];
          const stops: Stop[] =
            k === stages - 1
              ? [...before, { at: start, opacity: 1 }, { at: h + R.fix, opacity: 1, ease: "steps(4,end)" }, { at: h + R.dry, opacity: 0 }, { at: cycle, opacity: 0 }]
              : [...before, { at: start, opacity: 1 }, { at: h + (k + 1) * each, opacity: 0 }, { at: cycle, opacity: 0 }];
          css += `.d${e}-${k}{animation:d${e}-${k} ${sec(cycle)} steps(1,end) infinite}`;
          css += opacityKeyframes(`d${e}-${k}`, cycle, stops);
        });
      }
      e++;
    });
  }
  body += `<g clip-path="url(#strip)"><g class="roll">${roll}</g></g>`;

  const gx = g * p + offset;
  body += gate(gx);
  body += `<g class="flash" opacity="0"><rect x="${n(gx - 40)}" y="${PRINT_Y - 40}" width="${PW + 80}" height="${PH + 80}" fill="url(#gate-glow)"/>`;
  body += `<rect x="${n(gx)}" y="${PRINT_Y}" width="${PW}" height="${PH}" fill="#fffaf0"/></g>`;

  if (animate) {
    let kf = "";
    for (let s = 0; s < N; s++) {
      kf += `${pct(s * ROLL.step, cycle)}{transform:translate(${n(s * p)}px,0px)}`;
      kf += `${pct((s + 1) * ROLL.step - ROLL.move, cycle)}{transform:translate(${n(s * p)}px,0px);animation-timing-function:steps(8,end)}`;
    }
    kf += `100%{transform:translate(${n(N * p)}px,0px)}`;
    css = `.roll{animation:roll ${sec(cycle)} linear infinite}@keyframes roll{${kf}}` + css;
    css += `.flash{animation:flash ${sec(ROLL.step)} steps(1,end) infinite}`;
    css += opacityKeyframes("flash", ROLL.step, [{ at: 0, opacity: 1 }, { at: ROLL.flash / 2, opacity: 0.55 }, { at: ROLL.flash, opacity: 0 }, { at: ROLL.step, opacity: 0 }]);
  }
  const title = `Film strip: the latest ${N} timeline frames`;
  return svgDocument(CARD_W, H, title, body, defs, motionCss(css));
}
