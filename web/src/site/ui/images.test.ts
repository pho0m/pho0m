import { describe, expect, it } from "vitest";
import { FRAME_H, FRAME_W, createImageData } from "../../lib/pixel.ts";
import { iconSource } from "../../lib/print.ts";
import { clearOf, clearSize, developingAt, naturalHeight, negativeFor } from "./images.ts";

const img = (w: number, h: number) => ({ naturalWidth: w, naturalHeight: h, width: w, height: h }) as HTMLImageElement;

describe("clearSize", () => {
  it("is about 3× the dither width, capped", () => {
    expect(clearSize(img(1600, 1200), 160, 4 / 3)).toEqual({ w: 512, h: 384 });
    expect(clearSize(img(4000, 3000), 400, 4 / 3).w).toBe(640);
  });
  it("never upscales past the part of the photo a cover-fit uses", () => {
    // 724×724 cropped to 4:5 uses 579 px of width
    expect(clearSize(img(724, 724), 150, 4 / 5)).toEqual({ w: 480, h: 600 });
    expect(clearSize(img(300, 300), 150, 4 / 5).w).toBe(240);
    expect(clearSize(img(100, 100), 150, 1).w).toBe(150);
  });
});

describe("naturalHeight", () => {
  it("keeps the photo's aspect within bounds", () => {
    expect(naturalHeight(img(1600, 1200), 160)).toBe(120);
    expect(naturalHeight(img(100, 1000), 100)).toBe(200);
  });
});

describe("print caches", () => {
  it("computes the clear print and negative once per source", () => {
    const src = iconSource("eye", 0.5, 1);
    expect(clearOf(src)).toBe(clearOf(src));
    expect(negativeFor(src)).toBe(negativeFor(src));
    expect([clearOf(src).width, clearOf(src).height]).toEqual([src.data.width, src.data.height]);
  });
  it("develops at frame size by default and at any other size on request", () => {
    const big = createImageData(400, 500);
    big.data.fill(90);
    const src = { data: big, photo: true };
    expect([developingAt(src, 1).width, developingAt(src, 1).height]).toEqual([FRAME_W, FRAME_H]);
    const out = createImageData(80, 100);
    expect(developingAt(src, 0.5, out, 80, 100)).toBe(out);
  });
});
