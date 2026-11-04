import { fit, measure, sentences, sentencesThatFit, wrap } from "../font/fonts.ts";
import type { Stat } from "../model.ts";
import { duotoneFilter, posterizeFilter } from "./filters.ts";
import { CARD_W, cardFrame, pxBox, pxRectPath, text, triangle } from "./kit.ts";
import { motionCss, opacityKeyframes, sec } from "./motion.ts";
import { FILM, type Theme } from "./theme.ts";
import { esc, n, svgDocument } from "./xml.ts";

/**
 * Avatar ready to embed:
 *   print  a pre-toned greyscale print (shown through the duotone filter) plus the two-tone
 *          dithers it develops through, lightest first (decodable JPEG/PNG uploads)
 *   raw    the uploaded image itself under the duotone filter (any other format the browser shows)
 */
export type AvatarImage = { kind: "print"; clear: string; developing: string[] } | { kind: "raw"; uri: string } | null;

export type HeroData = {
  name: string;
  handle: string;
  location: string;
  role: string;
  headline: string;
  bio: string;
  stats: Stat[];
  avatar: AvatarImage;
  avatarInitial: string;
};

export const DEV_STEPS = ["DEV", "STOP", "FIX", "DRY"] as const;

/**
 * Developing timeline of the hero print, in seconds after the card appears. It runs once and
 * ends on the static card: the clear print with DRY lit.
 */
export const DEVELOP = {
  delay: 0.4,
  total: 3.2,
  flash: 0.3,
  /** dither stages start here and step up evenly until `fix` */
  dev: 0.45,
  stop: 1.75,
  fix: 2.25,
  dry: 3.0,
} as const;

/** DEV ▸ STOP ▸ FIX ▸ DRY developing timer. Unlit chips plus a lit layer per step (only DRY lit when static). */
export function devTimer(x: number, y: number, t: Theme): { svg: string; width: number } {
  let cx = x;
  let svg = "";
  const lit = DEV_STEPS.length - 1;
  DEV_STEPS.forEach((step, i) => {
    const w = Math.ceil(measure(step, "led", 17, 1)) + 14;
    svg += pxBox(cx, y, w, 22, { fill: t.bg, stroke: t.line2, border: 1, step: 2 });
    svg += text(cx + w / 2, y + 16, step, { font: "led", size: 17, fill: t.muted, anchor: "middle", spacing: 1 });
    svg += `<g class="lit lit${i}"${i === lit ? "" : ` opacity="0"`}>`;
    svg += pxBox(cx, y, w, 22, { fill: t.accent, step: 2 });
    svg += text(cx + w / 2, y + 16, step, { font: "led", size: 17, fill: t.onAccent, anchor: "middle", spacing: 1 });
    svg += `</g>`;
    cx += w;
    if (i < DEV_STEPS.length - 1) {
      svg += triangle(cx + 5, y + 11, 7, t.accent);
      cx += 16;
    }
  });
  return { svg, width: cx - x };
}

/** CSS that develops the avatar print once and lights the timer chips in step with it. */
function developCss(stages: number): string {
  const D = DEVELOP;
  const run = (cls: string, name: string) => `.${cls}{animation:${name} ${sec(D.total)} ${sec(D.delay)} steps(1,end) both}`;
  let css = "";
  css += run("av-flash", "avf") + opacityKeyframes("avf", D.total, [{ at: 0, opacity: 0.95 }, { at: D.flash / 2, opacity: 0.5 }, { at: D.flash, opacity: 0 }, { at: D.total, opacity: 0 }]);
  css += run("av-blank", "avb") + opacityKeyframes("avb", D.total, [{ at: 0, opacity: 1 }, { at: D.dev, opacity: 0 }, { at: D.total, opacity: 0 }]);
  const step = (D.stop - D.dev) / Math.max(1, stages);
  for (let i = 0; i < stages; i++) {
    const start = D.dev + i * step;
    const last = i === stages - 1;
    const stops = last
      ? [{ at: 0, opacity: 0 }, { at: start, opacity: 1 }, { at: D.fix, opacity: 1, ease: "steps(5,end)" }, { at: D.dry, opacity: 0 }, { at: D.total, opacity: 0 }]
      : [{ at: 0, opacity: 0 }, { at: start, opacity: 1 }, { at: start + step, opacity: 0 }, { at: D.total, opacity: 0 }];
    css += run(`av-d${i}`, `avd${i}`) + opacityKeyframes(`avd${i}`, D.total, stops);
  }
  const chips: [number, number][] = [[D.flash / 2, D.stop], [D.stop, D.fix], [D.fix, D.dry], [D.dry, D.total]];
  chips.forEach(([on, off], i) => {
    const stops = i === chips.length - 1
      ? [{ at: 0, opacity: 0 }, { at: on, opacity: 1 }, { at: D.total, opacity: 1 }]
      : [{ at: 0, opacity: 0 }, { at: on, opacity: 1 }, { at: off, opacity: 0 }, { at: D.total, opacity: 0 }];
    css += run(`lit${i}`, `lit${i}`) + opacityKeyframes(`lit${i}`, D.total, stops);
  });
  // the LED cursor after the name keeps blinking
  css += `.cursor{animation:blink 1.06s steps(1,end) infinite}@keyframes blink{0%{opacity:1}50%{opacity:0}100%{opacity:0}}`;
  return css;
}

function avatarPrint(d: HeroData, x: number, y: number, t: Theme): { svg: string; stages: number } {
  const pw = 196;
  const ph = 238;
  const img = 176;
  let s = "";
  let stages = 0;
  // drop shadow, paper, tape
  s += `<path d="${pxRectPath(x + 6, y + 7, pw, ph, 3)}" fill="${t.shadow}" fill-opacity="${n(t.shadowOpacity)}"/>`;
  s += pxBox(x, y, pw, ph, { fill: FILM.paper, step: 3 });
  const ix = x + 10;
  const iy = y + 10;
  const box = `x="${ix}" y="${iy}" width="${img}" height="${img}"`;
  if (d.avatar) {
    const clear = d.avatar.kind === "print" ? d.avatar.clear : d.avatar.uri;
    const fit = d.avatar.kind === "print" ? "none" : "xMidYMid slice";
    s += `<image id="av-src" ${box} href="${esc(clear)}" preserveAspectRatio="${fit}" filter="url(#duotone)"/>`;
    // developing layers (hidden in the static card): blank paper, the dither stages, then the flash
    s += `<rect class="av-blank" ${box} fill="${FILM.paper}" opacity="0"/>`;
    if (d.avatar.kind === "print") {
      d.avatar.developing.forEach((uri, i) => {
        s += `<image class="av-d${i}" ${box} href="${esc(uri)}" opacity="0" image-rendering="optimizeSpeed" style="image-rendering:pixelated" preserveAspectRatio="none"/>`;
      });
      stages = d.avatar.developing.length;
    } else {
      // no dither without decoding: a posterized copy stands in for the developing stage
      s += `<use class="av-d0" href="#av-src" opacity="0" filter="url(#poster)"/>`;
      stages = 1;
    }
    s += `<rect class="av-flash" ${box} fill="#fffaf0" opacity="0"/>`;
  } else {
    s += `<rect ${box} fill="${FILM.ink}"/>`;
    s += text(ix + img / 2, iy + img / 2 + 34, d.avatarInitial, { font: "px7", size: 96, fill: FILM.paper, anchor: "middle" });
  }
  s += `<rect ${box} fill="none" stroke="${FILM.ink}" stroke-opacity="0.35"/>`;
  s += text(ix, y + ph - 18, fit(`@${d.handle}`, "led", 22, 100), { font: "led", size: 22, fill: FILM.ink });
  if (d.location) {
    s += text(ix + img, y + ph - 18, fit(d.location.toUpperCase(), "led", 17, 70, 1), {
      font: "led", size: 17, fill: FILM.ink, anchor: "end", spacing: 1, opacity: 0.7,
    });
  }
  s += `<rect x="${x + pw / 2 - 32}" y="${y - 8}" width="64" height="18" fill="${t.accent}" fill-opacity="0.55" shape-rendering="crispEdges"/>`;
  return { svg: s, stages };
}

/** Left edge and width of the hero's text column (everything right of the avatar print). */
export const HERO_TEXT_X = 266;
export const HERO_TEXT_W = CARD_W - HERO_TEXT_X - 34;
const CHIP_H = 38;
const CHIP_GAP = 8;
/** The stat chips wrap onto at most this many rows. */
export const CHIP_ROWS = 2;

function chipWidth(st: Stat): number {
  return Math.ceil(12 + measure(st.value, "led", 30) + 8 + measure(st.label.toUpperCase(), "led", 16, 1) + 12);
}

type PlacedChip = { stat: Stat; x: number; row: number; w: number };

/**
 * Lay the chips out in the given (priority) order, wrapping onto up to CHIP_ROWS rows. The first
 * chip that does not fit ends the layout: it and every chip after it are `dropped`, so a later,
 * lower-priority fact never takes the place of an earlier one.
 */
export function layoutChips(stats: Stat[], maxW = HERO_TEXT_W, maxRows = CHIP_ROWS): { placed: PlacedChip[]; dropped: Stat[]; rows: number } {
  const placed: PlacedChip[] = [];
  let row = 0;
  let cx = 0;
  let i = 0;
  for (; i < stats.length; i++) {
    const st = stats[i]!;
    const w = chipWidth(st);
    if (w > maxW) break;
    if (cx > 0 && cx + w > maxW) {
      row++;
      cx = 0;
    }
    if (row >= maxRows) break;
    placed.push({ stat: st, x: cx, row, w });
    cx += w + CHIP_GAP;
  }
  return { placed, dropped: stats.slice(i), rows: placed.length ? placed[placed.length - 1]!.row + 1 : 0 };
}

/** Which stats the hero card draws and which it has no room for (the alt text must match `shown`). */
export function heroChips(stats: Stat[]): { shown: Stat[]; dropped: Stat[] } {
  const { placed, dropped } = layoutChips(stats);
  return { shown: placed.map((p) => p.stat), dropped };
}

function statChips(stats: Stat[], x: number, y: number, t: Theme): { svg: string; height: number } {
  const { placed, rows } = layoutChips(stats);
  let s = "";
  for (const { stat: st, x: dx, row, w } of placed) {
    const cx = x + dx;
    const cy = y + row * (CHIP_H + CHIP_GAP);
    s += pxBox(cx, cy, w, CHIP_H, { fill: t.panel, stroke: t.line, border: 2, step: 3 });
    s += text(cx + 12, cy + 28, st.value, { font: "led", size: 30, fill: t.led });
    s += text(cx + 12 + measure(st.value, "led", 30) + 8, cy + 26, st.label.toUpperCase(), { font: "led", size: 16, fill: t.muted, spacing: 1 });
  }
  return { svg: s, height: rows ? rows * CHIP_H + (rows - 1) * CHIP_GAP : 0 };
}

const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}+#]+/gu) ?? [];

/** Bio without sentences that only repeat the headline (most of their words already appear there). */
export function bioWithoutEcho(bio: string, headline: string): string {
  const head = new Set(words(headline));
  return sentences(bio)
    .filter((s) => {
      const w = words(s);
      return !w.length || w.filter((x) => head.has(x)).length / w.length < 0.7;
    })
    .join(" ");
}

export function heroCard(d: HeroData, t: Theme): string {
  const avatar = avatarPrint(d, 34, 34, t);
  let body = avatar.svg;

  const x = HERO_TEXT_X;
  const maxW = HERO_TEXT_W;
  body += devTimer(x, 30, t).svg;

  // the name, then a blinking LED cursor
  const cursorGap = 8;
  let nameSize = 46;
  const cursorW = (size: number) => Math.round(size * 0.42);
  while (nameSize > 26 && measure(d.name, "px7", nameSize) + cursorGap + cursorW(nameSize) > maxW) nameSize -= 2;
  const name = fit(d.name, "px7", nameSize, maxW - cursorGap - cursorW(nameSize));
  body += text(x - 2, 104, name, { font: "px7", size: nameSize, fill: t.text });
  const cw = cursorW(nameSize);
  const ch = Math.round(nameSize * 0.68);
  body += `<rect class="cursor" x="${n(x - 2 + measure(name, "px7", nameSize) + cursorGap)}" y="${104 - ch}" width="${cw}" height="${ch}" fill="${t.led}" shape-rendering="crispEdges"/>`;
  body += text(x, 136, fit(d.role, "b6", 19, maxW), { font: "b6", size: 19, fill: t.accent });

  let y = 170;
  const headline = wrap(d.headline, "b4", 20, maxW, 2);
  for (const line of headline) {
    body += text(x, y, line, { font: "b4", size: 20, fill: t.text });
    y += 25;
  }
  const bioText = bioWithoutEcho(d.bio, d.headline);
  const bio = bioText ? wrap(sentencesThatFit(bioText, "b4", 14, maxW, 2), "b4", 14, maxW, 2) : [];
  y += 1;
  for (const line of bio) {
    body += text(x, y, line, { font: "b4", size: 14, fill: t.muted });
    y += 19;
  }
  const chipsY = Math.max(236, y + 6);
  const chips = statChips(d.stats, x, chipsY, t);
  body += chips.svg;
  const H = Math.max(310, chipsY + Math.max(chips.height, CHIP_H) + 28);
  const frame = cardFrame(CARD_W, H, t, "hero", { x: 0.1, y: 0.05 });
  body = frame.body + body;

  const defs =
    frame.defs + (d.avatar ? duotoneFilter("duotone") : "") + (d.avatar?.kind === "raw" ? posterizeFilter("poster") : "");
  return svgDocument(CARD_W, H, `${d.name} — ${d.role}`, body, defs, motionCss(developCss(avatar.stages)));
}
