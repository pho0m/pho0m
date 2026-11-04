import { describe, expect, it } from "vitest";
import { FRAME_H, FRAME_W, PRINT_H, PRINT_W } from "../lib/pixel.ts";
import { FRAME_ASPECT, PRINT_VIEWS, darkroomTimer, developEase, developSize, printSize } from "./darkroom.ts";

describe("darkroom preview helpers", () => {
  it("offers the clear print first, then developing and negative", () => {
    expect(PRINT_VIEWS.map((v) => v.id)).toEqual(["clear", "developing", "negative"]);
    expect(PRINT_VIEWS[0]!.th).toBe("ล้างเสร็จ (ชัด)");
  });

  it("sizes a frame print like the site (512×352 clear, 128×88 dither)", () => {
    expect(printSize(FRAME_ASPECT)).toEqual({ w: PRINT_W, h: PRINT_H });
    expect(developSize(FRAME_ASPECT)).toEqual({ w: FRAME_W, h: FRAME_H });
    expect(printSize()).toEqual({ w: PRINT_W, h: PRINT_H });
  });

  it("keeps other aspect ratios and guards bad input", () => {
    expect(printSize(4 / 5)).toEqual({ w: 512, h: 640 });
    expect(developSize(16 / 9)).toEqual({ w: 128, h: 72 });
    expect(printSize(0)).toEqual({ w: PRINT_W, h: PRINT_H });
    expect(developSize(Number.NaN)).toEqual({ w: FRAME_W, h: FRAME_H });
  });

  it("develops with an ease-out from 0 to 1", () => {
    expect(developEase(0)).toBe(0);
    expect(developEase(1)).toBe(1);
    expect(developEase(0.5)).toBeGreaterThan(0.5);
    expect(developEase(-1)).toBe(0);
    expect(developEase(2)).toBe(1);
  });

  it("runs the LED timer DEV → STOP → FIX → DRY", () => {
    expect(darkroomTimer(0)).toEqual({ stage: "DEV", clock: "00:00" });
    expect(darkroomTimer(0.25).stage).toBe("STOP");
    expect(darkroomTimer(0.5).stage).toBe("FIX");
    expect(darkroomTimer(1)).toEqual({ stage: "DRY", clock: "04:00" });
  });
});
