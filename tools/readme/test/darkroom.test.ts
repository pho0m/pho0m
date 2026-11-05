import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { inflateSync } from "node:zlib";
import { ICON_NAMES } from "@pho0m/content";
import { describe, expect, it } from "vitest";
import { dotFit, dotSafe, textWidth } from "../src/gif/canvas.ts";
import { encodeGif, mergeStill } from "../src/gif/encode.ts";
import { DEV_LEVELS, filmGifFrames, gifPalette, type GifPrint } from "../src/gif/film.ts";
import { FRAME_H, FRAME_W, clearLevels, developingBits, iconScene, iconSource, lumaOf, negativeAt, photoSource } from "../src/image/darkroom.ts";
import { deflateRaw, huffmanLengths, zlibDeflate } from "../src/image/deflate.ts";
import { BAYER8 } from "../src/image/gray.ts";
import { decodePngLuma, encodeGrayPng, encodeIndexedPng } from "../src/image/png.ts";
import { portraitPrints } from "../src/image/print.ts";
import { ROOT, decodeGifFrames, parseGif } from "./helpers.ts";

/** The standard 8x8 Bayer (dispersed-dot) matrix, as in web/src/lib/pixel.ts. */
const STANDARD_BAYER8 = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
];

describe("deterministic deflate", () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  it("round-trips through zlib for empty, tiny, repetitive and noisy data", () => {
    const cases = [
      new Uint8Array(0),
      Uint8Array.of(42),
      new Uint8Array(70_000).fill(9),
      Uint8Array.from({ length: 40_000 }, (_, i) => (i % 300 < 150 ? i & 7 : 255 - (i & 3))),
      Uint8Array.from({ length: 50_000 }, () => Math.floor(rnd() * 256)),
    ];
    for (const data of cases) {
      const z = zlibDeflate(data);
      expect(Buffer.compare(inflateSync(z), Buffer.from(data)), `length ${data.length}`).toBe(0);
    }
    expect(zlibDeflate(new Uint8Array(70_000).fill(9)).length).toBeLessThan(200);
  });
  it("gives the same bytes every time", () => {
    const data = Uint8Array.from({ length: 20_000 }, (_, i) => (i * 31) & 0xff);
    expect(Buffer.from(deflateRaw(data)).equals(Buffer.from(deflateRaw(data)))).toBe(true);
  });
  it("limits Huffman code lengths and keeps the code complete", () => {
    const fib = [1, 1];
    while (fib.length < 30) fib.push(fib.at(-1)! + fib.at(-2)!);
    const lengths = huffmanLengths(fib, 15);
    expect(Math.max(...lengths)).toBeLessThanOrEqual(15);
    expect(lengths.reduce((a, l) => a + (l ? 2 ** -l : 0), 0)).toBeCloseTo(1, 10);
  });
});

describe("PNG encoders", () => {
  it("round-trip greyscale levels (adaptive filters) and palette indices at 1/2/4/8 bits", () => {
    const w = 37;
    const h = 23;
    const levels = Uint8Array.from({ length: w * h }, (_, i) => (i * 13 + (i >> 3)) & 0xff);
    const back = decodePngLuma(new Uint8Array(encodeGrayPng(levels, w, h)));
    for (let i = 0; i < levels.length; i++) expect(Math.round(back.data[i]! * 255)).toBe(levels[i]);
    for (const colours of [2, 3, 16, 200]) {
      const palette = Array.from({ length: colours }, (_, i) => `#${[i, i, i].map((v) => Math.round((v * 255) / (colours - 1)).toString(16).padStart(2, "0")).join("")}`);
      const idx = Uint8Array.from({ length: w * h }, (_, i) => (i * 7) % colours);
      const png = decodePngLuma(new Uint8Array(encodeIndexedPng(idx, w, h, palette, 2)));
      expect([png.width, png.height]).toEqual([w * 2, h * 2]);
      for (let y = 0; y < h * 2; y++)
        for (let x = 0; x < w * 2; x++) {
          const want = Math.round((idx[(y >> 1) * w + (x >> 1)]! * 255) / (colours - 1));
          expect(Math.round(png.data[y * w * 2 + x]! * 255)).toBe(want);
        }
    }
  });
});

describe("darkroom prints (port of the site's pipeline)", () => {
  it("uses the standard 8x8 Bayer matrix", () => {
    expect(BAYER8).toEqual(STANDARD_BAYER8);
  });

  it("matches the website's iconScene, ditherPrint and tonePrint pixel for pixel", async () => {
    // Loaded at runtime (not type-checked here: those files use DOM types).
    type Img = { data: Uint8ClampedArray };
    const pixel = await import(pathToFileURL(join(ROOT, "web", "src", "lib", "pixel.ts")).href);
    expect(pixel.BAYER8).toEqual(STANDARD_BAYER8);
    for (const [k, icon] of ICON_NAMES.entries()) {
      const t = k / (ICON_NAMES.length - 1);
      const site = pixel.iconScene(icon, t, k) as Img;
      const ours = iconScene(icon, t, k);
      expect(Buffer.from(ours.data).equals(Buffer.from(site.data)), icon).toBe(true);
      // developing dither at half and full level: identical bits
      for (const level of [0.5, 1]) {
        const want = pixel.ditherPrint(site, { level }) as Img;
        const bits = developingBits(iconSource(icon, t, k), level);
        let diff = 0;
        for (let i = 0; i < bits.length; i++) if (bits[i] !== (want.data[i * 4] === pixel.INK[0] ? 1 : 0)) diff++;
        expect(diff, `${icon} dither ${level}`).toBe(0);
      }
      // clear print: same levels within rounding
      const tone = pixel.tonePrint(site, { contrast: 0.15, grain: 0 }) as Img;
      const clear = clearLevels(iconSource(icon, t, k));
      let worst = 0;
      for (let i = 0; i < clear.length; i++) {
        const level = ((tone.data[i * 4]! - pixel.INK[0]) / (pixel.PAPER[0] - pixel.INK[0])) * 255;
        worst = Math.max(worst, Math.abs(level - clear[i]!));
      }
      expect(worst, `${icon} clear`).toBeLessThanOrEqual(2);
    }
    // the negative is the site's negativeOf() applied to the clear print
    const paperNeg = pixel.negativeOf({ width: 1, height: 1, data: Uint8ClampedArray.from([...pixel.PAPER, 255]) }) as Img;
    expect(negativeAt(1)).toEqual([...paperNeg.data.slice(0, 3)]);
  });

  it("develops darker tones first and finishes with a continuous-tone print", () => {
    const src = iconSource("rocket", 1, 3);
    const ink = (l: number) => developingBits(src, l).reduce((a, b) => a + b, 0);
    expect(ink(0)).toBe(0);
    expect(ink(0.3)).toBeLessThan(ink(0.7));
    expect(ink(0.7)).toBeLessThan(ink(1));
    const levels = new Set(clearLevels(src));
    expect(levels.size).toBeGreaterThan(8); // not a two-tone dither
    expect(lumaOf(iconScene("rocket", 1, 3)).data.length).toBe(FRAME_W * FRAME_H);
  });

  it("cover-fits photos and contains cut-outs on paper", () => {
    const tall = { width: 10, height: 40, data: Float32Array.from({ length: 400 }, (_, i) => (i < 200 ? 0 : 1)) };
    const cover = photoSource(tall, 16, 11);
    expect(cover.gray.width).toBe(16);
    expect(cover.ditherTone && cover.clearTone).toBeTruthy();
    const cut = photoSource({ ...tall, data: new Float32Array(400), cutout: true }, 16, 11);
    expect(cut.gray.data[0]).toBe(1); // margin is paper
    expect(cut.gray.data[5 * 16 + 8]).toBe(0);
  });

  it("makes the avatar a clear print plus lighter-to-darker dither stages", () => {
    const jpeg = new Uint8Array(readFileSync(join(ROOT, "web", "public", "img", "profile.jpg")));
    const p = portraitPrints(jpeg, 88, 176, [0.35, 0.7, 1])!;
    expect(p.clear.length).toBe(176 * 176);
    expect(new Set(p.clear).size).toBeGreaterThan(64);
    const ink = p.developing.map((b) => b.reduce((a, v) => a + v, 0));
    expect(ink[0]!).toBeLessThan(ink[1]!);
    expect(ink[1]!).toBeLessThan(ink[2]!);
    expect(portraitPrints(new TextEncoder().encode("RIFF0000WEBPVP8 "), 88, 176, [1])).toBeNull();
  });
});

describe("GIF pieces", () => {
  it("keeps the palette within 256 colours with a reserved transparent index", () => {
    const P = gifPalette();
    expect(P.colors.length).toBeLessThanOrEqual(256);
    expect(P.duo(0)).not.toBe(P.transparent);
    expect(P.duo(255)).toBe(P.duo(254.9));
    expect(P.neg(0)).not.toBe(P.neg(255));
  });

  it("merges identical frames and encodes changed pixels only", () => {
    const a = new Uint8Array(16).fill(1);
    const b = new Uint8Array(16).fill(1);
    b[5] = 2;
    const merged = mergeStill([{ pixels: a, delay: 80 }, { pixels: a.slice(), delay: 80 }, { pixels: b, delay: 100 }]);
    expect(merged.map((f) => f.delay)).toEqual([160, 100]);
    const bytes = encodeGif(merged, { width: 4, height: 4, palette: [[0, 0, 0], [255, 0, 0], [0, 255, 0]], transparentIndex: 0 });
    const info = parseGif(bytes);
    expect(info.version).toBe("GIF89a");
    expect(info.loop).toBe(0);
    expect(info.frames.map((f) => [f.delay, f.transparent, f.dispose, f.x, f.y, f.w, f.h])).toEqual([[160, true, 1, 0, 0, 4, 4], [100, true, 1, 1, 1, 1, 1]]);
    expect(decodeGifFrames(bytes).map((px) => [...px])).toEqual([[...a], [...b]]);
  });

  it("encodes changed rectangles that decode back to exactly the rendered frames", () => {
    const prints: GifPrint[] = (["rocket", "code", "board"] as const).map((icon, i) => {
      const src = iconSource(icon, i / 2, i);
      return { number: i + 1, date: `Jan 202${i}`, stamp: `'2${i}`, title: `Frame ${i}`, clear: clearLevels(src), developing: DEV_LEVELS.map((l) => developingBits(src, l)) };
    });
    const { frames, palette } = filmGifFrames(prints, "pho0m");
    const bytes = encodeGif(frames, { width: 840, height: 260, palette: palette.colors, transparentIndex: palette.transparent });
    const info = parseGif(bytes);
    expect(info.frames.length).toBe(frames.length);
    expect(info.frames.slice(1).some((f) => f.w < 840 || f.h < 260)).toBe(true); // cropped
    const decoded = decodeGifFrames(bytes);
    expect(decoded.length).toBe(frames.length);
    decoded.forEach((px, i) => expect(Buffer.from(px).equals(Buffer.from(frames[i]!.pixels)), `frame ${i}`).toBe(true));
  });

  it("writes only what the dot-matrix font can draw", () => {
    expect(dotSafe("Café — LINE OA (v2), ทดสอบ")).toBe("CAFE - LINE OA (V2),");
    expect(textWidth("AB", 2)).toBe(22);
    const cut = dotFit("A VERY LONG CAPTION THAT DOES NOT FIT", 2, 120);
    expect(cut.endsWith("..")).toBe(true);
    expect(textWidth(cut, 2)).toBeLessThanOrEqual(120);
  });
});
