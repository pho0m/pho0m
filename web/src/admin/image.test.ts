import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES } from "@pho0m/content";
import { canReencode, checkUpload, fileNameOf, fitWithin, guessType, isPdfUrl, renameExt } from "./image.ts";

describe("fitWithin", () => {
  it("leaves images at or under the limit alone", () => {
    expect(fitWithin(2000, 1500)).toEqual({ width: 2000, height: 1500, resized: false });
    expect(fitWithin(640, 480)).toEqual({ width: 640, height: 480, resized: false });
  });
  it("scales the longest edge down to the limit, keeping the ratio", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 2000, height: 1500, resized: true });
    expect(fitWithin(3000, 6000)).toEqual({ width: 1000, height: 2000, resized: true });
    expect(fitWithin(2001, 10)).toEqual({ width: 2000, height: 10, resized: true });
  });
  it("never returns a zero edge for extreme panoramas", () => {
    expect(fitWithin(100000, 10)).toEqual({ width: 2000, height: 1, resized: true });
  });
  it("supports a custom limit and guards against bad input", () => {
    expect(fitWithin(800, 400, 400)).toEqual({ width: 400, height: 200, resized: true });
    expect(fitWithin(0, 100)).toEqual({ width: 0, height: 0, resized: false });
  });
});

describe("upload checks", () => {
  it("guesses the type from the extension when the browser leaves it empty", () => {
    expect(guessType({ name: "cv.PDF", type: "" })).toBe("application/pdf");
    expect(guessType({ name: "a.jpeg", type: "" })).toBe("image/jpeg");
    expect(guessType({ name: "a.bin", type: "" })).toBe("");
    expect(guessType({ name: "a.png", type: "image/png" })).toBe("image/png");
  });
  it("rejects unsupported types and oversize PDF/GIF with Thai messages", () => {
    const svg = checkUpload({ name: "logo.svg", size: 10, type: "image/svg+xml" });
    expect(svg.ok).toBe(false);
    if (!svg.ok) expect(svg.message).toContain("ไม่รองรับ");
    const pdf = checkUpload({ name: "big.pdf", size: MAX_UPLOAD_BYTES + 1, type: "application/pdf" });
    expect(pdf.ok).toBe(false);
    if (!pdf.ok) expect(pdf.message).toContain("ใหญ่เกินไป");
    expect(checkUpload({ name: "anim.gif", size: MAX_UPLOAD_BYTES + 1, type: "image/gif" }).ok).toBe(false);
    expect(checkUpload({ name: "empty.png", size: 0, type: "image/png" }).ok).toBe(false);
  });
  it("lets large still images through so they can be resized first", () => {
    expect(checkUpload({ name: "photo.jpg", size: MAX_UPLOAD_BYTES + 1, type: "image/jpeg" })).toEqual({
      ok: true,
      type: "image/jpeg",
    });
  });
  it("re-encodes still images only", () => {
    expect(canReencode("image/png")).toBe(true);
    expect(canReencode("image/gif")).toBe(false);
    expect(canReencode("application/pdf")).toBe(false);
  });
  it("renames extensions and reads file names", () => {
    expect(renameExt("My Photo.JPG", "webp")).toBe("My Photo.webp");
    expect(renameExt("noext", "webp")).toBe("noext.webp");
    expect(fileNameOf("https://storage.googleapis.com/b/media/2026/11/a-x1.webp?v=1")).toBe("a-x1.webp");
    expect(isPdfUrl("/media/cv.pdf")).toBe(true);
    expect(isPdfUrl("/media/cv.png")).toBe(false);
  });
});
