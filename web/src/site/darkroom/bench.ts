/**
 * Darkroom bench for the Projects section (concept A): pure maths, no DOM.
 *
 * The visitor scrolls the project list; the card that crosses the "gate" line is the
 * print on the bench. Its progress through the card (0 → 1) walks it through the trays:
 *
 *   0.00–0.08  drops into DEV          0.36–0.44  moves to STOP     0.54–0.62  moves to FIX
 *   0.08–0.36  DEV: the dither comes up 0.44–0.54  STOP              0.62–0.74  FIX: dither → clear print
 *   0.74–1.00  lifted onto the drying line (newest peg on the left, like the film strip above)
 *
 * Finished prints hang on the line, newest first; the ones that no longer fit go on the
 * dried pile at the right end.
 */
import { clamp } from "../film/math.ts";

export const BENCH_STAGES = ["DEV", "STOP", "FIX", "DRY"] as const;
export type BenchStage = 0 | 1 | 2 | 3;

/** Where things sit on the low-res bench canvas (pixels). */
export type BenchLayout = {
  W: number;
  H: number;
  /** Print size on the bench. */
  pw: number;
  ph: number;
  /** Trays: left x, top y, width, height; prints rest at `printY` inside them. */
  trays: { x: number; y: number; w: number; h: number }[];
  printY: number;
  /** Drying line: y at the ends and how far it sags in the middle. */
  lineY: number;
  sag: number;
  /** First and last peg x (print left edge); `pegs` prints fit between them. */
  pegX0: number;
  pegX1: number;
  pegs: number;
  /** Dried pile (prints that no longer fit on the line). */
  pile: { x: number; y: number };
  /** Bench top (the counter the trays stand on). */
  benchY: number;
  /** Wall props on the wide bench: the darkroom timer and a shelf of chemistry (null on phones). */
  clock: { x: number; y: number; r: number } | null;
  shelf: { x0: number; x1: number; y: number } | null;
};

/** Wide bench beside the list (desktop) or a short strip above it (phones). */
export function benchLayout(compact: boolean): BenchLayout {
  const W = 320;
  const trays = (y: number, w: number, h: number) => {
    const gap = (W - 16 - 3 * w) / 2;
    return [0, 1, 2].map((k) => ({ x: 8 + k * (w + gap), y, w, h }));
  };
  if (compact) {
    return {
      W,
      H: 116,
      pw: 34,
      ph: 24,
      trays: trays(74, 92, 30),
      printY: 78,
      lineY: 24,
      sag: 5,
      pegX0: 10,
      pegX1: W - 10 - 34 - 40,
      pegs: 5,
      pile: { x: W - 44, y: 26 },
      benchY: 104,
      clock: null,
      shelf: null,
    };
  }
  return {
    W,
    H: 216,
    pw: 40,
    ph: 28,
    trays: trays(154, 94, 44),
    printY: 162,
    lineY: 26,
    sag: 8,
    pegX0: 10,
    pegX1: W - 10 - 40 - 44,
    pegs: 5,
    pile: { x: W - 48, y: 30 },
    benchY: 198,
    clock: { x: 44, y: 104, r: 15 },
    shelf: { x0: 196, x1: 306, y: 128 },
  };
}

/** y of the drying line at x. */
export function lineAt(l: BenchLayout, x: number): number {
  return Math.round(l.lineY + l.sag * Math.sin((Math.PI * clamp(x, 0, l.W)) / l.W));
}

/** Left edge of peg `slot` (0 = newest, at the left). Fractional slots slide between pegs. */
export function pegX(l: BenchLayout, slot: number): number {
  const step = l.pegs > 1 ? (l.pegX1 - l.pegX0) / (l.pegs - 1) : 0;
  return l.pegX0 + slot * step;
}

const ease = (u: number): number => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;

export type PrintPhase = {
  stage: BenchStage;
  /** Tray the print is in (0 DEV, 1 STOP, 2 FIX), -1 in the air. */
  tray: -1 | 0 | 1 | 2;
  /** Development of the dither, 0 → 1. */
  level: number;
  /** Crossfade from the dither to the clear print, 0 → 1. */
  clear: number;
  x: number;
  y: number;
};

export const STAGE_AT = { stop: 0.36, fix: 0.54, dry: 0.74 } as const;

export function stageAt(t: number): BenchStage {
  return t < STAGE_AT.stop ? 0 : t < STAGE_AT.fix ? 1 : t < STAGE_AT.dry ? 2 : 3;
}

/** Where the print on the bench is at progress `t` (0 → 1) through its card. */
export function printPhase(l: BenchLayout, t: number): PrintPhase {
  t = clamp(t, 0, 1);
  const at = (k: number) => ({
    x: l.trays[k]!.x + (l.trays[k]!.w - l.pw) / 2,
    y: l.printY,
  });
  const [d, s, f] = [at(0), at(1), at(2)];
  const peg = { x: pegX(l, 0), y: lineAt(l, pegX(l, 0) + l.pw / 2) + 4 };
  const hop = l.ph;
  let x: number;
  let y: number;
  let tray: PrintPhase["tray"] = -1;
  if (t < 0.08) {
    x = d.x;
    y = lerp(-l.ph - 4, d.y, ease(t / 0.08));
  } else if (t < STAGE_AT.stop) {
    x = d.x;
    y = d.y;
    tray = 0;
  } else if (t < 0.44) {
    const u = (t - STAGE_AT.stop) / 0.08;
    x = lerp(d.x, s.x, ease(u));
    y = d.y - Math.sin(Math.PI * u) * hop;
  } else if (t < STAGE_AT.fix) {
    x = s.x;
    y = s.y;
    tray = 1;
  } else if (t < 0.62) {
    const u = (t - STAGE_AT.fix) / 0.08;
    x = lerp(s.x, f.x, ease(u));
    y = s.y - Math.sin(Math.PI * u) * hop;
  } else if (t < STAGE_AT.dry) {
    x = f.x;
    y = f.y;
    tray = 2;
  } else {
    const u = ease((t - STAGE_AT.dry) / (1 - STAGE_AT.dry));
    x = lerp(f.x, peg.x, u);
    y = lerp(f.y, peg.y, u) - Math.sin(Math.PI * u) * hop;
  }
  return {
    stage: stageAt(t),
    tray,
    level: clamp((t - 0.08) / 0.26, 0, 1),
    clear: clamp((t - 0.62) / 0.12, 0, 1),
    x: Math.round(x),
    y: Math.round(y),
  };
}

/** The print on the bench for a list position: index and progress through its card. */
export function current(pos: number, n: number): { i: number; t: number } {
  if (n <= 0) return { i: -1, t: 0 };
  if (pos >= n) return { i: n - 1, t: 1 };
  const p = Math.max(0, pos);
  const i = Math.min(n - 1, Math.floor(p));
  return { i, t: p - i };
}

export type Hung = { index: number; slot: number };

/**
 * Finished prints on the line for a list position, newest first. While the current print
 * flies up (t past DRY) the others slide one peg right; those past the last peg are on
 * the pile (`piled`).
 */
export function hungPrints(pos: number, n: number, pegs: number): { hung: Hung[]; piled: number } {
  const { i, t } = current(pos, n);
  if (i < 0) return { hung: [], piled: 0 };
  const done = t >= 1 ? i + 1 : i;
  const shift = t >= STAGE_AT.dry && t < 1 ? ease((t - STAGE_AT.dry) / (1 - STAGE_AT.dry)) : 0;
  const hung: Hung[] = [];
  let piled = 0;
  for (let k = 0; k < done; k++) {
    const index = done - 1 - k;
    const slot = k + shift;
    // a print sliding off the last peg is drawn on its way to the pile until it gets there
    if (slot >= pegs) piled++;
    else hung.push({ index, slot });
  }
  return { hung, piled };
}

/**
 * List position for the gate line: `tops` are the document y of each card's top plus,
 * last, the bottom of the last card. Above the first card → 0; past the last → n.
 */
export function posFromTops(tops: readonly number[], gateY: number): number {
  const n = tops.length - 1;
  if (n <= 0) return 0;
  if (gateY <= tops[0]!) return 0;
  if (gateY >= tops[n]!) return n;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tops[mid]! <= gateY) lo = mid;
    else hi = mid - 1;
  }
  const span = tops[lo + 1]! - tops[lo]!;
  return lo + (span > 0 ? clamp((gateY - tops[lo]!) / span, 0, 1) : 1);
}

export type CardState = "ahead" | "active" | "dry";

/** How a card looks for a list position: developed, on the bench, or still in the box. */
export function cardState(j: number, pos: number, n: number): CardState {
  const { i, t } = current(pos, n);
  if (j < i || (j === i && t >= 1)) return "dry";
  if (j === i && pos > 0) return "active";
  return "ahead";
}

/** "DEV 00:41": the darkroom timer for a print's progress (seconds run 0 → 89 per card). */
export function timerText(t: number): string {
  const s = Math.min(89, Math.floor(clamp(t, 0, 1) * 90));
  return `${BENCH_STAGES[stageAt(t)]} 00:${String(s).padStart(2, "0")}`;
}
