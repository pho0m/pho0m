import { describe, expect, it } from "vitest";
import { PROJECT_GROUPS } from "@pho0m/content";
import { GROUP_OPTIONS, groupLabel, groupOptions } from "./groups.ts";

describe("project group labels", () => {
  it("has a Thai and English label for every schema group", () => {
    for (const g of PROJECT_GROUPS) {
      const l = groupLabel(g);
      expect(l.th, g).not.toBe("");
      expect(l.en, g).not.toBe("");
    }
    expect(GROUP_OPTIONS.map((o) => o.value)).toEqual([...PROJECT_GROUPS]);
  });

  it("labels client work as NDA work", () => {
    expect(groupLabel("client")).toEqual({ th: "งานลูกค้า (NDA)", en: "Client work" });
    expect(GROUP_OPTIONS.find((o) => o.value === "client")?.label).toBe("งานลูกค้า (NDA) · Client work");
  });

  it("falls back to the id for a group added later", () => {
    expect(groupLabel("research")).toEqual({ th: "research", en: "research" });
    expect(groupOptions(["research"])).toEqual([{ value: "research", label: "research" }]);
    expect(groupLabel("toString")).toEqual({ th: "toString", en: "toString" });
  });
});
