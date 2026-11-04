import { describe, expect, it } from "vitest";
import { PROJECT_GROUPS, seed } from "@pho0m/content";
import { badgeTint, groupLabel, hostOf, linkCode, linkLabel, monogram, paragraphs, PROJECT_GROUP_LABEL, projectGroups, telHref } from "./util.ts";

describe("monogram", () => {
  it("uses initials, camel capitals or the first two letters", () => {
    expect(monogram("Node.js")).toBe("NJ");
    expect(monogram("Google Cloud")).toBe("GC");
    expect(monogram("TypeScript")).toBe("TS");
    expect(monogram("React")).toBe("Re");
    expect(monogram("Go")).toBe("Go");
    expect(monogram("shadcn/ui")).toBe("SU");
    expect(monogram("X")).toBe("X");
  });

  it("gives every seeded skill a 1–2 character badge", () => {
    for (const g of seed.skills)
      for (const s of g.items) {
        const m = monogram(s.name);
        expect(m.length).toBeGreaterThan(0);
        expect([...m].length).toBeLessThanOrEqual(2);
        expect(badgeTint(s.name)).toMatch(/^#[0-9a-f]{6}$/);
      }
  });
});

describe("text helpers", () => {
  it("splits paragraphs", () => {
    expect(paragraphs("a\n\nb\nc\n\n  ")).toEqual(["a", "b", "c"]);
    expect(paragraphs("")).toEqual([]);
  });

  it("labels links", () => {
    expect(linkLabel({ kind: "website", label: "", url: "https://www.madebytwist.com/" })).toBe("madebytwist.com");
    expect(linkLabel({ kind: "email", label: "", url: "mailto:a@b.co" })).toBe("a@b.co");
    expect(linkLabel({ kind: "github", label: "GitHub", url: "https://github.com/pho0m" })).toBe("GitHub");
    expect(linkCode("github")).toBe("GH");
    expect(hostOf("https://utotech.co.th/")).toBe("utotech.co.th");
    expect(telHref("+66 80-423-7373")).toBe("tel:+66804237373");
  });

  it("names project groups in both languages", () => {
    expect(groupLabel("teaching", "th")).toBe("งานสอน");
    expect(groupLabel("teaching", "en")).toBe("Teaching");
  });

  it("labels every contract group and survives unknown ones", () => {
    for (const g of PROJECT_GROUPS) expect(PROJECT_GROUP_LABEL[g], g).toBeDefined();
    expect(groupLabel("client", "th")).toBe("งานลูกค้า");
    expect(groupLabel("client", "en")).toBe("Client work");
    expect(groupLabel("open-source", "en")).toBe("Open source");
    expect(groupLabel("toString", "en")).toBe("ToString");
  });
});

describe("projectGroups", () => {
  it("keeps contract order and appends groups it does not know", () => {
    expect(projectGroups(PROJECT_GROUPS, ["school", "client", "zine", "school"])).toEqual(["client", "school", "zine"]);
    expect(projectGroups(PROJECT_GROUPS, [])).toEqual([]);
  });
});
