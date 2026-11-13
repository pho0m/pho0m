import { describe, expect, it } from "vitest";
import {
  benchLayout,
  cardState,
  current,
  hungPrints,
  lineAt,
  pegX,
  posFromTops,
  printPhase,
  stageAt,
  STAGE_AT,
  timerText,
} from "./bench.ts";

const layouts = [benchLayout(false), benchLayout(true)];

describe("bench layout", () => {
  it.each(layouts.map((l) => [l.H, l] as const))("everything fits on the %i px tall bench", (_h, l) => {
    for (const tr of l.trays) {
      expect(tr.x).toBeGreaterThanOrEqual(0);
      expect(tr.x + tr.w).toBeLessThanOrEqual(l.W);
      // a print resting in a tray sits inside it
      expect(l.printY).toBeGreaterThanOrEqual(tr.y);
      expect(l.printY + l.ph).toBeLessThanOrEqual(tr.y + tr.h);
      expect(tr.w).toBeGreaterThan(l.pw);
    }
    // trays do not overlap
    for (let k = 1; k < l.trays.length; k++) expect(l.trays[k]!.x).toBeGreaterThanOrEqual(l.trays[k - 1]!.x + l.trays[k - 1]!.w);
    // pegs and pile stay on the canvas, the line is above the trays
    expect(pegX(l, 0)).toBeGreaterThanOrEqual(0);
    expect(pegX(l, l.pegs - 1) + l.pw).toBeLessThanOrEqual(l.W);
    expect(l.pile.x + l.pw).toBeLessThanOrEqual(l.W);
    for (let x = 0; x <= l.W; x += 8) {
      expect(lineAt(l, x)).toBeGreaterThan(0);
      expect(lineAt(l, x) + 4 + l.ph).toBeLessThan(l.trays[0]!.y);
    }
    // hung prints do not overlap each other
    expect(pegX(l, 1) - pegX(l, 0)).toBeGreaterThanOrEqual(l.pw);
    expect(l.benchY).toBeLessThan(l.H);
  });
});

describe("print phase", () => {
  const l = benchLayout(false);
  it("walks DEV → STOP → FIX → DRY and ends on the newest peg", () => {
    expect([0, 0.2, 0.4, 0.5, 0.6, 0.7, 0.8, 1].map(stageAt)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    expect(printPhase(l, 0.2).tray).toBe(0);
    expect(printPhase(l, 0.5).tray).toBe(1);
    expect(printPhase(l, 0.7).tray).toBe(2);
    for (const t of [0.04, 0.4, 0.58, 0.9]) expect(printPhase(l, t).tray, String(t)).toBe(-1);
    const end = printPhase(l, 1);
    expect(end.x).toBe(Math.round(pegX(l, 0)));
    expect(end.y).toBe(lineAt(l, pegX(l, 0) + l.pw / 2) + 4);
    expect(end.clear).toBe(1);
  });
  it("starts above the bench as blank paper, develops in DEV and clears in FIX", () => {
    const start = printPhase(l, 0);
    expect(start.y + l.ph).toBeLessThanOrEqual(0);
    expect(start.level).toBe(0);
    expect(printPhase(l, 0.2).level).toBeGreaterThan(0);
    expect(printPhase(l, STAGE_AT.stop).level).toBe(1);
    expect(printPhase(l, STAGE_AT.fix).clear).toBe(0);
    expect(printPhase(l, STAGE_AT.dry).clear).toBe(1);
  });
  it("is continuous: no jumps bigger than a hop between nearby progress values", () => {
    let prev = printPhase(l, 0);
    for (let k = 1; k <= 400; k++) {
      const cur = printPhase(l, k / 400);
      expect(Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y), String(k)).toBeLessThan(l.ph);
      prev = cur;
    }
  });
});

describe("list position", () => {
  const tops = [100, 300, 450, 700];
  it("maps the gate line onto cards", () => {
    expect(posFromTops(tops, 0)).toBe(0);
    expect(posFromTops(tops, 100)).toBe(0);
    expect(posFromTops(tops, 200)).toBeCloseTo(0.5);
    expect(posFromTops(tops, 300)).toBe(1);
    expect(posFromTops(tops, 575)).toBeCloseTo(2.5);
    expect(posFromTops(tops, 700)).toBe(3);
    expect(posFromTops(tops, 9999)).toBe(3);
    expect(posFromTops([], 50)).toBe(0);
    expect(posFromTops([10], 50)).toBe(0);
  });
  it("is monotonic", () => {
    let prev = -1;
    for (let y = 0; y < 800; y += 7) {
      const p = posFromTops(tops, y);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });
  it("splits a position into the card on the bench and its progress", () => {
    expect(current(0, 0)).toEqual({ i: -1, t: 0 });
    expect(current(-2, 4)).toEqual({ i: 0, t: 0 });
    expect(current(2.25, 4)).toEqual({ i: 2, t: 0.25 });
    expect(current(4, 4)).toEqual({ i: 3, t: 1 });
    expect(current(7, 4)).toEqual({ i: 3, t: 1 });
  });
});

describe("drying line", () => {
  it("hangs finished prints newest first and piles the rest", () => {
    expect(hungPrints(0, 6, 5)).toEqual({ hung: [], piled: 0 });
    expect(hungPrints(2.2, 6, 5).hung).toEqual([
      { index: 1, slot: 0 },
      { index: 0, slot: 1 },
    ]);
    const all = hungPrints(6, 6, 5);
    expect(all.hung.map((h) => h.index)).toEqual([5, 4, 3, 2, 1]);
    expect(all.piled).toBe(1);
    expect(hungPrints(3, 0, 5)).toEqual({ hung: [], piled: 0 });
  });
  it("slides the line one peg right while the next print flies up", () => {
    const mid = hungPrints(2 + (STAGE_AT.dry + 1) / 2, 6, 5).hung;
    expect(mid[0]!.index).toBe(1);
    expect(mid[0]!.slot).toBeGreaterThan(0);
    expect(mid[0]!.slot).toBeLessThan(1);
    // after it lands the slots are whole again
    expect(hungPrints(3, 6, 5).hung.map((h) => h.slot)).toEqual([0, 1, 2]);
  });
  it("never shows more prints than pegs, and counts every print once", () => {
    for (let pos = 0; pos <= 12; pos += 0.13) {
      const { hung, piled } = hungPrints(pos, 12, 5);
      expect(hung.length).toBeLessThanOrEqual(5);
      const { i, t } = current(pos, 12);
      expect(hung.length + piled).toBe(t >= 1 ? i + 1 : i);
    }
  });
});

describe("cards", () => {
  it("are ahead, on the bench, or dry", () => {
    expect(cardState(0, 0, 3)).toBe("ahead");
    expect(cardState(0, 0.4, 3)).toBe("active");
    expect(cardState(1, 0.4, 3)).toBe("ahead");
    expect(cardState(0, 1.2, 3)).toBe("dry");
    expect(cardState(2, 3, 3)).toBe("dry");
  });
  it("timer reads the stage and the seconds", () => {
    expect(timerText(0)).toBe("DEV 00:00");
    expect(timerText(0.5)).toBe("STOP 00:45");
    expect(timerText(0.71)).toBe("FIX 00:63");
    expect(timerText(1)).toBe("DRY 00:89");
  });
});
