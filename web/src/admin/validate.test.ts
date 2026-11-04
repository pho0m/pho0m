import { describe, expect, it } from "vitest";
import { type Content } from "@pho0m/content";
import { seed } from "@pho0m/content/seed";
import { humanPath, sectionForPath } from "./sections.ts";
import { IMAGE_URL_ERROR, URL_ERROR } from "./urls.ts";
import { UNSAFE_URL_MESSAGE, autoId, duplicateIdIssues, extraUrlIssues, fillAutoIds, thaiMessage, validateDraft } from "./validate.ts";

const clone = (c: Content): Content => structuredClone(c);

describe("validateDraft", () => {
  it("accepts the seed", () => {
    const r = validateDraft(clone(seed));
    expect(r.ok).toBe(true);
  });

  it("fills empty ids from the English title and keeps them unique", () => {
    const c = clone(seed);
    const base = c.timeline[0]!;
    c.timeline.push({ ...base, id: "", title: { th: "ทดสอบ", en: "Studio Twist · first job" } });
    c.timeline.push({ ...base, id: "", title: { th: "ไทยล้วน", en: "" } });
    const filled = fillAutoIds(c);
    const ids = filled.timeline.map((f) => f.id);
    expect(ids.at(-2)).toBe("studio-twist-first-job");
    expect(ids.at(-1)).toBe("frame");
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateDraft(c).ok).toBe(true);
  });

  it("adds a suffix when the slug is already taken", () => {
    const c = clone(seed);
    const first = c.timeline[0]!;
    c.timeline.push({ ...first, id: "", title: { th: "", en: first.id.replace(/-/g, " ") } });
    expect(fillAutoIds(c).timeline.at(-1)!.id).toBe(`${first.id}-2`);
  });

  it("reports schema issues with their paths", () => {
    const c = clone(seed);
    c.timeline[2] = { ...c.timeline[2]!, date: "2023/5" };
    const r = validateDraft(c);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues).toContainEqual({ path: "timeline.2.date", message: "use YYYY or YYYY-MM" });
  });

  it("blocks unsafe link schemes (schema) and explains them in Thai", () => {
    const c = clone(seed);
    c.profile.links = [{ kind: "website", label: "x", url: "javascript:alert(1)" }];
    const r = validateDraft(c);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const issue = r.issues.find((i) => i.path === "profile.links.0.url");
    expect(issue).toBeDefined();
    expect(issue!.message).toBe(UNSAFE_URL_MESSAGE);
    expect(thaiMessage(issue!.message)).toBe(URL_ERROR);
  });

  it("holds the diary sheet / slides links to the same rule", () => {
    const c = clone(seed);
    c.diary.sheetUrl = "javascript:alert(1)";
    c.diary.slidesUrl = "https://docs.google.com/presentation/d/x";
    expect(extraUrlIssues(c)).toEqual([{ path: "diary.sheetUrl", message: UNSAFE_URL_MESSAGE }]);
    const r = validateDraft(c);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues).toEqual([{ path: "diary.sheetUrl", message: UNSAFE_URL_MESSAGE }]);
    c.diary.sheetUrl = "";
    expect(validateDraft(c).ok).toBe(true);
  });

  it("blocks duplicate ids", () => {
    const c = clone(seed);
    c.projects[1] = { ...c.projects[1]!, id: c.projects[0]!.id };
    expect(duplicateIdIssues(c)).toHaveLength(1);
    const r = validateDraft(c);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]!.path).toBe("projects.1.id");
  });
});

describe("helpers", () => {
  it("derives ids with a fallback for Thai-only titles", () => {
    expect(autoId("Hello World", "frame")).toBe("hello-world");
    expect(autoId("สวัสดี", "frame")).toBe("frame");
  });
  it("explains zod messages in Thai", () => {
    expect(thaiMessage("Required")).toBe("ต้องกรอก");
    expect(thaiMessage("use YYYY or YYYY-MM")).toContain("YYYY-MM");
    expect(thaiMessage("String must contain at least 1 character(s)")).toBe("ห้ามเว้นว่าง");
    expect(thaiMessage(UNSAFE_URL_MESSAGE)).toBe(URL_ERROR);
    expect(thaiMessage("use https://… or a site path (/media/…)")).toBe(IMAGE_URL_ERROR);
    expect(thaiMessage("use https://…")).toBe("ต้องขึ้นต้นด้วย https://");
  });
  it("maps paths to screens and readable labels", () => {
    expect(sectionForPath("company.projects.2.name")).toBe("utotech");
    expect(sectionForPath("timeline.0.date")).toBe("timeline");
    expect(sectionForPath("nope")).toBeNull();
    expect(humanPath("company.projects.2.features.0.title.en")).toBe("Utotech › projects › #3 › features › #1 › title › en");
  });
});
