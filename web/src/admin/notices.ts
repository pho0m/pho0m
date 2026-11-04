import type { SaveContentResponse } from "@pho0m/content";

/**
 * Owner-facing copy that explains where things end up after a save: the site rebuild status
 * (SaveContentResponse.redeploy), the "drafts could not be decrypted" warning from GET /api/content,
 * and what drafts and hidden items mean (packages/content publicProjection). Pure, so it is unit tested.
 */

/* ---------- Drafts and hidden items ---------- */

/** Toggle hint for timeline frames (published=false). */
export const DRAFT_HINT = "ปิด = ร่าง: ไม่แสดงบนเว็บ และไม่อยู่ในไฟล์สาธารณะ (เก็บแบบเข้ารหัส)";
/** Toggle hint for projects, Utotech projects, and the email/phone "show on site" switches. */
export const HIDDEN_HINT = "ปิด = ซ่อน: ไม่แสดงบนเว็บ และไม่อยู่ในไฟล์สาธารณะ (เก็บแบบเข้ารหัส)";
/** Uploads are public even when only a draft uses them (the bucket is publicly readable). */
export const UPLOADS_PUBLIC = "แต่รูปและไฟล์ที่อัปโหลดทุกคนเปิดดูได้เสมอ";

/* ---------- Site rebuild after a save ---------- */

export type RedeployStatus = NonNullable<SaveContentResponse["redeploy"]>;
export type RedeployNotice = { tone: "ok" | "muted" | "warn"; text: string; detail?: string };

const REDEPLOY = new Set<string>(["sent", "queued", "failed", "off"]);

/** Read `redeploy` from a save response; anything unknown (an older API) counts as missing. */
export function readRedeploy(v: unknown): RedeployStatus | null {
  return typeof v === "string" && REDEPLOY.has(v) ? (v as RedeployStatus) : null;
}

/**
 * What to tell the owner about the SEO files / README rebuild after a save. The content itself is
 * saved in every case; this is only about the baked files (index.html snapshot, sitemap, llms.txt, README).
 * null = say nothing (an API that does not report it).
 */
export function redeployNotice(status: RedeployStatus | null | undefined): RedeployNotice | null {
  switch (status) {
    case "sent":
      return { tone: "ok", text: "สั่งอัปเดต SEO/README แล้ว (ประมาณ 2–5 นาที)" };
    case "queued":
      return { tone: "muted", text: "จะอัปเดต SEO/README รอบถัดไป" };
    case "failed":
      return {
        tone: "warn",
        text: "สั่งอัปเดต SEO/README ไม่สำเร็จ",
        detail: "เนื้อหาบันทึกแล้ว · จะลองใหม่ตอนบันทึกครั้งถัดไป หรือสั่งรัน Deploy และ README เองในแท็บ Actions ของ GitHub",
      };
    case "off":
      return { tone: "muted", text: "SEO/README อัปเดตรอบรายวัน (ยังไม่ได้ตั้ง DISPATCH_TOKEN)" };
    default:
      return null;
  }
}

/* ---------- GET /api/content warning ---------- */

/** The `warning` of a content response, or "" when there is none. */
export function readWarning(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Banner copy for a content warning. The API sends "drafts could not be decrypted; showing the
 * published version" when the private copy cannot be opened (api/src/app.ts DECRYPT_WARNING): the
 * editor then holds only the public version, and saving replaces the private copy.
 */
export function warningCopy(warning: string): { title: string; lines: string[] } {
  if (/decrypt/i.test(warning)) {
    return {
      title: "อ่านฉบับร่างและรายการที่ซ่อนไม่ได้",
      lines: [
        "กุญแจเข้ารหัสบนเซิร์ฟเวอร์เปลี่ยน (เช่น เปลี่ยนหรือไม่ได้ตั้ง SESSION_SECRET) " +
          "หน้านี้จึงมีแค่เวอร์ชันที่เผยแพร่อยู่ ไม่มีเฟรมร่าง รายการที่ซ่อน และอีเมล/เบอร์ที่ไม่แสดง",
        "ถ้ากดบันทึกตอนนี้ ของเหล่านั้นจะถูกแทนที่ (ฉบับเดิมยังอยู่ในประวัติแบบเข้ารหัส) · " +
          "จะกู้คืน ให้ตั้ง SESSION_SECRET ค่าเดิมกลับบนเซิร์ฟเวอร์ แล้วโหลดหน้านี้ใหม่",
      ],
    };
  }
  return { title: "เซิร์ฟเวอร์แจ้งเตือนเรื่องเนื้อหา", lines: [] };
}
