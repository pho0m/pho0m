import { isSafeImageUrl, isSafeUrl } from "@pho0m/content";

/**
 * Inline URL checks for the editor, matching what the content schema accepts
 * (isSafeUrl / isSafeImageUrl from @pho0m/content; Site.url must be https://).
 * Pure, so it is unit tested.
 */

export const URL_ERROR = "ใช้ได้เฉพาะ https://, mailto:, tel:, ลิงก์ในเว็บ (/…) หรือ #ส่วนในหน้า";
export const IMAGE_URL_ERROR = "รูปใช้ได้เฉพาะ https:// หรือไฟล์ในเว็บ (/media/…)";
export const HTTPS_ERROR = "ต้องขึ้นต้นด้วย https://";
export const REQUIRED_URL = "ต้องกรอก URL";
export const SPACE_ERROR = "URL ต้องไม่มีช่องว่าง";

/** link: href targets · image: img src · https: the site's own address. */
export type UrlKind = "link" | "image" | "https";

const PREFIXES: Record<UrlKind, string[]> = {
  link: ["https://", "http://", "mailto:", "tel:"],
  image: ["https://", "http://"],
  https: ["https://"],
};

/** Whether the content schema accepts `value` for this kind of field. */
export function acceptedUrl(value: string, kind: UrlKind = "link"): boolean {
  if (kind === "image") return isSafeImageUrl(value);
  if (kind === "https") return isSafeUrl(value) && /^https:\/\/[^/]/.test(value);
  return isSafeUrl(value);
}

/** "pho0m@example.com" → "mailto:…", "github.com/pho0m" → "https://…" (null when no obvious fix). */
export function suggestUrl(value: string, kind: UrlKind = "link"): string | null {
  const v = value.trim();
  if (kind === "link" && /^[^\s@/:]+@[^\s@/:]+\.[^\s@/:]+$/.test(v)) return `mailto:${v}`;
  if (kind === "link" && /^\+?\d[\d -]{5,}\d$/.test(v)) return `tel:${v.replace(/[ -]/g, "")}`;
  if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(\/\S*)?$/i.test(v)) return `https://${v}`;
  if (kind === "https" && /^http:\/\/[^/\s]/i.test(v)) return `https://${v.slice(7)}`;
  return null;
}

/**
 * Thai error for a URL field, or undefined when it is fine. "" is fine unless required.
 * While the owner is still typing a scheme ("htt", "mailt") nothing is shown yet.
 */
export function urlError(value: string, o: { kind?: UrlKind; required?: boolean } = {}): string | undefined {
  const kind = o.kind ?? "link";
  if (value === "") return o.required ? REQUIRED_URL : undefined;
  if (acceptedUrl(value, kind)) return undefined;
  const lower = value.toLowerCase();
  if (PREFIXES[kind].some((p) => p.length >= lower.length && p.startsWith(lower))) return undefined;
  const base = kind === "image" ? IMAGE_URL_ERROR : kind === "https" ? HTTPS_ERROR : URL_ERROR;
  const fix = suggestUrl(value, kind);
  if (fix && acceptedUrl(fix, kind)) return `${base} · เช่น ${fix}`;
  if (/\s/.test(value)) return SPACE_ERROR;
  return base;
}
