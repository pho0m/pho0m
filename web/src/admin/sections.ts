/** Admin navigation: one entry per editor screen, with the content path it edits. */

export const SECTIONS = [
  { id: "profile", th: "โปรไฟล์", en: "Profile", path: "profile" },
  { id: "timeline", th: "ฟิล์ม Timeline", en: "Film frames", path: "timeline" },
  { id: "utotech", th: "Utotech", en: "Company", path: "company" },
  { id: "projects", th: "โปรเจกต์", en: "Projects", path: "projects" },
  { id: "skills", th: "ทักษะ", en: "Skills", path: "skills" },
  { id: "diary", th: "บันทึกสหกิจ", en: "Co-op diary", path: "diary" },
  { id: "documents", th: "เอกสาร", en: "Documents", path: "documents" },
  { id: "media", th: "คลังไฟล์", en: "Media", path: null },
  { id: "history", th: "ประวัติ", en: "History", path: null },
  { id: "site", th: "ตั้งค่าเว็บ", en: "Site", path: "site" },
] as const;

export type SectionId = (typeof SECTIONS)[number]["id"];

export function isSectionId(v: string): v is SectionId {
  return SECTIONS.some((s) => s.id === v);
}

/** Which screen edits a content path like "company.projects.2.name". */
export function sectionForPath(path: string): SectionId | null {
  const head = path.split(".")[0] ?? "";
  const hit = SECTIONS.find((s) => s.path === head);
  return hit ? hit.id : null;
}

/** "company.projects.2.features.0.title.en" → "Utotech › projects › #3 › features › #1 › title › en". */
export function humanPath(path: string): string {
  const parts = path.split(".").filter((p) => p !== "");
  if (!parts.length) return "(ทั้งหมด)";
  const section = sectionForPath(path);
  const label = section ? SECTIONS.find((s) => s.id === section)!.th : parts[0]!;
  return [label, ...parts.slice(1).map((p) => (/^\d+$/.test(p) ? `#${Number(p) + 1}` : p))].join(" › ");
}
