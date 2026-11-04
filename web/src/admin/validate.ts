import { isSafeUrl, parseContent, slugify, type Content } from "@pho0m/content";
import type { Issue } from "./api.ts";
import { HTTPS_ERROR, IMAGE_URL_ERROR, URL_ERROR } from "./urls.ts";

/**
 * Local checks run before every save: auto ids, schema validation (parseContent)
 * and duplicate ids. Pure functions so they can be unit tested.
 */

/** "Empty id" means "derive it from the title when saving". */
export function autoId(source: string, fallback: string): string {
  const s = slugify(source);
  return s === "item" && slugify(fallback) !== "item" ? fallback : s;
}

function fillIds<T extends { id: string }>(items: T[], source: (item: T) => string, fallback: string): T[] {
  if (!items.some((i) => !i.id.trim())) return items;
  const used = new Set(items.map((i) => i.id.trim()).filter(Boolean));
  return items.map((item) => {
    if (item.id.trim()) return item;
    const base = autoId(source(item), fallback);
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`.slice(0, 80);
    used.add(id);
    return { ...item, id };
  });
}

/** Fill every empty `id` from its title (slugify), keeping ids unique inside each list. */
export function fillAutoIds(c: Content): Content {
  return {
    ...c,
    timeline: fillIds(c.timeline, (f) => f.title.en, "frame"),
    company: {
      ...c.company,
      services: fillIds(c.company.services, (s) => s.title.en, "service"),
      projects: fillIds(c.company.projects, (p) => p.name, "project"),
    },
    projects: fillIds(c.projects, (p) => p.name, "project"),
    skills: fillIds(c.skills, (g) => g.title.en, "skills"),
    diary: { ...c.diary, entries: fillIds(c.diary.entries, (e) => e.title.en, "entry") },
    documents: fillIds(c.documents, (d) => d.title.en, "document"),
  };
}

function dupes(prefix: string, items: { id: string }[]): Issue[] {
  const seen = new Map<string, number>();
  const out: Issue[] = [];
  items.forEach((item, i) => {
    const id = item.id.trim();
    if (!id) return;
    const first = seen.get(id);
    if (first === undefined) seen.set(id, i);
    else out.push({ path: `${prefix}.${i}.id`, message: `duplicate id "${id}" (same as #${first + 1})` });
  });
  return out;
}

export function duplicateIdIssues(c: Content): Issue[] {
  return [
    ...dupes("timeline", c.timeline),
    ...dupes("company.services", c.company.services),
    ...dupes("company.projects", c.company.projects),
    ...dupes("projects", c.projects),
    ...dupes("skills", c.skills),
    ...dupes("diary.entries", c.diary.entries),
    ...dupes("documents", c.documents),
  ];
}

/** The schema's message for a rejected link (packages/content schema.ts URL_MSG). */
export const UNSAFE_URL_MESSAGE = "use https://…, mailto:, tel:, a site path (/…) or #anchor";

/**
 * Links the schema stores as plain strings but the site still renders as links
 * (diary.sheetUrl, diary.slidesUrl): held to the same rule as every other URL field.
 */
export function extraUrlIssues(c: Content): Issue[] {
  const out: Issue[] = [];
  for (const key of ["sheetUrl", "slidesUrl"] as const) {
    const v = c.diary?.[key];
    if (typeof v === "string" && v !== "" && !isSafeUrl(v)) out.push({ path: `diary.${key}`, message: UNSAFE_URL_MESSAGE });
  }
  return out;
}

function uniqueIssues(issues: Issue[]): Issue[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const k = `${i.path}\n${i.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export type DraftCheck = { ok: true; content: Content } | { ok: false; issues: Issue[] };

export function validateDraft(draft: Content): DraftCheck {
  const filled = fillAutoIds(draft);
  const parsed = parseContent(filled);
  const checked = parsed.ok ? parsed.content : filled;
  const extra = [...duplicateIdIssues(checked), ...extraUrlIssues(checked)];
  if (!parsed.ok) return { ok: false, issues: uniqueIssues([...parsed.issues, ...extra]) };
  if (extra.length) return { ok: false, issues: extra };
  return { ok: true, content: parsed.content };
}

/** Thai explanation for the common zod messages; the original stays visible next to it. */
export function thaiMessage(message: string): string {
  const m = message.toLowerCase();
  if (m === "required") return "ต้องกรอก";
  if (m.includes("use yyyy or yyyy-mm")) return "วันที่ต้องเป็น YYYY หรือ YYYY-MM เช่น 2023 หรือ 2023-05";
  if (m.includes("lowercase letters, numbers and dashes")) return "id ใช้ได้เฉพาะ a-z, 0-9 และ - (ขึ้นต้นด้วยตัวอักษรหรือตัวเลข)";
  if (m.startsWith("duplicate id")) return "id ซ้ำกับรายการอื่นในหมวดเดียวกัน";
  if (m.includes("mailto:") && m.includes("#anchor")) return URL_ERROR;
  if (m.includes("site path (/media")) return IMAGE_URL_ERROR;
  if (m === "use https://…" || m === "use https://...") return HTTPS_ERROR;
  if (/at least 1 character/.test(m) || /too_small/.test(m)) return "ห้ามเว้นว่าง";
  if (/at most \d+ character/.test(m)) return "ยาวเกินไป";
  if (m.includes("expected number")) return "ต้องเป็นตัวเลข";
  if (m.includes("greater than or equal") || m.includes("less than or equal")) return "ตัวเลขอยู่นอกช่วงที่กำหนด";
  if (m.includes("invalid enum value")) return "ค่าที่เลือกไม่ถูกต้อง";
  if (m.includes("expected integer")) return "ต้องเป็นจำนวนเต็ม";
  return "ข้อมูลไม่ถูกต้อง";
}
