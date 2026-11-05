import type { ImageRef, Lang, Link } from "@pho0m/content";

/**
 * width/height attributes for an <img> when the content records the image's size, so
 * the browser reserves its box before it loads. Images without a size are put in a
 * fixed-ratio box instead (the .imgbox class, or an aspect-ratio style).
 */
export function imgSize(image: Pick<ImageRef, "width" | "height">): { width?: number; height?: number } {
  return image.width && image.height ? { width: image.width, height: image.height } : {};
}

/** CSS aspect ratio of an image whose size the content records, else `fallback`. */
export function imgRatio(image: Pick<ImageRef, "width" | "height">, fallback: string): string {
  return image.width && image.height ? `${image.width} / ${image.height}` : fallback;
}

/** Split a body text into paragraphs (blank lines or single newlines). */
export function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n|\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * Two-letter pixel monogram for a skill chip: initials of the first two words
 * ("Node.js" → "NJ", "Google Cloud" → "GC"), the capitals of a camel-cased word
 * ("TypeScript" → "TS"), else the first two letters ("React" → "Re").
 * A qualifier in brackets is not part of the name, and brackets or other punctuation
 * never show: "Figma (advanced)" → "Fi", the same as "Figma" ("C#" keeps its "#").
 */
export function monogram(name: string): string {
  const wordsOf = (s: string) =>
    s
      .split(/[\s./_-]+/)
      .map((w) => w.replace(/[^\p{L}\p{M}\p{N}#+]/gu, ""))
      .filter((w) => /[\p{L}\p{N}]/u.test(w));
  const bare = wordsOf(name.replace(/\([^)]*\)?|\[[^\]]*\]?/g, " "));
  const words = bare.length ? bare : wordsOf(name);
  const initial = (w: string) => w.match(/[\p{L}\p{N}]/u)![0];
  if (words.length >= 2) return (initial(words[0]!) + initial(words[1]!)).toUpperCase();
  const w = words[0] ?? "";
  const caps = w.match(/\p{Lu}/gu) ?? [];
  if (caps.length >= 2) return caps[0]! + caps[1]!;
  const chars = [...w];
  if (chars.length === 1) return chars[0]!.toUpperCase();
  return (chars[0] ?? "?").toUpperCase() + (chars[1] ?? "").toLowerCase();
}

/** Stable small hash for picking a badge tint. */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Darkroom-friendly badge tints (all readable with paper text). */
export const BADGE_TINTS = ["#b8261a", "#7a2c22", "#8a3a14", "#5c2a3a", "#6b3f1f", "#3f2a52", "#244a3c", "#2f3f5c"] as const;
export const badgeTint = (name: string): string => BADGE_TINTS[hashString(name) % BADGE_TINTS.length]!;

/** Short LED code for a link kind. */
export function linkCode(kind: Link["kind"]): string {
  switch (kind) {
    case "github":
      return "GH";
    case "facebook":
      return "FB";
    case "instagram":
      return "IG";
    case "linkedin":
      return "IN";
    case "youtube":
      return "YT";
    case "tiktok":
      return "TT";
    case "line":
      return "LN";
    case "email":
      return "@";
    case "phone":
      return "TEL";
    case "document":
      return "DOC";
    case "demo":
      return "DEMO";
    case "x":
      return "X";
    case "website":
      return "WWW";
    default:
      return "LINK";
  }
}

/** Visible label for a link (falls back to the host name). */
export function linkLabel(link: Link): string {
  if (link.label.trim()) return link.label.trim();
  try {
    if (/^mailto:/i.test(link.url)) return link.url.replace(/^mailto:/i, "");
    if (/^tel:/i.test(link.url)) return link.url.replace(/^tel:/i, "");
    return new URL(link.url).host.replace(/^www\./, "");
  } catch {
    return link.url;
  }
}

/** External links open in a new tab. */
export function isExternal(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

export function telHref(phone: string): string {
  return "tel:" + phone.replace(/[^\d+]/g, "");
}

/** Host name for display ("https://www.madebytwist.com/" → "madebytwist.com"). */
export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export const PROJECT_GROUP_LABEL: Record<string, { th: string; en: string }> = {
  utotech: { th: "Utotech", en: "Utotech" },
  client: { th: "งานลูกค้า", en: "Client work" },
  personal: { th: "ส่วนตัว", en: "Personal" },
  teaching: { th: "งานสอน", en: "Teaching" },
  school: { th: "สมัยเรียน", en: "School" },
  coop: { th: "สหกิจ", en: "Co-op" },
};

/** Label for a project group; an unknown (future) group falls back to its id, tidied up ("open-source" → "Open source"). */
export function groupLabel(group: string, lang: Lang): string {
  const l = Object.hasOwn(PROJECT_GROUP_LABEL, group) ? PROJECT_GROUP_LABEL[group] : undefined;
  if (l) return l[lang];
  const words = group.replace(/[-_]+/g, " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : "—";
}

/**
 * Groups to offer as filters: the known groups in their contract order, then any
 * other group found in the data (so a group added later never breaks the page).
 */
export function projectGroups(known: readonly string[], present: readonly string[]): string[] {
  const have = new Set(present);
  const extra = [...have].filter((g) => !known.includes(g));
  return [...known.filter((g) => have.has(g)), ...extra];
}
