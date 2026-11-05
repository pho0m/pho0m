import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DARKROOM } from "@pho0m/content";
import { FRAME_H, FRAME_W, createImageData, iconScene, negativeOf } from "../../lib/pixel.ts";
import { clearPrint, downsample, iconSource, printFinals, type PrintSource } from "../../lib/print.ts";
import type { PrintRequest, PrintResponse } from "../../lib/print.worker.ts";

/* The print pipeline that moved off the main thread: the worker protocol, the page-side
   client (with and without a worker), and the idle queue that is left on the page. */

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const same = (a: ImageData, b: ImageData) => a.width === b.width && a.height === b.height && a.data.every((v, k) => v === b.data[k]);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("pixel maths used by the worker", () => {
  it("negativeOf gives exactly the old per-pixel mix() result", () => {
    const src = iconScene("rocket", 0.3, 2);
    const hi = hex(DARKROOM.led);
    const base = hex(DARKROOM.filmBase);
    const neg = negativeOf(src);
    for (let k = 0; k < src.data.length; k += 4) {
      const lum = (src.data[k]! + src.data[k + 1]! + src.data[k + 2]!) / 765;
      for (let c = 0; c < 3; c++) expect(neg.data[k + c]).toBe(Math.round(hi[c]! + (base[c]! - hi[c]!) * lum));
      expect(neg.data[k + 3]).toBe(255);
    }
  });

  it("printFinals computes the clear print, the negative and the dither input in one go", () => {
    const big = createImageData(256, 176);
    for (let k = 0; k < big.data.length; k++) big.data[k] = (k * 37) % 256;
    const src: PrintSource = { data: big, photo: true, clearTone: { black: 0.1, white: 0.9 } };
    const f = printFinals(src, { negative: true, dev: { w: FRAME_W, h: FRAME_H } });
    expect(same(f.clear, clearPrint(src))).toBe(true);
    expect(same(f.negative!, negativeOf(f.clear))).toBe(true);
    expect(same(f.small!, downsample(big, FRAME_W, FRAME_H))).toBe(true);
    expect(printFinals(src)).toEqual({ clear: f.clear });
  });
});

/** Send the worker one request (its handler, without a thread). */
async function callWorker(req: PrintRequest): Promise<PrintResponse> {
  const { handlePrintRequest } = await import("../../lib/print.worker.ts");
  const { msg, transfer } = await handlePrintRequest(req);
  // every buffer in the answer is transferred, none twice
  expect(new Set(transfer).size).toBe(transfer.length);
  return msg;
}

describe("print worker", () => {
  it("finishes a source sent by the page", async () => {
    const src = iconSource("eye", 0.4, 1);
    const buf = src.data.data.slice().buffer;
    const r = await callWorker({ id: 7, op: "finish", data: { w: FRAME_W, h: FRAME_H, buf }, photo: false, negative: true, dev: { w: FRAME_W, h: FRAME_H } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.id).toBe(7);
    const clear = clearPrint(src);
    expect([...new Uint8ClampedArray(r.clear.buf)]).toEqual([...clear.data]);
    expect([...new Uint8ClampedArray(r.negative!.buf)]).toEqual([...negativeOf(clear).data]);
    // the source already has the dither size: no second copy is sent
    expect(r.smallIsData).toBe(true);
    expect(r.small).toBeUndefined();
  });

  it("says when it cannot decode photos itself (no OffscreenCanvas), so the page does it", async () => {
    const r = await callWorker({ id: 1, op: "photo", url: "https://example.test/a.jpg", w: 64, h: 44, negative: false });
    expect(r).toMatchObject({ id: 1, ok: false, unsupported: true });
  });
});

/** A Worker stand-in that runs the real worker handler in-process. */
function installFakeWorker() {
  const sent: PrintRequest[] = [];
  class FakeWorker {
    onmessage: ((ev: { data: PrintResponse }) => void) | null = null;
    onerror: ((ev: Event) => void) | null = null;
    postMessage(req: PrintRequest) {
      sent.push(req);
      void import("../../lib/print.worker.ts")
        .then(({ handlePrintRequest }) => handlePrintRequest(req))
        .then(({ msg }) => this.onmessage?.({ data: msg }));
    }
    terminate() {}
  }
  vi.stubGlobal("Worker", FakeWorker);
  return sent;
}

describe("page side (images.ts)", () => {
  it("has the worker compute the finals; painting then only reads caches", async () => {
    const sent = installFakeWorker();
    const images = await import("./images.ts");
    const src = iconSource("rocket", 0.6, 3);
    await images.ensureFinals(src, { negative: true, dev: { w: 64, h: 44 } });
    expect(sent.map((r) => r.op)).toEqual(["finish"]);
    // served from the caches the worker filled (same objects every time, nothing recomputed)
    expect(images.clearOf(src)).toBe(images.clearOf(src));
    expect(same(images.clearOf(src), clearPrint(src))).toBe(true);
    expect(same(images.negativeFor(src), negativeOf(clearPrint(src)))).toBe(true);
    const out = createImageData(64, 44);
    expect(images.developingAt(src, 1, out, 64, 44)).toBe(out);
    // asking again sends nothing
    await images.ensureFinals(src, { negative: true });
    expect(sent).toHaveLength(1);
  });

  it("without workers computes the same thing on the page, in idle slots", async () => {
    vi.stubGlobal("Worker", undefined);
    const images = await import("./images.ts");
    const src = iconSource("eye", 0.2, 5);
    await images.ensureFinals(src, { negative: true, dev: { w: 32, h: 22 } });
    expect(same(images.clearOf(src), clearPrint(src))).toBe(true);
    expect(same(images.negativeFor(src), negativeOf(clearPrint(src)))).toBe(true);
  });

  it("falls back to reading the photo on the page when the worker cannot decode", async () => {
    const sent = installFakeWorker();
    const images = await import("./images.ts");
    // jsdom never loads images: the fallback path waits on the <img> (no OffscreenCanvas in the fake worker either)
    void images.photoPrintSource("/img/x.jpg", 64, 44).catch(() => {});
    await vi.waitFor(() => expect(sent.map((r) => r.op)).toEqual(["photo"]));
    expect(sent[0]).toMatchObject({ url: `${location.origin}/img/x.jpg`, w: 64, h: 44 });
  });
});

describe("whenIdle", () => {
  let idle: ((d: { timeRemaining: () => number; didTimeout: boolean }) => void)[];
  beforeEach(() => {
    idle = [];
    vi.stubGlobal("requestIdleCallback", (cb: (typeof idle)[number]) => idle.push(cb));
  });

  it("runs as many jobs per idle slot as the deadline allows, at least one", async () => {
    const { whenIdle } = await import("./images.ts");
    const ran: number[] = [];
    for (let i = 0; i < 5; i++) whenIdle(() => ran.push(i));
    expect(idle).toHaveLength(1);
    // a slot with 10 ms left, then 1 ms: two jobs fit in the first, then one per slot
    let left = 10;
    idle.shift()!({ timeRemaining: () => (left -= 4), didTimeout: false });
    expect(ran).toEqual([0, 1]);
    idle.shift()!({ timeRemaining: () => 0, didTimeout: false });
    expect(ran).toEqual([0, 1, 2]);
    // forced by the timeout: one job only
    idle.shift()!({ timeRemaining: () => 50, didTimeout: true });
    expect(ran).toEqual([0, 1, 2, 3]);
    idle.shift()!({ timeRemaining: () => 50, didTimeout: false });
    expect(ran).toEqual([0, 1, 2, 3, 4]);
    expect(idle).toHaveLength(0);
  });

  it("keeps going after a job throws", async () => {
    const { whenIdle } = await import("./images.ts");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const ran: string[] = [];
    whenIdle(() => {
      throw new Error("boom");
    });
    whenIdle(() => ran.push("next"));
    idle.shift()!({ timeRemaining: () => 0, didTimeout: false });
    idle.shift()!({ timeRemaining: () => 0, didTimeout: false });
    expect(ran).toEqual(["next"]);
  });
});
