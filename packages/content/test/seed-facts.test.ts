// Proposed home: packages/content/test/seed-facts.test.ts
// Regression checks for the sourced content fixes in content/seed.json (review findings
// cf-1, cf-3, cf-4, cf-6, cf-7, cf-8, cf-10, cf-11, cf-12, cf-13, readme-2).
import { describe, expect, it } from "vitest";
import { parseContent, publicProjection, timelineFrames, type Content } from "../src/index.ts";
import seedJson from "../../../content/seed.json";

const parsed = parseContent(seedJson);
if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues, null, 2));
const seed: Content = parsed.content;
const pub = publicProjection(seed);
const text = JSON.stringify(seedJson);
const publicText = JSON.stringify(pub);
const byId = <T extends { id: string }>(xs: T[], id: string): T => {
  const x = xs.find((y) => y.id === id);
  if (!x) throw new Error(`missing ${id}`);
  return x;
};
const both = (l: { th: string; en: string }) => `${l.th}\n${l.en}`;

describe("sourced content", () => {
  it("cf-1: no invented Keeta management app; the wood-factory Management Application is a client project", () => {
    expect(text).not.toContain("Keeta Management");
    const keeta = byId(seed.company.projects, "keeta-thai-traditional-karaoke");
    expect(keeta.features.map((f) => f.title.en)).not.toContain("Keeta Management Application");
    const m = byId(seed.projects, "management-application");
    expect(m.name).toBe("Management Application");
    expect(m.group).toBe("client");
    expect(m.published).toBe(true);
    expect(m.description.th).toContain("โรงงานแปรรูปผลิตภัณฑ์จากไม้");
    expect(m.description.en).toMatch(/wood-products processing factory/);
    expect(m.description.en).toMatch(/QR-code/);
    expect(m.tags).toEqual(expect.arrayContaining(["Flutter", "Dart"]));
  });

  it("cf-3: the Work-with-us design card describes the service, not an intern duty", () => {
    const card = seed.company.workWithUs[0]!;
    const all = both(card.heading) + both(card.description);
    for (const bad of ["mentor", "อาจารย์ที่ปรึกษา", "backyard", "assigned", "มอบหมาย"]) expect(all).not.toContain(bad);
    expect(card.description.en).toMatch(/flowcharts/);
    expect(card.description.en).toMatch(/database/);
    expect(card.description.en).toMatch(/schemas/);
    expect(card.description.en).toMatch(/users/);
    expect(card.description.th).toContain("ผังงาน");
    expect(card.description.th).toContain("ฐานข้อมูล");
  });

  it("cf-4: SEYES names both the thesis model (Faster R-CNN) and the published code's model (YOLOv5)", () => {
    const places = [
      byId(seed.timeline, "seyes").body,
      byId(seed.timeline, "kmutnb").body,
      byId(seed.projects, "seyes").description,
    ];
    for (const l of places) {
      for (const side of [l.th, l.en]) {
        expect(side).toContain("Faster R-CNN");
        expect(side).toContain("YOLOv5");
      }
    }
    expect(both(byId(seed.timeline, "seyes").summary)).not.toContain("Faster R-CNN");
  });

  it("cf-6: Thap is a 2021 traditional Thai music app with its own frame before the 2021-11 frame", () => {
    const thap = byId(seed.projects, "thap");
    expect(thap.year).toBe("2021");
    expect(thap.description.en).toMatch(/Traditional Thai music/i);
    expect(thap.description.th).toContain("เพลงไทยเดิม");
    expect(both(thap.description)).not.toContain("วัฒนธรรมไทย");
    const frames = timelineFrames(seed);
    const ids = frames.map((f) => f.id);
    const frame = byId(seed.timeline, "thap");
    expect(frame.date).toBe("2021-09");
    expect(frame.links.map((l) => l.url)).toContain("https://github.com/pho0m/thap");
    expect(ids.indexOf("thap")).toBeGreaterThan(ids.indexOf("kmutnb"));
    expect(ids.indexOf("thap")).toBeLessThan(ids.indexOf("musiver-timmy"));
    for (const f of frames) {
      if (f.id === "thap") continue;
      expect(f.links.map((l) => l.url), f.id).not.toContain("https://github.com/pho0m/thap");
      expect(both(f.title) + both(f.summary), f.id).not.toMatch(/\bThap\b/);
    }
    expect(new Set(seed.timeline.map((f) => f.id)).size).toBe(seed.timeline.length);
  });

  it("cf-7: school-project descriptions match their repos", () => {
    const kt = byId(seed.projects, "kiat-tune");
    expect(both(kt.description)).not.toContain("TCT");
    expect(kt.description.en).toMatch(/Web Technology class at KMUTNB/);
    expect(kt.description.th).toContain("วิชาเทคโนโลยีเว็บ");
    const commu = byId(seed.projects, "commu-app");
    expect(commu.description.en).toMatch(/real-time comments/);
    expect(text).not.toContain("กลางภาควิชา"); // reads as "department"; the repo says "midterm project for web technology"
    expect(byId(seed.projects, "the-timmy-story").description.en).toMatch(/TypeScript/);
  });

  it("cf-8: the co-op frame states no duration the diary does not give", () => {
    const coop = byId(seed.timeline, "coop-studio-twist");
    const all = both(coop.summary) + both(coop.body) + coop.dateLabel;
    expect(all).not.toMatch(/six months|6 เดือน|6 months/i);
    expect(coop.dateLabel).toBe("2023.05 –");
  });

  it("cf-10: the English errors from the Utotech source are fixed", () => {
    for (const bad of [
      "moblie",
      "for replace wedding card",
      "Custom line oa",
      "Custom and make quickly",
      "good hand ",
      "you ensuring",
      "and Development. We develop",
      "intragration",
      "Let's starting",
      "Informations",
      "Reported with low code",
    ]) expect(text, bad).not.toContain(bad);
    const hl = seed.company.highlights[0]!;
    expect(hl.title.en).toBe("End-to-End Project Consultation and Development");
    expect(hl.description.en.startsWith("We develop")).toBe(true);
    // subtitles carry no closing period (JSON-LD joins them with ". ")
    for (const s of seed.company.services) expect(s.subtitle.en.endsWith("."), s.id).toBe(false);
  });

  it("cf-11: no zero-width spaces or machine-translated Thai from the Utotech source", () => {
    expect(text).not.toMatch(/[​-‍﻿]/);
    for (const bad of ["บ้านซอฟต์แวร์", "ผู้ใช เป็น", "การออกแบบการพัฒนาซอฟต์แวร์", "อยู่ในมือที่ดี", "กรอบงาน"]) {
      expect(text, bad).not.toContain(bad);
    }
    expect(seed.company.story.th).toContain("ความทันสมัย นวัตกรรม");
  });

  it("cf-12: the diary has no note-to-self, missing-photo reference, typos or level mismatch", () => {
    const diary = JSON.stringify(seed.diary);
    for (const bad of ["ขออนุญาติ", "แปะเตือนตัวเอง", "ดังภาพ", "แจงแจง", "แจงจ่าย", "โปรเแกรม", "มายมาย", "เห่ง", "vocational certificate"]) {
      expect(diary, bad).not.toContain(bad);
    }
    expect(byId(seed.diary.entries, "2023-may").body.en).toMatch(/vocational diploma/);
  });

  it("cf-13 / readme-2: the empty flutter-template repo is a draft and no public frame points at it", () => {
    expect(byId(seed.projects, "flutter-template").published).toBe(false);
    expect(publicText).not.toContain("flutter-template");
    const kits = byId(seed.timeline, "teaching-kits");
    expect(both(kits.summary)).not.toMatch(/Flutter/);
    expect(kits.links.map((l) => l.label)).toEqual(["pure-php-template", "kru-taew-project"]);
  });
});
