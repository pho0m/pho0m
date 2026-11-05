import { describe, expect, it } from "vitest";
import { BAYER8, FRAME_H, FRAME_W, ditherPrint, iconScene, negativeOf, PAPER, INK, tonePrint, upscaleNearest, createImageData } from "./pixel.ts";

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

  it("tonePrint is continuous-tone between ink and paper; level 0 is blank, darks develop first", () => {
    const g = createImageData(3, 1);
    [20, 128, 235].forEach((v, i) => { g.data.set([v, v, v, 255], i * 4); });
    const full = tonePrint(g, { grain: 0, contrast: 0 });
    const half = tonePrint(g, { grain: 0, contrast: 0, level: 0.5 });
    const blank = tonePrint(g, { grain: 0, level: 0 });
    const r = (im: ImageData, i: number) => im.data[i * 4]!;
    expect(r(full, 0)).toBeLessThan(r(full, 1));
    expect(r(full, 1)).toBeLessThan(r(full, 2));
    for (let i = 0; i < 3; i++) expect(r(blank, i)).toBe(PAPER[0]);
    // the dark pixel is closer to its final density at half development than the mid-grey one
    const prog = (i: number) => (PAPER[0] - r(half, i)) / Math.max(1, PAPER[0] - r(full, i));
    expect(prog(0)).toBeGreaterThan(prog(1));
    const values = new Set(Array.from(tonePrint(iconScene("eye", 0.4), { grain: 0 }).data.filter((_, k) => k % 4 === 0)));
    expect(values.size).toBeGreaterThan(4); // not two-tone
  });
  it("upscaleNearest keeps hard pixel edges", () => {
    const s = iconScene("rocket", 0.2);
    const big = upscaleNearest(s, FRAME_W * 4, FRAME_H * 4);
    expect(big.width).toBe(FRAME_W * 4);
    expect(Array.from(big.data.slice(0, 4))).toEqual(Array.from(s.data.slice(0, 4)));
  });
});
