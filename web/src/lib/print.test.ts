import { describe, expect, it } from "vitest";
import { FRAME_H, FRAME_W, INK, PAPER, BAYER8, createImageData } from "./pixel.ts";
import { autoTone, clearPrint, developingPrint, downsample, iconSource, negativePrint } from "./print.ts";

describe("print pipeline", () => {
  it("uses the standard dispersed Bayer matrix", () => {
    expect(BAYER8.slice(0, 8)).toEqual([0, 32, 8, 40, 2, 34, 10, 42]);
    expect([...BAYER8].sort((a, b) => a - b)).toEqual(Array.from({ length: 64 }, (_, i) => i));
  });
  it("developing print is two-tone at frame size; clear print is continuous", () => {
    const src = iconSource("eye", 0.4, 2);
    const dev = developingPrint(src, 1);
    expect([dev.width, dev.height]).toEqual([FRAME_W, FRAME_H]);
    const devTones = new Set<string>();
    for (let k = 0; k < dev.data.length; k += 4) devTones.add(`${dev.data[k]},${dev.data[k + 1]},${dev.data[k + 2]}`);
    expect(devTones).toEqual(new Set([PAPER.join(","), INK.join(",")]));
    const clear = clearPrint(src);
    const tones = new Set<number>();
    for (let k = 0; k < clear.data.length; k += 4) tones.add(clear.data[k]!);
    expect(tones.size).toBeGreaterThan(4);
    expect(negativePrint(src).width).toBe(src.data.width);
  });
  it("developingPrint downsamples big photos to frame size", () => {
    const big = createImageData(FRAME_W * 4, FRAME_H * 4);
    big.data.fill(128);
    const dev = developingPrint({ data: big, photo: true }, 1);
    expect([dev.width, dev.height]).toEqual([FRAME_W, FRAME_H]);
    expect(downsample(big, FRAME_W, FRAME_H).data[0]).toBe(128);
  });
  it("autoTone stretches a low-contrast image", () => {
    const im = createImageData(10, 1);
    for (let i = 0; i < 10; i++) im.data.set([100 + i * 5, 100 + i * 5, 100 + i * 5, 255], i * 4);
    const t = autoTone(im, 0.1, 0.05);
    expect(t.black).toBeGreaterThan(0.35);
    expect(t.white).toBeLessThan(0.6);
  });
});
