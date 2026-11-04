import { describe, expect, it } from "vitest";
import { BAYER8, FRAME_H, FRAME_W, ditherPrint, iconScene, negativeOf, PAPER, INK } from "./pixel.ts";

describe("pixel engine", () => {
  it("bayer matrix is a permutation of 0..63", () => {
    expect([...BAYER8].sort((a, b) => a - b)).toEqual(Array.from({ length: 64 }, (_, i) => i));
  });
  it("icon scene has frame size and opaque pixels", () => {
    const s = iconScene("eye", 0.4, 3);
    expect(s.width).toBe(FRAME_W);
    expect(s.height).toBe(FRAME_H);
    for (let k = 3; k < s.data.length; k += 4) expect(s.data[k]).toBe(255);
  });
  it("dither only uses paper and ink; level 0 is blank paper", () => {
    const s = iconScene("rocket", 0.9, 1);
    const full = ditherPrint(s, { level: 1 });
    const blank = ditherPrint(s, { level: 0 });
    let inkCount = 0;
    for (let k = 0; k < full.data.length; k += 4) {
      const rgb = [full.data[k], full.data[k + 1], full.data[k + 2]];
      const isPaper = rgb.every((v, i) => v === PAPER[i]);
      const isInk = rgb.every((v, i) => v === INK[i]);
      expect(isPaper || isInk).toBe(true);
      if (isInk) inkCount++;
      expect([blank.data[k], blank.data[k + 1], blank.data[k + 2]]).toEqual([...PAPER]);
    }
    expect(inkCount).toBeGreaterThan(50);
    expect(negativeOf(full).width).toBe(FRAME_W);
  });
});
