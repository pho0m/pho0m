import { afterEach, describe, expect, it, vi } from "vitest";
import { type Content } from "@pho0m/content";
import { seed } from "@pho0m/content/seed";
import { EMBEDDED_CONTENT_ID, initialContent, isNewerContent, readEmbeddedContent } from "../lib/content.ts";

/** A page with the content the SEO post-step bakes in (JSON with "<" escaped). */
function pageWith(json: string, type = "application/json"): Document {
  const doc = document.implementation.createHTMLDocument("t");
  const s = doc.createElement("script");
  s.type = type;
  s.id = EMBEDDED_CONTENT_ID;
  s.textContent = json;
  doc.body.appendChild(s);
  return doc;
}
const escaped = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");
const at = (c: Content, updatedAt: string): Content => ({ ...c, updatedAt });

afterEach(() => vi.restoreAllMocks());

describe("content baked into the page", () => {
  it("reads and validates the embedded JSON", async () => {
    const baked = structuredClone(seed);
    baked.profile.role = { th: "บทบาท </script> ใหม่", en: "New <b>role</b>" };
    const got = readEmbeddedContent(pageWith(escaped(baked)));
    expect(got?.profile.role).toEqual(baked.profile.role);
    expect(await initialContent(pageWith(escaped(baked)))).toEqual(got);
  });

  it("falls back to the seed (loaded on demand) when the page has none or it is broken", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const empty = document.implementation.createHTMLDocument("t");
    expect(readEmbeddedContent(empty)).toBeNull();
    expect(await initialContent(empty)).toBe(seed);
    expect(readEmbeddedContent(pageWith("{not json"))).toBeNull();
    expect(readEmbeddedContent(pageWith(JSON.stringify({ profile: 42 })))).toBeNull();
    expect(readEmbeddedContent(pageWith(escaped(seed), "text/plain"))).toBeNull();
    expect(await initialContent(pageWith("{not json"))).toBe(seed);
    expect(warn).toHaveBeenCalled();
  });

  it("only treats live content saved later as newer", () => {
    const base = at(seed, "2026-11-05T00:00:00.000Z");
    expect(isNewerContent(at(seed, "2026-11-06T00:00:00.000Z"), base)).toBe(true);
    expect(isNewerContent(at(seed, "2026-11-05T00:00:00.000Z"), base)).toBe(false);
    expect(isNewerContent(at(seed, "2026-11-01T00:00:00.000Z"), base)).toBe(false);
    // no date on the live copy: cannot be shown to be newer
    expect(isNewerContent(at(seed, ""), base)).toBe(false);
    // a dated live copy beats an undated one
    expect(isNewerContent(base, at(seed, ""))).toBe(true);
  });
});
