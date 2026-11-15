import { describe, expect, it } from "vitest";
import seedJson from "../../../content/seed.json";
import { Content, absoluteUrl, frameDateLabel, frameStamp, parseContent, t, timelineFrames } from "../src/index.ts";
import { seed } from "../src/seed.ts";

describe("content contract", () => {
  it("seed.json validates against the schema", () => {
    const r = parseContent(seedJson);
    if (!r.ok) throw new Error(JSON.stringify(r.issues, null, 2));
    expect(r.content.schemaVersion).toBe(1);
  });

  it("ids are unique inside every collection", () => {
    const groups: Record<string, string[]> = {
      timeline: seed.timeline.map((f) => f.id),
      projects: seed.projects.map((p) => p.id),
      companyProjects: seed.company.projects.map((p) => p.id),
      services: seed.company.services.map((s) => s.id),
      skills: seed.skills.map((s) => s.id),
      diary: seed.diary.entries.map((e) => e.id),
      documents: seed.documents.map((d) => d.id),
    };
    for (const [name, ids] of Object.entries(groups)) {
      expect(new Set(ids).size, name).toBe(ids.length);
    }
  });

  it("timeline sorts oldest first and hides drafts", () => {
    const c = Content.parse({ ...seedJson, timeline: [
      { id: "b", date: "2023-05", title: { en: "B" }, summary: { en: "" } },
      { id: "a", date: "2021", title: { en: "A" }, summary: { en: "" } },
      { id: "d", date: "2022", title: { en: "D" }, summary: { en: "" }, published: false },
    ] });
    expect(timelineFrames(c).map((f) => f.id)).toEqual(["a", "b"]);
    expect(timelineFrames(c, { includeDrafts: true }).map((f) => f.id)).toEqual(["a", "d", "b"]);
  });

  it("rejects malformed dates and ids", () => {
    const bad = { ...seedJson, timeline: [{ id: "Bad Id", date: "May 2023", title: { en: "x" }, summary: { en: "" } }] };
    const r = parseContent(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.path)).toEqual(expect.arrayContaining(["timeline.0.id", "timeline.0.date"]));
  });

  it("helpers", () => {
    expect(t({ th: "", en: "Hello" }, "th")).toBe("Hello");
    expect(t({ th: "สวัสดี", en: "Hello" }, "th")).toBe("สวัสดี");
    expect(frameDateLabel({ date: "2023-05", dateLabel: "" })).toBe("2023.05");
    expect(frameDateLabel({ date: "2026-11", dateLabel: "NOW" })).toBe("NOW");
    expect(frameStamp({ date: "2023-05" })).toBe("'23 05");
    expect(frameStamp({ date: "2021" })).toBe("'21");
    expect(absoluteUrl("/media/a.webp", "https://x.web.app/")).toBe("https://x.web.app/media/a.webp");
    expect(absoluteUrl("https://cdn/a.png", "https://x.web.app")).toBe("https://cdn/a.png");
  });

  it("every site-relative seed image exists in web/public", async () => {
    const { existsSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const pub = fileURLToPath(new URL("../../../web/public", import.meta.url));
    const urls: string[] = [];
    JSON.stringify(seedJson, (k, v) => { if (k === "url" && typeof v === "string" && v.startsWith("/")) urls.push(v); return v; });
    const missing = urls.filter((u) => !existsSync(pub + u));
    expect(missing).toEqual([]);
  });
});

describe("sprites", () => {
  it("every icon name has a 16x16 sprite using known palette keys", async () => {
    const { ICON_NAMES, SPRITES, SPRITE_PALETTE } = await import("../src/index.ts");
    for (const name of ICON_NAMES) {
      const rows = SPRITES[name];
      expect(rows, name).toBeDefined();
      expect(rows.length, name).toBe(16);
      for (const row of rows) {
        expect(row.length, `${name}: "${row}"`).toBe(16);
        for (const ch of row) if (ch !== ".") expect(SPRITE_PALETTE[ch], `${name} key ${ch}`).toBeDefined();
      }
    }
  });
});

describe("safe urls + public projection", async () => {
  const m = await import("../src/index.ts");
  it("accepts http(s), mailto, tel, site paths and anchors; rejects script-ish schemes", () => {
    for (const ok of ["https://a.b/c", "http://x.y", "mailto:a@b.c", "tel:+6612", "/media/a.png", "#film"]) expect(m.isSafeUrl(ok), ok).toBe(true);
    for (const bad of ["javascript:alert(1)", "JaVaScRiPt:x", " https://a.b", "data:text/html,x", "//evil.com", "vbscript:x", "https://a b", ""]) expect(m.isSafeUrl(bad), bad).toBe(false);
    expect(m.isSafeImageUrl("mailto:x@y.z")).toBe(false);
    const bad = { ...seedJson, profile: { ...seedJson.profile, links: [{ kind: "website", label: "x", url: "javascript:alert(1)" }] } };
    expect(m.parseContent(bad).ok).toBe(false);
  });
  it("publicProjection drops drafts and hidden contact values, idempotently", async () => {
    const { seed: s0 } = await import("../src/seed.ts");
    const c = structuredClone(s0);
    c.timeline[0]!.published = false;
    c.projects[0]!.published = false;
    c.profile.phone = { value: "+66 81-PRIVATE", visible: false };
    const p = m.publicProjection(c);
    // the seed itself may hold drafts (e.g. flutter-template), so count what stays published
    expect(p.timeline).toHaveLength(c.timeline.filter((f) => f.published).length);
    expect(p.projects).toHaveLength(c.projects.filter((x) => x.published).length);
    expect(p.projects.every((x) => x.published)).toBe(true);
    expect(JSON.stringify(p)).not.toContain("PRIVATE");
    expect(p.documents.every((d) => d.url)).toBe(true);
    expect(m.publicProjection(p)).toEqual(p);
    expect(m.parseContent(p).ok).toBe(true);
  });
});

describe("canvaEmbedUrl", async () => {
  const { canvaEmbedUrl } = await import("../src/index.ts");
  it("turns a Canva view link into its embed URL and rejects anything else", () => {
    expect(canvaEmbedUrl("https://www.canva.com/design/DAF-2N6H19s/en6L8oxUA0kbrUClRS8ROA/view")).toBe(
      "https://www.canva.com/design/DAF-2N6H19s/en6L8oxUA0kbrUClRS8ROA/view?embed",
    );
    expect(canvaEmbedUrl("https://www.canva.com/design/DAF-2N6H19s/en6L8oxUA0kbrUClRS8ROA/view?utm_content=x&utm_source=y")).toBe(
      "https://www.canva.com/design/DAF-2N6H19s/en6L8oxUA0kbrUClRS8ROA/view?embed",
    );
    for (const bad of ["https://evil.com/design/a/b/view", "http://www.canva.com/design/a/b/view", "https://www.canva.com/design/a\"onload=x/b/view", "https://docs.google.com/spreadsheets/d/x/edit", ""]) {
      expect(canvaEmbedUrl(bad), bad).toBeNull();
    }
  });
});
