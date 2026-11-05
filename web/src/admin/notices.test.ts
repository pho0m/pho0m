import { describe, expect, it } from "vitest";
import { DRAFT_HINT, HIDDEN_HINT, readRedeploy, readWarning, redeployNotice, warningCopy } from "./notices.ts";

describe("redeployNotice", () => {
  it("says the rebuild was requested", () => {
    expect(redeployNotice("sent")).toEqual({ tone: "ok", text: "สั่งอัปเดต SEO/README แล้ว (ประมาณ 2–5 นาที)" });
  });
  it("says a rate-limited rebuild goes out later", () => {
    expect(redeployNotice("queued")).toEqual({ tone: "muted", text: "จะอัปเดต SEO/README รอบถัดไป" });
  });
  it("warns on failure and points to a manual Deploy run", () => {
    const n = redeployNotice("failed")!;
    expect(n.tone).toBe("warn");
    expect(n.text).toContain("ไม่สำเร็จ");
    expect(n.detail).toContain("เนื้อหาบันทึกแล้ว");
    expect(n.detail).toContain("Deploy");
  });
  it("hints quietly that DISPATCH_TOKEN is not set", () => {
    const n = redeployNotice("off")!;
    expect(n.tone).toBe("muted");
    expect(n.text).toContain("DISPATCH_TOKEN");
  });
  it("says nothing when the API does not report it", () => {
    expect(redeployNotice(undefined)).toBeNull();
    expect(redeployNotice(null)).toBeNull();
  });
});

describe("readRedeploy / readWarning", () => {
  it("accepts only the known statuses", () => {
    for (const s of ["sent", "queued", "failed", "off"]) expect(readRedeploy(s)).toBe(s);
    expect(readRedeploy("done")).toBeNull();
    expect(readRedeploy(undefined)).toBeNull();
    expect(readRedeploy(1)).toBeNull();
  });
  it("reads a warning string and ignores anything else", () => {
    expect(readWarning("  drafts could not be decrypted ")).toBe("drafts could not be decrypted");
    expect(readWarning(undefined)).toBe("");
    expect(readWarning({ text: "x" })).toBe("");
  });
});

describe("warningCopy", () => {
  it("explains the decrypt warning, what saving does and how to recover", () => {
    const c = warningCopy("drafts could not be decrypted; showing the published version");
    expect(c.title).toBe("อ่านฉบับร่างและรายการที่ซ่อนไม่ได้");
    expect(c.lines.join(" ")).toContain("SESSION_SECRET");
    expect(c.lines.join(" ")).toContain("ถ้ากดบันทึก");
  });
  it("falls back to a generic title for other warnings", () => {
    expect(warningCopy("something else")).toEqual({ title: "เซิร์ฟเวอร์แจ้งเตือนเรื่องเนื้อหา", lines: [] });
  });
});

describe("draft / hidden hints", () => {
  it("say the item is not published and is stored encrypted", () => {
    for (const h of [DRAFT_HINT, HIDDEN_HINT]) {
      expect(h).toContain("ไม่แสดงบนเว็บ");
      expect(h).toContain("ไม่อยู่ในไฟล์สาธารณะ");
      expect(h).toContain("เข้ารหัส");
    }
  });
});
