import { FRAME_H, FRAME_W, PRINT_W } from "../lib/pixel.ts";

/**
 * Pure helpers for the admin's darkroom previews (no DOM). The pixels themselves
 * come from lib/print.ts — the same pipeline the site uses.
 */

export type PrintView = "clear" | "developing" | "negative";

export const PRINT_VIEWS: readonly { id: PrintView; th: string; en: string }[] = [
  { id: "clear", th: "ล้างเสร็จ (ชัด)", en: "Clear print" },
  { id: "developing", th: "กำลังล้าง", en: "Developing" },
  { id: "negative", th: "เนกาทีฟ", en: "Negative" },
];

/** Aspect ratio (w / h) of a film frame: 128×88 = 16:11. */
export const FRAME_ASPECT = FRAME_W / FRAME_H;

/** Size of the clear print for an aspect ratio: PRINT_W wide (512), height by ratio. */
export function printSize(aspect = FRAME_ASPECT): { w: number; h: number } {
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : FRAME_ASPECT;
  return { w: PRINT_W, h: Math.max(1, Math.round(PRINT_W / a)) };
}

/** Size of the coarse developing dither: FRAME_W wide (128), height by ratio (88 for a frame). */
export function developSize(aspect = FRAME_ASPECT): { w: number; h: number } {
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : FRAME_ASPECT;
  return { w: FRAME_W, h: Math.max(1, Math.round(FRAME_W / a)) };
}

/** How long the replay of "กำลังล้าง" takes. */
export const REPLAY_MS = 2200;

/** Development level for replay progress u (0..1): ease-out, shadows come up first. */
export function developEase(u: number): number {
  const c = Math.max(0, Math.min(1, u));
  return 1 - (1 - c) * (1 - c);
}

export const TIMER_STAGES = ["DEV", "STOP", "FIX", "DRY"] as const;
/** Darkroom seconds at which each bath starts; the whole run is 240 s. */
const STAGE_START = [0, 60, 90, 210] as const;
const TIMER_TOTAL = 240;

/** Progress (0..1) → the LED timer shown under the print: stage name and mm:ss. */
export function darkroomTimer(progress: number): { stage: (typeof TIMER_STAGES)[number]; clock: string } {
  const seconds = Math.round(Math.max(0, Math.min(1, progress)) * TIMER_TOTAL);
  let k = 0;
  for (let i = STAGE_START.length - 1; i >= 0; i--) {
    if (seconds >= STAGE_START[i]!) {
      k = i;
      break;
    }
  }
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return { stage: TIMER_STAGES[k]!, clock: `${mm}:${ss}` };
}
