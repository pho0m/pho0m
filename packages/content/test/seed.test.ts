import { describe, expect, it } from "vitest";
import seedJson from "../../../content/seed.json";
import { Content, absoluteUrl, frameDateLabel, frameStamp, parseContent, seed, t, timelineFrames } from "../src/index.ts";

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
