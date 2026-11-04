import { DARKROOM } from "@pho0m/content";
import { FRAME_H, FRAME_W, duotoneAt, hexRgb, mixRgb, negativeAt, type Rgb } from "../image/darkroom.ts";
import { Canvas, dotFit, dotSafe, textWidth } from "./canvas.ts";
import { encodeGif, mergeStill, type GifFrame } from "./encode.ts";

/**
 * The darkroom film strip as an animated GIF (README banner): the latest frames on a 35 mm
 * strip that runs to the RIGHT. Each step the next frame (in date order) is pulled into the
 * gate, gets a flash, comes up as an ordered dither and clears into a continuous-tone duotone
 * print while the DEV ▸ STOP ▸ FIX ▸ DRY HUD lights up. Dark film with a paper border so it
 * sits well on both GitHub themes. Pure integer drawing on a fixed palette: same bytes every run.
 */

export type GifPrint = {
  /** Frame number on the whole roll (1-based). */
  number: number;
  /** "Nov 2025" */
  date: string;
  /** Camera date imprint, e.g. "'25 11". */
  stamp: string;
  title: string;
  /** Clear print, FRAME_W x FRAME_H levels (0 = ink … 255 = paper). */
  clear: Uint8Array;
  /** Developing dithers (1 = ink) for DEV_LEVELS, FRAME_W x FRAME_H each. */
  developing: Uint8Array[];
};

export const GIF_W = 840;
export const GIF_H = 260;
/** Dither levels the print comes up through in the gate (DEV). */
export const DEV_LEVELS = [0.12, 0.26, 0.4, 0.55, 0.7, 0.85, 1];
/** Milliseconds per animation tick (12.5 fps). */
export const TICK = 80;
const FIX_STEPS = [0.2, 0.4, 0.6, 0.8];
const STOP_MS = 240;
const DRY_MS = 900;

const PW = FRAME_W + 12;
const PH = FRAME_H + 12;
const STRIP_Y = 40;
const STRIP_H = 176;
const EDGE_Y = 58;
const PRINT_Y = 68;
const CAPTION_Y = 228;

/**
 * Quality steps, best first. The generator takes the first one that keeps the GIF under its
 * size budget: photos compress far worse than pixel scenes, so a roll full of photos gets
 * fewer tones and fewer in-between frames while the film advances.
 */
export const GIF_QUALITY = [
  { duoLevels: 96, negLevels: 48, moveTicks: 6 },
  { duoLevels: 64, negLevels: 32, moveTicks: 4 },
  { duoLevels: 32, negLevels: 24, moveTicks: 3 },
] as const;
export type GifQuality = (typeof GIF_QUALITY)[number];
/** Target size of the GIF in bytes. */
export const GIF_BUDGET = 1.5 * 1024 * 1024;

const HALO = [0.85, 0.6, 0.4, 0.22];

const FLASH = "#fffaf0";

/** Fixed palette: index 0 is the transparent marker, then the darkroom colours, the duotone and negative ramps and the flash halo. */
export function gifPalette(q: Pick<GifQuality, "duoLevels" | "negLevels"> = GIF_QUALITY[0]) {
  const { duoLevels: DUO_LEVELS, negLevels: NEG_LEVELS } = q;
  const named = {
    bg: DARKROOM.bg,
    bg2: DARKROOM.bg2,
    line: DARKROOM.line,
    lineDark: "#4a1812",
    red: DARKROOM.red,
    led: DARKROOM.led,
    paper: DARKROOM.paper,
    muted: DARKROOM.muted,
    base: DARKROOM.filmBase,
    hole: DARKROOM.hole,
    gap: "#160403",
    flash: FLASH,
  };
  const colors: Rgb[] = [hexRgb(DARKROOM.bg)];
  const idx = {} as Record<keyof typeof named, number>;
  for (const [k, v] of Object.entries(named)) {
    idx[k as keyof typeof named] = colors.length;
    colors.push(hexRgb(v));
  }
  const duo0 = colors.length;
  for (let i = 0; i < DUO_LEVELS; i++) colors.push(duotoneAt(i / (DUO_LEVELS - 1)));
  const neg0 = colors.length;
  for (let i = 0; i < NEG_LEVELS; i++) colors.push(negativeAt(i / (NEG_LEVELS - 1)));
  const halo0 = colors.length;
  for (const h of HALO) colors.push(mixRgb(hexRgb(DARKROOM.filmBase), hexRgb(FLASH), h));
  return {
    colors,
    transparent: 0,
    ...idx,
    duo: (level: number) => duo0 + Math.round((Math.max(0, Math.min(255, level)) / 255) * (DUO_LEVELS - 1)),
    neg: (level: number) => neg0 + Math.round((Math.max(0, Math.min(255, level)) / 255) * (NEG_LEVELS - 1)),
    halo: (k: number) => halo0 + Math.max(0, Math.min(HALO.length - 1, k)),
  };
}
export type Palette = ReturnType<typeof gifPalette>;

/** What the frame in the gate looks like at one tick. */
type GateState =
  | { kind: "flash"; strength: 0 | 1 }
  | { kind: "dev"; stage: number }
  | { kind: "fix"; amount: number }
  | { kind: "clear" };
type Hud = -1 | 0 | 1 | 2 | 3;
type Tick = { step: number; shift: number; gate: GateState; hud: Hud; caption: number; delay: number };

/**
 * The loop, tick by tick. `step` s means the strip has advanced s frames; `shift` 0..1 is the
 * move from step s toward s + 1. Frame j sits in the gate at step s when (N - 1 - j + s) mod N is
 * the gate slot, so frames come through in date order. The loop opens on the newest frame,
 * finished (DRY), so the first GIF frame is a good still.
 */
export function gifTimeline(count: number, moveTicks: number = GIF_QUALITY[0].moveTicks): Tick[] {
  const N = Math.max(1, count);
  const g = Math.floor(Math.min(5, N) / 2);
  const ticks: Tick[] = [];
  for (let k = 0; k < N; k++) {
    const s = g + 1 + k;
    for (let m = 1; m <= moveTicks && N > 1; m++) ticks.push({ step: s - 1, shift: m / moveTicks, gate: { kind: "clear" }, hud: -1, caption: s - 1, delay: TICK });
    const hold = (gate: GateState, hud: Hud, delay = TICK) => ticks.push({ step: s, shift: 0, gate, hud, caption: s, delay });
    hold({ kind: "flash", strength: 1 }, 0);
    hold({ kind: "flash", strength: 0 }, 0);
    DEV_LEVELS.forEach((_, i) => hold({ kind: "dev", stage: i }, 0));
    hold({ kind: "dev", stage: DEV_LEVELS.length - 1 }, 1, STOP_MS);
    FIX_STEPS.forEach((a) => hold({ kind: "fix", amount: a }, 2));
    hold({ kind: "clear" }, 3, DRY_MS);
  }
  const last = ticks.pop()!;
  return [last, ...ticks];
}

type Layout = { N: number; p: number; x0: number; g: number };

function layout(N: number): Layout {
  const V = Math.min(5, N);
  const p = Math.floor((GIF_W - 20) / V);
  return { N, p, x0: Math.floor((GIF_W - V * p) / 2), g: Math.floor(V / 2) };
}

function drawStatic(c: Canvas, P: Palette, handle: string, count: number) {
  // paper border with see-through stepped corners, darkroom inside
  c.rect(0, 0, GIF_W, GIF_H, P.transparent);
  c.pxBox(0, 0, GIF_W, GIF_H, P.paper, 3);
  c.pxBox(4, 4, GIF_W - 8, GIF_H - 8, P.bg, 3);
  c.text(`${dotSafe(handle) || "FILM"} 400`, 18, 14, 2, P.led);
  const label = `LATEST ${count} FRAMES`;
  c.text(label, 18 + textWidth(`${dotSafe(handle) || "FILM"} 400`, 2) + 18, 14, 2, P.muted);
  c.rect(4, STRIP_Y, GIF_W - 8, STRIP_H, P.base);
}

const CHIPS = ["DEV", "STOP", "FIX", "DRY"];

function drawHud(c: Canvas, P: Palette, lit: Hud) {
  const widths = CHIPS.map((s) => textWidth(s, 2) + 14);
  const total = widths.reduce((a, b) => a + b, 0) + (CHIPS.length - 1) * 16;
  let x = GIF_W - 18 - total;
  CHIPS.forEach((label, i) => {
    const w = widths[i]!;
    if (i === lit) {
      c.pxBox(x, 9, w, 24, P.red, 2);
      c.text(label, x + 7, 14, 2, P.bg);
    } else {
      c.pxFrame(x, 9, w, 24, P.lineDark, P.bg, 2, 2);
      c.text(label, x + 7, 14, 2, P.muted);
    }
    x += w;
    if (i < CHIPS.length - 1) {
      c.triangle(x + 5, 21, 9, i < lit ? P.red : P.line);
      x += 16;
    }
  });
}

function holes(c: Canvas, P: Palette, L: Layout, shift: number) {
  const per = Math.max(1, Math.round(L.p / 24));
  const gap = L.p / per;
  for (let s = -1; s <= L.N; s++)
    for (let k = 0; k < per; k++) {
      const x = Math.round(L.x0 + s * L.p + shift + (k + 0.5) * gap - 5);
      for (const y of [STRIP_Y + 6, STRIP_Y + STRIP_H - 14]) {
        c.rect(x + 1, y, 8, 8, P.hole);
        c.rect(x, y + 1, 10, 6, P.hole);
      }
    }
}

type Look = "negative" | "clear" | GateState;

function drawFrame(c: Canvas, P: Palette, f: GifPrint, x: number, look: Look) {
  const ix = x + 6;
  const iy = PRINT_Y + 6;
  const W = FRAME_W;
  // film edge: frame number above, the date underneath
  const num = String(f.number).padStart(2, "0");
  const nw = textWidth(num, 1);
  c.text(num, x + PW - nw, EDGE_Y, 1, P.led);
  c.triangle(x + PW - nw - 7, EDGE_Y + 3, 7, P.led);
  c.text(dotFit(dotSafe(f.date), 1, PW), x, PRINT_Y + PH + 9, 1, P.led);
  c.rect(x - 4, PRINT_Y - 4, PW + 8, PH + 8, P.gap);

  if (look === "negative") {
    c.rect(x, PRINT_Y, PW, PH, P.base);
    c.blit(ix, iy, W, FRAME_H, (i) => P.neg(f.clear[i]!));
  } else {
    c.rect(x, PRINT_Y, PW, PH, P.paper);
    if (look === "clear" || look.kind === "clear") c.blit(ix, iy, W, FRAME_H, (i) => P.duo(f.clear[i]!));
    else if (look.kind === "flash") {
      c.rect(x - 4, PRINT_Y - 4, PW + 8, PH + 8, look.strength ? P.flash : P.halo(0));
      c.rect(x, PRINT_Y, PW, PH, P.flash);
    } else if (look.kind === "dev") {
      const bits = f.developing[look.stage]!;
      c.blit(ix, iy, W, FRAME_H, (i) => (bits[i] ? P.duo(0) : P.duo(255)));
    } else {
      const bits = f.developing[f.developing.length - 1]!;
      const a = look.amount;
      c.blit(ix, iy, W, FRAME_H, (i) => P.duo((1 - a) * (bits[i] ? 0 : 255) + a * f.clear[i]!));
    }
  }
  // LED date imprint in the corner of the picture
  const sw = textWidth(f.stamp, 1);
  if (look === "negative" || typeof look === "string" || look.kind !== "flash") c.text(f.stamp, ix + W - sw - 3, iy + FRAME_H - 10, 1, P.red);
}

/** Light spilling around the gate during the flash (pixel rings, brightest first). */
function halo(c: Canvas, P: Palette, x: number, strength: number) {
  const rings = strength ? HALO.length : 2;
  for (let r = rings - 1; r >= 0; r--) {
    const pad = 6 + r * 3;
    const col = P.halo(r + (strength ? 0 : 2));
    c.rect(x - pad, PRINT_Y - pad, PW + 2 * pad, 3, col);
    c.rect(x - pad, PRINT_Y + PH + pad - 3, PW + 2 * pad, 3, col);
    c.rect(x - pad, PRINT_Y - pad, 3, PH + 2 * pad, col);
    c.rect(x + PW + pad - 3, PRINT_Y - pad, 3, PH + 2 * pad, col);
  }
}

function gateBrackets(c: Canvas, P: Palette, x: number) {
  const x0 = x - 9;
  const y0 = PRINT_Y - 9;
  const x1 = x + PW + 9;
  const y1 = PRINT_Y + PH + 9;
  const L = 16;
  for (const [cx, cy, dx, dy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]] as const) {
    c.rect(dx > 0 ? cx : cx - L, dy > 0 ? cy : cy - 3, L, 3, P.red);
    c.rect(dx > 0 ? cx : cx - 3, dy > 0 ? cy : cy - L, 3, L, P.red);
  }
}

function caption(c: Canvas, P: Palette, f: GifPrint) {
  const num = String(f.number).padStart(2, "0");
  const text = dotFit([num, dotSafe(f.date), dotSafe(f.title)].filter(Boolean).join(" · "), 2, GIF_W - 60);
  const w = textWidth(text, 2);
  c.text(text, Math.round((GIF_W - w) / 2), CAPTION_Y, 2, P.paper);
}

export type FilmGif = { bytes: Uint8Array; frames: number; durationMs: number; quality: GifQuality };

/**
 * Render and encode the film strip GIF for `prints` (oldest → newest): the best quality step
 * that fits `budget` bytes, or the smallest one when none does.
 */
export function filmGif(prints: GifPrint[], handle: string, budget = GIF_BUDGET): FilmGif {
  let out: FilmGif | null = null;
  for (const q of GIF_QUALITY) {
    out = renderFilmGif(prints, handle, q);
    if (out.bytes.byteLength <= budget) break;
  }
  return out!;
}

export function renderFilmGif(prints: GifPrint[], handle: string, quality: GifQuality = GIF_QUALITY[0]): FilmGif {
  const { frames, palette } = filmGifFrames(prints, handle, quality);
  const bytes = encodeGif(frames, { width: GIF_W, height: GIF_H, palette: palette.colors, transparentIndex: palette.transparent });
  return { bytes, frames: frames.length, durationMs: frames.reduce((a, f) => a + f.delay, 0), quality };
}

/** The animation as full-canvas palette-index frames (identical neighbours merged), before encoding. */
export function filmGifFrames(prints: GifPrint[], handle: string, quality: GifQuality = GIF_QUALITY[0]): { frames: GifFrame[]; palette: Palette } {
  if (!prints.length) throw new Error("film GIF needs at least one frame");
  const P = gifPalette(quality);
  const L = layout(prints.length);
  const { N, p, x0, g } = L;
  const frames: GifFrame[] = [];
  for (const tick of gifTimeline(N, quality.moveTicks)) {
    const c = new Canvas(GIF_W, GIF_H, P.bg);
    drawStatic(c, P, handle, N);
    drawHud(c, P, tick.hud);
    const shift = Math.round(tick.shift * p);
    c.clip(4, STRIP_Y, GIF_W - 8, STRIP_H);
    holes(c, P, L, shift);
    c.clip(x0 - 6, STRIP_Y, N > 1 ? Math.min(5, N) * p + 12 : GIF_W, STRIP_H);
    const gateX = x0 + g * p + Math.floor((p - PW) / 2);
    if (tick.gate.kind === "flash") halo(c, P, gateX, tick.gate.strength);
    prints.forEach((f, j) => {
      const slot = (((N - 1 - j + tick.step) % N) + N) % N;
      const base = x0 + slot * p + Math.floor((p - PW) / 2) + shift;
      const visible = Math.min(5, N);
      for (const x of N > 1 ? [base, base - N * p] : [base]) {
        if (x + PW + 8 < x0 - 6 || x - 8 > x0 + visible * p + 6) continue;
        const wrapped = x < base;
        let look: Look;
        if (tick.shift === 0 && slot === g) look = tick.gate;
        else if (wrapped || slot < g) look = "negative";
        else look = "clear";
        drawFrame(c, P, f, x, look);
      }
    });
    c.unclip();
    gateBrackets(c, P, gateX);
    const capFrame = prints[(((N - 1 - g + tick.caption) % N) + N) % N];
    if (capFrame) caption(c, P, capFrame);
    frames.push({ pixels: c.px, delay: tick.delay });
  }
  return { frames: mergeStill(frames), palette: P };
}
