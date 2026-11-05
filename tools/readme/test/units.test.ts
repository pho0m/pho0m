import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fit, measure, sentences, sentencesThatFit, wrap } from "../src/font/fonts.ts";
import { autoLevels, BAYER8, ditherBits } from "../src/image/gray.ts";
import { decodeJpegLuma } from "../src/image/jpeg.ts";
import { decodePngLuma, encodeTwoTonePng } from "../src/image/png.ts";
import { portraitPrints, sniffMime } from "../src/image/print.ts";
import { categoryParts } from "../src/model.ts";
import { cell, extractWaka, linkUrl } from "../src/readme.ts";
import { dotMatrixText, dotMatrixWidth, monogramLetters } from "../src/svg/glyphs.ts";
import { bioWithoutEcho } from "../src/svg/hero.ts";
import { esc, n } from "../src/svg/xml.ts";
import { ROOT } from "./helpers.ts";

describe("xml helpers", () => {
  it("escapes markup characters and drops characters XML cannot hold", () => {
    expect(esc(`a & b < c > "d" 'e'`)).toBe("a &amp; b &lt; c &gt; &quot;d&quot; &apos;e&apos;");
    expect(esc("ok\u0000\u0008\u001fok")).toBe("okok");
  });
  it("formats numbers compactly and deterministically", () => {
    expect(n(1)).toBe("1");
    expect(n(1.006)).toBe("1.01");
    expect(n(-0.001)).toBe("0");
    expect(n(10 / 3)).toBe("3.33");
  });
});

describe("markdown helpers", () => {
  it("makes table cells safe", () => {
    expect(cell("a | b\n<script>* _x_ [y]")).toBe("a \\| b &lt;script&gt;\\* \\_x\\_ \\[y\\]");
  });
  it("encodes characters that would break a markdown link", () => {
    expect(linkUrl("https://x.y/a b(c)")).toBe("https://x.y/a%20b%28c%29");
  });
  it("extracts the waka block including its markers", () => {
    const md = "x\n<!--START_SECTION:waka-->\n  keep  \n<!--END_SECTION:waka-->\ny";
    expect(extractWaka(md)).toBe("<!--START_SECTION:waka-->\n  keep  \n<!--END_SECTION:waka-->");
    expect(extractWaka("<!--END_SECTION:waka--> <!--START_SECTION:waka-->")).toBe("<!--START_SECTION:waka-->\n<!--END_SECTION:waka-->");
  });
});

describe("font metrics and text fitting", () => {
  it("measures VT323 as a monospace face and Chakra Petch as proportional", () => {
    expect(measure("iiii", "led", 20)).toBeCloseTo(measure("WWWW", "led", 20), 5);
    expect(measure("iiii", "b4", 20)).toBeLessThan(measure("WWWW", "b4", 20));
    expect(measure("abc", "b4", 20)).toBeCloseTo(measure("abc", "b4", 10) * 2, 5);
  });
  it("fits text with an ellipsis", () => {
    const long = "Solution Development & Prototype Flow Design";
    const cut = fit(long, "b6", 15, 120);
    expect(cut.endsWith("…")).toBe(true);
    expect(measure(cut, "b6", 15)).toBeLessThanOrEqual(120);
    expect(fit("short", "b6", 15, 120)).toBe("short");
  });
  it("wraps into at most maxLines lines, each fitting the width", () => {
    const lines = wrap("one two three four five six seven eight nine ten eleven twelve", "b4", 14, 90, 3);
    expect(lines.length).toBe(3);
    for (const l of lines) expect(measure(l, "b4", 14)).toBeLessThanOrEqual(90);
    expect(lines[2]!.endsWith("…")).toBe(true);
  });
  it("splits sentences without breaking company names or numbers", () => {
    expect(sentences("I joined Studio Twist Co., Ltd, a small house. It has 4.5 stars! Done")).toEqual([
      "I joined Studio Twist Co., Ltd, a small house.",
      "It has 4.5 stars!",
      "Done",
    ]);
    expect(sentencesThatFit("Short one. A much longer second sentence that will not fit.", "b4", 14, 120, 1)).toBe("Short one.");
  });
  it("drops bio sentences that only repeat the headline", () => {
    const bio = "I'm a backend developer with 4+ years of experience. I started at Studio Twist.";
    expect(bioWithoutEcho(bio, "Backend developer (Go) with 4+ years of experience.")).toBe("I started at Studio Twist.");
  });
});

describe("pixel glyphs", () => {
  it("normalises dot-matrix text and measures it", () => {
    expect(dotMatrixText("Web app · 2023")).toBe("WEB APP · 2023");
    expect(dotMatrixText("café ไทย")).toBe("CAFE ???");
    expect(dotMatrixWidth("AB")).toBe(11);
    expect(dotMatrixWidth("")).toBe(0);
  });
  it("builds monogram letters", () => {
    expect(monogramLetters("Power BI")).toBe("PB");
    expect(monogramLetters("AWS")).toBe("AW");
    expect(monogramLetters("")).toBe("?");
  });
  it("shortens categories for badges", () => {
    expect(categoryParts("Platform / Mobile Application / Web Application")).toEqual(["Platform", "Mobile app", "Web app"]);
  });
});

describe("images", () => {
  const jpeg = new Uint8Array(readFileSync(join(ROOT, "web", "public", "img", "profile.jpg")));

  it("decodes the baseline JPEG avatar to the same luminance as a reference decoder", () => {
    const img = decodeJpegLuma(jpeg);
    expect([img.width, img.height, img.orientation]).toEqual([724, 724, 1]);
    const block = (x: number, y: number) => {
      let s = 0;
      for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) s += img.data[(y + j) * img.width + x + i]!;
      return (s / 64) * 255;
    };
    // 8x8 block means from Pillow (libjpeg) for the same file
    const reference: [number, number, number][] = [[100, 100, 78], [350, 180, 37], [300, 400, 6], [600, 600, 205], [50, 650, 229], [360, 300, 76]];
    for (const [x, y, want] of reference) expect(Math.abs(block(x, y) - want), `${x},${y}`).toBeLessThan(2.5);
  });

  it("sniffs image types", () => {
    expect(sniffMime(jpeg)).toBe("image/jpeg");
    expect(sniffMime(new TextEncoder().encode("RIFF0000WEBPVP8 "))).toBe("image/webp");
    expect(sniffMime(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("round-trips a two-tone PNG", () => {
    const bits = Uint8Array.from({ length: 9 * 5 }, (_, i) => (i * 7) % 3 === 0 ? 1 : 0);
    const png = encodeTwoTonePng(bits, 9, 5, 2, "#ffffff", "#000000");
    const back = decodePngLuma(new Uint8Array(png));
    expect([back.width, back.height]).toEqual([18, 10]);
    for (let y = 0; y < 10; y++)
      for (let x = 0; x < 18; x++) expect(back.data[y * 18 + x]! < 0.5 ? 1 : 0).toBe(bits[(y >> 1) * 9 + (x >> 1)]);
  });

  it("uses a standard dispersed Bayer matrix", () => {
    expect(BAYER8.slice(0, 8)).toEqual([0, 32, 8, 40, 2, 34, 10, 42]);
    expect([...BAYER8].sort((a, b) => a - b)).toEqual(Array.from({ length: 64 }, (_, i) => i));
  });

  it("dithers mid grey to about half ink, white to paper and black to ink", () => {
    const grey = { width: 16, height: 16, data: new Float32Array(256).fill(0.5) };
    const ink = ditherBits(grey).reduce((a, b) => a + b, 0);
    expect(ink).toBe(128);
    expect(ditherBits({ ...grey, data: new Float32Array(256).fill(1) }).every((b) => b === 0)).toBe(true);
    expect(ditherBits({ ...grey, data: new Float32Array(256).fill(0) }).every((b) => b === 1)).toBe(true);
    expect(autoLevels({ width: 2, height: 1, data: Float32Array.from([0.4, 0.6]) }).data[1]).toBe(1);
  });

  it("makes a square print of the avatar, or null for undecodable files", () => {
    const print = portraitPrints(jpeg, 88, 176, [1])!;
    expect(print.cells).toBe(88);
    const bits = print.developing[0]!;
    const ink = bits.reduce((a, b) => a + b, 0) / bits.length;
    expect(ink).toBeGreaterThan(0.2);
    expect(ink).toBeLessThan(0.8);
    expect(portraitPrints(new TextEncoder().encode("RIFF0000WEBPVP8 "), 88, 176, [1])).toBeNull();
  });
});
