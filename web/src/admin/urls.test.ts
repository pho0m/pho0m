import { describe, expect, it } from "vitest";
import { isSafeImageUrl, isSafeUrl } from "@pho0m/content";
import { HTTPS_ERROR, IMAGE_URL_ERROR, REQUIRED_URL, SPACE_ERROR, URL_ERROR, acceptedUrl, suggestUrl, urlError } from "./urls.ts";

describe("urlError (links)", () => {
  it("accepts what the schema accepts", () => {
    for (const v of ["https://pho0m.dev", "http://x.y", "mailto:a@b.co", "tel:+66812345678", "/media/a.webp", "#film"]) {
      expect(isSafeUrl(v)).toBe(true);
      expect(urlError(v)).toBeUndefined();
    }
  });
  it("rejects unsafe schemes with the Thai message", () => {
    for (const v of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x", "vbscript:x", "//evil.example", "ftp://x"]) {
      expect(isSafeUrl(v)).toBe(false);
      expect(urlError(v)).toBe(URL_ERROR);
    }
  });
  it("is quiet while a scheme is being typed", () => {
    for (const v of ["h", "htt", "https:/", "https://", "mail", "te"]) expect(urlError(v)).toBeUndefined();
    expect(urlError("x")).toBe(URL_ERROR);
  });
  it("treats empty as fine unless required", () => {
    expect(urlError("")).toBeUndefined();
    expect(urlError("", { required: true })).toBe(REQUIRED_URL);
  });
  it("suggests the obvious fix", () => {
    expect(urlError("github.com/pho0m")).toBe(`${URL_ERROR} · เช่น https://github.com/pho0m`);
    expect(urlError("pho0m@example.com")).toBe(`${URL_ERROR} · เช่น mailto:pho0m@example.com`);
    expect(urlError("081 234 5678")).toBe(`${URL_ERROR} · เช่น tel:0812345678`);
    expect(suggestUrl("javascript:alert(1)")).toBeNull();
  });
  it("points out spaces inside a URL", () => {
    expect(urlError("https://a b.com")).toBe(SPACE_ERROR);
  });
});

describe("urlError (images and the site address)", () => {
  it("allows only https:// or site paths for images", () => {
    expect(urlError("/media/2026/11/a.webp", { kind: "image" })).toBeUndefined();
    expect(urlError("https://storage.googleapis.com/b/a.webp", { kind: "image" })).toBeUndefined();
    for (const v of ["mailto:a@b.co", "#x", "data:image/png;base64,AAAA", "javascript:x"]) {
      expect(isSafeImageUrl(v)).toBe(false);
      expect(urlError(v, { kind: "image" })).toBe(IMAGE_URL_ERROR);
    }
  });
  it("requires https:// for the site address (as the schema does)", () => {
    expect(urlError("https://pho0m.kiattiphoom.workers.dev", { kind: "https", required: true })).toBeUndefined();
    expect(urlError("http://pho0m.kiattiphoom.workers.dev", { kind: "https" })).toBe(
      `${HTTPS_ERROR} · เช่น https://pho0m.kiattiphoom.workers.dev`,
    );
    expect(urlError("/", { kind: "https" })).toBe(HTTPS_ERROR);
    expect(urlError("", { kind: "https", required: true })).toBe(REQUIRED_URL);
  });
});

describe("acceptedUrl", () => {
  it("matches the schema for each kind (no leniency for half-typed values)", () => {
    expect(acceptedUrl("https://pho0m.dev", "https")).toBe(true);
    expect(acceptedUrl("https://", "https")).toBe(false);
    expect(acceptedUrl("HTTPS://pho0m.dev", "https")).toBe(false);
    expect(acceptedUrl("javascript:alert(1)", "https")).toBe(false);
    expect(acceptedUrl("mailto:a@b.co")).toBe(true);
    expect(acceptedUrl("mailto:a@b.co", "image")).toBe(false);
  });
});
