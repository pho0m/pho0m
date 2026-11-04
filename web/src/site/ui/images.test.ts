import { describe, expect, it } from "vitest";
import { createImageData } from "../../lib/pixel.ts";
import { autoTone } from "./images.ts";

function grey(values: number[]): ImageData {
  const img = createImageData(values.length, 1);
  values.forEach((v, i) => {
    img.data.set([v, v, v, 255], i * 4);
  });
  return img;
}

describe("autoTone", () => {
  it("stretches a low-contrast photo to its own range", () => {
    const values = Array.from({ length: 100 }, (_, i) => 100 + i); // 100..199
    const { black, white } = autoTone(grey(values));
    expect(black).toBeGreaterThan(100 / 255);
    expect(white).toBeLessThan(199 / 255);
    expect(black).toBeLessThan(white);
  });

  it("keeps a minimum span for flat images", () => {
    const { black, white } = autoTone(grey(Array.from({ length: 50 }, () => 128)));
    expect(white - black).toBeCloseTo(0.35, 5);
    expect(black).toBeGreaterThanOrEqual(0);
    expect(white).toBeLessThanOrEqual(1);
  });
});
