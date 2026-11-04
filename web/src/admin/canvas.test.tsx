import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PrintCanvas, PrintControls, useDarkroomPrint } from "./fields/canvas.tsx";

// jsdom has no 2D canvas: record what gets painted instead.
const painted: { w: number; h: number }[] = [];
beforeAll(() => {
  const ctx = {
    putImageData: (d: ImageData) => painted.push({ w: d.width, h: d.height }),
    clearRect() {},
  };
  HTMLCanvasElement.prototype.getContext = (() => ctx) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});
afterEach(() => {
  cleanup();
  painted.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Frame() {
  const p = useDarkroomPrint({ icon: "star", t: 0.4, seed: 1 });
  return (
    <>
      <PrintCanvas p={p} icon label="เฟรม" />
      <PrintControls p={p} slider />
    </>
  );
}

const pressed = (name: string) => screen.getByRole("button", { name }).getAttribute("aria-pressed");

describe("darkroom preview (frame without a photo)", () => {
  it("shows the clear print by default and switches to developing and negative", () => {
    const { container } = render(<Frame />);
    const canvas = container.querySelector("canvas")!;
    expect(pressed("ล้างเสร็จ (ชัด)")).toBe("true");
    expect(canvas.getAttribute("aria-label")).toBe("เฟรม · ล้างเสร็จ (ชัด)");
    // pixel-art scene → drawn pixelated even when clear
    expect(canvas.style.imageRendering).toBe("pixelated");
    expect(painted.at(-1)).toEqual({ w: 128, h: 88 });

    fireEvent.click(screen.getByRole("button", { name: "กำลังล้าง" }));
    expect(pressed("กำลังล้าง")).toBe("true");
    expect(screen.getByText(/^DRY 04:00$/)).toBeTruthy();
    expect(screen.getByLabelText("ระดับการล้าง")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "เนกาทีฟ" }));
    expect(pressed("เนกาทีฟ")).toBe("true");
    expect(container.querySelector(".darkroom")!.getAttribute("data-view")).toBe("negative");
    expect(screen.queryByText(/^DRY/)).toBeNull();
  });

  it("replays development from DEV 00:00 to DRY with a flash", () => {
    let now = 0;
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    const { container } = render(<Frame />);
    fireEvent.click(screen.getByRole("button", { name: "กำลังล้าง" }));
    fireEvent.click(screen.getByRole("button", { name: /ล้างใหม่/ }));
    expect(container.querySelector(".darkroom-flash")).not.toBeNull();
    expect(screen.getByText(/^DEV 00:00$/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "กำลังล้าง…" })).toBeTruthy();
    const run = (t: number) =>
      act(() => {
        now = t;
        frames.shift()?.(t);
      });
    run(600);
    expect(screen.getByText(/^(DEV|STOP|FIX) /)).toBeTruthy();
    run(5000);
    expect(screen.getByText(/^DRY 04:00$/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /ล้างใหม่/ })).toBeTruthy();
  });
});
