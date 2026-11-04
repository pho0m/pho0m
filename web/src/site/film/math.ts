/**
 * Pure maths for the film timeline: page scroll → film position, strip layout,
 * frame visibility/opacity and the darkroom timer. No DOM access here so it can
 * be unit-tested.
 *
 * Coordinates: `pos` is a float in [0, n-1]; pos = i means frame i sits in the gate.
 * The film flows to the RIGHT as pos grows: frame i+1 sits to the LEFT of frame i.
 */

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export type ScrollMetrics = {
  /** Section top in document coordinates (px). */
  top: number;
  /** Section height (px). */
  height: number;
  /** Viewport height (px). */
  viewport: number;
  /** Number of frames. */
  n: number;
};

/** Height of the film section for n frames, as a CSS length (≈ n×65svh + 100svh). */
export function sectionHeightCss(n: number): string {
  return `calc(${Math.max(1, n)} * 65svh + 100svh)`;
}

/**
 * Scroll distance that advances the film by one frame. The sticky stage scrolls
 * (height − viewport) px in total; that is split into n equal steps, which leaves
 * half a step of dwell before the first frame and after the last one.
 */
export function scrollStep(m: ScrollMetrics): number {
  return Math.max(1, m.height - m.viewport) / Math.max(1, m.n);
}

/** Fraction of each step during which the frame rests in the gate. */
export const DWELL = 0.3;

/**
 * Ease within each unit so every frame rests in the gate for a moment:
 * values within ±hold/2 of an integer map exactly to that integer, with a
 * smoothstep in between. Monotonic and continuous.
 */
export function dwell(raw: number, hold = DWELL): number {
  const base = Math.floor(raw);
  const f = raw - base;
  const u = clamp((f - hold / 2) / (1 - hold), 0, 1);
  return base + u * u * (3 - 2 * u);
}

/** Page scroll (window.scrollY) → film position in [0, n-1]. */
export function scrollToPos(scrollY: number, m: ScrollMetrics): number {
  if (m.n <= 1) return 0;
  const step = scrollStep(m);
  const raw = (scrollY - m.top - step / 2) / step;
  return dwell(clamp(raw, 0, m.n - 1));
}

/** Inverse of scrollToPos for an integer frame: the scroll position that puts frame `i` in the gate. */
export function posToScroll(i: number, m: ScrollMetrics): number {
  const step = scrollStep(m);
  return m.top + step / 2 + clamp(i, 0, Math.max(0, m.n - 1)) * step;
}

/** Left edge of frame i inside the track (px): newer frames further left. */
export function frameLeft(i: number, n: number, fw: number): number {
  return (n - 1 - i) * fw;
}

/** translateX of the track so that position `pos` is centred on the gate. */
export function trackX(pos: number, n: number, fw: number): number {
  return -((n - 1 - pos) * fw + fw / 2);
}

/** Horizontal offset of frame i's centre from the gate (px). Positive = right, toward the viewer. */
export function frameOffset(i: number, pos: number, n: number, fw: number): number {
  return frameLeft(i, n, fw) + fw / 2 + trackX(pos, n, fw);
}

/** Opacity of the developed print; off-gate frames crossfade to the negative. */
export function positiveOpacity(pos: number, i: number): number {
  return 1 - Math.min(1, Math.abs(pos - i) * 1.4);
}

/** A frame is "in the gate" (gets exposed) when it is this close to the centre. */
export const GATE = 0.3;
export const atGate = (pos: number, i: number): boolean => Math.abs(pos - i) < GATE;

/**
 * True when frame i passed through the gate while the film moved from `prev` to
 * `pos` (so a fast scroll or an instant jump cannot skip an exposure).
 */
export function crossedGate(prev: number, pos: number, i: number): boolean {
  const lo = Math.min(prev, pos);
  const hi = Math.max(prev, pos);
  return lo < i + GATE && hi > i - GATE;
}

/** Frames far from the gate are hidden (off-screen, or so close to the camera they would clip). */
export function frameVisible(pos: number, i: number, left = 6, right = 3): boolean {
  const d = pos - i;
  return d > -left && d < right;
}

/**
 * Frames whose pictures should be loaded with the film at `pos`: the ones the strip
 * can show (frameVisible: up to 5 ahead, 2 behind) plus a little margin, nearest the
 * gate first, so a deep link far down the roll does not fetch every photo.
 */
export function framesAround(pos: number, n: number, ahead = 7, behind = 4): number[] {
  if (n <= 0) return [];
  const at = Math.round(clamp(pos, 0, n - 1));
  const out: number[] = [];
  for (let i = Math.max(0, at - behind); i <= Math.min(n - 1, at + ahead); i++) out.push(i);
  return out.sort((a, b) => Math.abs(a - at) - Math.abs(b - at) || a - b);
}

/**
 * Damped lerp toward `target` (frame-rate independent). Snaps when close so the
 * animation loop can stop.
 */
export function damp(pos: number, target: number, dtMs: number, tauMs = 110): number {
  const d = target - pos;
  if (Math.abs(d) < 0.002) return target;
  const dt = clamp(dtMs, 0, 64);
  return pos + d * (1 - Math.exp(-dt / tauMs));
}

/** Frame width (px) for a stage size. Smaller on phones; bounded by height so the strip fits. */
export function frameWidthFor(stageW: number, stageH: number): number {
  if (stageW < 640) return Math.round(clamp(stageW * 0.58, 160, 270));
  const byW = stageW * 0.26;
  const byH = stageH * 0.42;
  return Math.round(clamp(Math.min(byW, byH), 210, 360));
}

/** Print development over time: 0 → 1 with an ease-out (shadows show up first in the developing dither). */
export const DEVELOP_MS = 700;
export function developLevel(elapsedMs: number, durationMs = DEVELOP_MS): number {
  const u = clamp(elapsedMs / durationMs, 0, 1);
  return 1 - (1 - u) * (1 - u);
}

export const TIMER_STAGES = ["DEV", "STOP", "FIX", "DRY"] as const;
/** Darkroom seconds at which each stage starts; the bath ends at 240 s. */
const STAGE_START = [0, 60, 90, 210];
const TIMER_TOTAL = 240;

export type TimerReading = {
  /** -1 = idle (unexposed), else index into TIMER_STAGES. */
  stage: number;
  seconds: number;
  clock: string;
};

/** Map development progress (null = unexposed) to the DEV → STOP → FIX → DRY timer. */
export function darkroomTimer(progress: number | null): TimerReading {
  if (progress === null || progress < 0) return { stage: -1, seconds: 0, clock: "00:00" };
  const seconds = Math.round(clamp(progress, 0, 1) * TIMER_TOTAL);
  let stage = 0;
  for (let k = STAGE_START.length - 1; k >= 0; k--) {
    if (seconds >= STAGE_START[k]!) {
      stage = k;
      break;
    }
  }
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return { stage, seconds, clock: `${mm}:${ss}` };
}

/**
 * True once the print reaches the DRY stage of the timer: the developing dither is
 * done and the frame crossfades to the clear print.
 */
export function isDry(level: number): boolean {
  return darkroomTimer(level).stage === TIMER_STAGES.length - 1;
}

export const pad2 = (v: number): string => String(v).padStart(2, "0");

/** Kodak-style edge print for frame i. */
export function edgePrint(i: number): string {
  return `PHO0M 400  ▸${i + 1}  ${i + 1}A`;
}

/** Spool rotation (deg) for the film position. */
export function reelAngle(pos: number): number {
  return pos * 137;
}

export type FrameState = "unexposed" | "developing" | "developed";

/** Frames up to `pos` (rounded) start developed; frame 0 is always developed so the page is complete at rest. */
export function initialStates(n: number, pos = 0): FrameState[] {
  const upTo = Math.round(clamp(pos, 0, Math.max(0, n - 1)));
  return Array.from({ length: n }, (_, i) => (i === 0 || i <= upTo ? "developed" : "unexposed"));
}

/**
 * Frame a key press on the film moves to, or null when the key is left to the page.
 * Right/Down/PageDown step forward, Left/Up/PageUp back, Home/End jump to the ends.
 * At the first frame Up/PageUp/Home (and at the last Down/PageDown/End) have nowhere
 * to go on the film, so they return null and the page scrolls on past it.
 */
export function keyTarget(key: string, current: number, n: number): number | null {
  const last = Math.max(0, n - 1);
  let next: number;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
    case "PageDown":
      next = current + 1;
      break;
    case "ArrowLeft":
    case "ArrowUp":
    case "PageUp":
      next = current - 1;
      break;
    case "Home":
      next = 0;
      break;
    case "End":
      next = last;
      break;
    default:
      return null;
  }
  const k = clamp(Math.round(next), 0, last);
  return k === current ? null : k;
}
