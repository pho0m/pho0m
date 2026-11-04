import { describe, expect, it } from "vitest";
import {
  atGate,
  crossedGate,
  damp,
  darkroomTimer,
  DEVELOP_MS,
  developLevel,
  dwell,
  edgePrint,
  frameLeft,
  frameOffset,
  frameVisible,
  frameWidthFor,
  initialStates,
  framesAround,
  isDry,
  keyTarget,
  positiveOpacity,
  posToScroll,
  scrollStep,
  scrollToPos,
  trackX,
  type ScrollMetrics,
} from "./math.ts";

const m: ScrollMetrics = { top: 1000, height: 11 * 650 + 1000, viewport: 1000, n: 11 };

describe("scroll → film position", () => {
  it("splits the scroll distance into n steps", () => {
    expect(scrollStep(m)).toBeCloseTo(650);
  });

  it("is 0 before the section and n-1 after it", () => {
    expect(scrollToPos(0, m)).toBe(0);
    expect(scrollToPos(m.top, m)).toBe(0);
    expect(scrollToPos(m.top + m.height, m)).toBe(10);
    expect(scrollToPos(1e9, m)).toBe(10);
  });

  it("puts frame i exactly in the gate at posToScroll(i)", () => {
    for (let i = 0; i < m.n; i++) expect(scrollToPos(posToScroll(i, m), m)).toBeCloseTo(i, 9);
  });

  it("dwells around each frame and is monotonic", () => {
    const at = posToScroll(4, m);
    expect(scrollToPos(at + 0.1 * scrollStep(m), m)).toBe(4);
    expect(scrollToPos(at - 0.1 * scrollStep(m), m)).toBe(4);
    let prev = -1;
    for (let y = 0; y < m.top + m.height; y += 7) {
      const p = scrollToPos(y, m);
      expect(p).toBeGreaterThanOrEqual(prev);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(m.n - 1);
      prev = p;
    }
  });

  it("dwell is continuous across integers", () => {
    expect(dwell(2.999)).toBeCloseTo(3, 6);
    expect(dwell(3.001)).toBeCloseTo(3, 6);
    expect(dwell(3.5)).toBeCloseTo(3.5, 6);
  });

  it("handles a single frame", () => {
    const one = { ...m, n: 1 };
    expect(scrollToPos(5000, one)).toBe(0);
    expect(posToScroll(0, one)).toBeGreaterThanOrEqual(one.top);
  });
});

describe("strip layout", () => {
  const n = 11;
  const fw = 300;

  it("places newer frames to the left", () => {
    expect(frameLeft(n - 1, n, fw)).toBe(0);
    expect(frameLeft(0, n, fw)).toBe((n - 1) * fw);
    expect(frameLeft(3, n, fw)).toBeGreaterThan(frameLeft(4, n, fw));
  });

  it("centres frame pos on the gate", () => {
    for (let i = 0; i < n; i++) expect(frameOffset(i, i, n, fw)).toBeCloseTo(0);
    expect(trackX(n - 1, n, fw)).toBe(-fw / 2);
  });

  it("moves the film to the right as pos grows", () => {
    expect(trackX(4, n, fw)).toBeGreaterThan(trackX(3, n, fw));
    expect(frameOffset(3, 4, n, fw)).toBe(fw); // exposed frame moves right
    expect(frameOffset(5, 4, n, fw)).toBe(-fw); // next frame waits on the left
  });

  it("crossfades off-gate prints to the negative", () => {
    expect(positiveOpacity(3, 3)).toBe(1);
    expect(positiveOpacity(3.5, 3)).toBeCloseTo(0.3);
    expect(positiveOpacity(5, 3)).toBe(0);
  });

  it("counts every frame the film passed through", () => {
    expect(crossedGate(0, 5, 3)).toBe(true);
    expect(crossedGate(5, 0, 3)).toBe(true);
    expect(crossedGate(0.1, 0.2, 1)).toBe(false);
    expect(crossedGate(0.75, 0.8, 1)).toBe(true);
    expect(crossedGate(2, 2, 2)).toBe(true);
    expect(crossedGate(0, 2.6, 3)).toBe(false);
  });

  it("knows the gate and the visible window", () => {
    expect(atGate(2.2, 2)).toBe(true);
    expect(atGate(2.31, 2)).toBe(false);
    expect(frameVisible(5, 5)).toBe(true);
    expect(frameVisible(0, 9)).toBe(false);
    expect(frameVisible(9, 0)).toBe(false);
  });

  it("sizes frames for phones and desktops", () => {
    expect(frameWidthFor(390, 844)).toBeLessThanOrEqual(270);
    expect(frameWidthFor(390, 844)).toBeGreaterThanOrEqual(160);
    const desk = frameWidthFor(1280, 900);
    expect(desk).toBeGreaterThan(frameWidthFor(390, 844));
    expect(desk).toBeLessThanOrEqual(360);
  });
});

describe("motion", () => {
  it("damps toward the target and snaps when close", () => {
    const p = damp(0, 1, 16);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1);
    expect(damp(0.999, 1, 16)).toBe(1);
    let x = 0;
    for (let k = 0; k < 200; k++) x = damp(x, 5, 16);
    expect(x).toBe(5);
  });

  it("develops a print from 0 to 1", () => {
    expect(developLevel(0)).toBe(0);
    expect(developLevel(350)).toBeGreaterThan(0.5);
    expect(developLevel(700)).toBe(1);
    expect(developLevel(5000)).toBe(1);
  });
});

describe("darkroom timer", () => {
  it("is idle for unexposed frames", () => {
    expect(darkroomTimer(null)).toEqual({ stage: -1, seconds: 0, clock: "00:00" });
  });

  it("walks DEV → STOP → FIX → DRY", () => {
    expect(darkroomTimer(0).stage).toBe(0);
    expect(darkroomTimer(0.3).stage).toBe(1);
    expect(darkroomTimer(0.5).stage).toBe(2);
    expect(darkroomTimer(1)).toEqual({ stage: 3, seconds: 240, clock: "04:00" });
    expect(darkroomTimer(0.25).clock).toBe("01:00");
  });

  it("is DRY (time for the clear print) exactly when the timer shows DRY", () => {
    expect(isDry(0)).toBe(false);
    expect(isDry(0.8)).toBe(false);
    expect(isDry(0.9)).toBe(true);
    expect(isDry(1)).toBe(true);
    for (let l = 0; l <= 1; l += 0.01) expect(isDry(l)).toBe(darkroomTimer(l).stage === 3);
    // the film crossfades well before the develop ends
    expect(isDry(developLevel(DEVELOP_MS * 0.7))).toBe(true);
  });
});

describe("helpers", () => {
  it("prints the film edge", () => {
    expect(edgePrint(2)).toBe("PHO0M 400  ▸3  3A");
  });

  it("starts with frame 0 developed", () => {
    expect(initialStates(4)).toEqual(["developed", "unexposed", "unexposed", "unexposed"]);
    expect(initialStates(4, 2.4)).toEqual(["developed", "developed", "developed", "unexposed"]);
    expect(initialStates(0)).toEqual([]);
  });
});

describe("keyTarget", () => {
  it("steps and jumps between frames", () => {
    expect(keyTarget("ArrowDown", 3, 10)).toBe(4);
    expect(keyTarget("PageDown", 3, 10)).toBe(4);
    expect(keyTarget("ArrowRight", 3, 10)).toBe(4);
    expect(keyTarget("ArrowUp", 3, 10)).toBe(2);
    expect(keyTarget("PageUp", 3, 10)).toBe(2);
    expect(keyTarget("ArrowLeft", 3, 10)).toBe(2);
    expect(keyTarget("Home", 3, 10)).toBe(0);
    expect(keyTarget("End", 3, 10)).toBe(9);
    expect(keyTarget("Enter", 3, 10)).toBeNull();
    expect(keyTarget("a", 3, 10)).toBeNull();
  });

  it("leaves the keys to the page at the ends of the roll", () => {
    for (const k of ["ArrowUp", "PageUp", "Home", "ArrowLeft"]) expect(keyTarget(k, 0, 10), k).toBeNull();
    for (const k of ["ArrowDown", "PageDown", "End", "ArrowRight"]) expect(keyTarget(k, 9, 10), k).toBeNull();
    expect(keyTarget("ArrowDown", 0, 10)).toBe(1);
    expect(keyTarget("ArrowUp", 9, 10)).toBe(8);
    // a single frame: every key goes to the page
    for (const k of ["ArrowDown", "ArrowUp", "Home", "End"]) expect(keyTarget(k, 0, 1), k).toBeNull();
  });
});

describe("framesAround", () => {
  it("covers what the strip can show, nearest the gate first", () => {
    expect(framesAround(0, 19)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(framesAround(10, 19)).toEqual([10, 9, 11, 8, 12, 7, 13, 6, 14, 15, 16, 17]);
    expect(framesAround(18, 19)).toEqual([18, 17, 16, 15, 14]);
    // everything the strip shows at a position is in the list
    for (let pos = 0; pos <= 18; pos += 0.5)
      for (let i = 0; i < 19; i++) if (frameVisible(pos, i)) expect(framesAround(pos, 19), `${pos}/${i}`).toContain(i);
    expect(framesAround(3, 0)).toEqual([]);
    expect(framesAround(-2, 3)).toEqual([0, 1, 2]);
  });
});
