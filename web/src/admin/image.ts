import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES } from "@pho0m/content";

/** Pure helpers for client-side upload checks and image resizing maths. */

export const MAX_IMAGE_EDGE = 2000;
/** JPEG quality for re-encoded photos. JPEG (not WebP) so every consumer can decode uploads:
 * the README generator, link previews and older browsers. Images with transparency become PNG. */
export const JPEG_QUALITY = 0.86;
/** Raw images above this are refused before decoding (they would freeze the tab). */
export const MAX_RAW_IMAGE_BYTES = 60 * 1024 * 1024;

export type AllowedType = (typeof ALLOWED_UPLOAD_TYPES)[number];

/** Scale (w, h) down so the longest edge is at most `max`. Never scales up. */
export function fitWithin(
  width: number,
  height: number,
  max = MAX_IMAGE_EDGE,
): { width: number; height: number; resized: boolean } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0, resized: false };
  if (width <= max && height <= max) return { width, height, resized: false };
  const scale = max / Math.max(width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    resized: true,
  };
}

const EXT_TYPES: Record<string, AllowedType> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  pdf: "application/pdf",
};

/** MIME type of a file, falling back to its extension when the browser leaves `type` empty. */
export function guessType(file: { name: string; type: string }): string {
  if (file.type) return file.type.toLowerCase();
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  return EXT_TYPES[ext] ?? "";
}

export function isAllowedType(type: string): type is AllowedType {
  return (ALLOWED_UPLOAD_TYPES as readonly string[]).includes(type);
}

/** JPEG/PNG/WebP/AVIF go through the canvas (resize, then JPEG — or PNG when transparent). GIF (animation) and PDF are sent as-is. */
export function canReencode(type: string): boolean {
  return type === "image/jpeg" || type === "image/png" || type === "image/webp" || type === "image/avif";
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export type UploadCheck = { ok: true; type: AllowedType } | { ok: false; message: string };

/** Client-side check before any processing. Mirrors the API's 413/415 rules. */
export function checkUpload(file: { name: string; size: number; type: string }): UploadCheck {
  const type = guessType(file);
  if (!isAllowedType(type)) {
    return {
      ok: false,
      message: `ไม่รองรับไฟล์ "${file.name}" — ใช้ได้เฉพาะ JPG, PNG, WebP, GIF, AVIF หรือ PDF`,
    };
  }
  const limit = canReencode(type) ? MAX_RAW_IMAGE_BYTES : MAX_UPLOAD_BYTES;
  if (file.size > limit) {
    return {
      ok: false,
      message: `ไฟล์ "${file.name}" ใหญ่เกินไป (${formatBytes(file.size)}) — สูงสุด ${formatBytes(limit)}`,
    };
  }
  if (file.size === 0) return { ok: false, message: `ไฟล์ "${file.name}" ว่างเปล่า` };
  return { ok: true, type };
}

/** "My Photo.JPG" + "webp" → "My Photo.webp". */
export function renameExt(name: string, ext: string): string {
  const base = name.replace(/\.[^./\\]+$/, "") || "image";
  return `${base}.${ext}`;
}

/** Last path segment of a storage path or URL, for display. */
export function fileNameOf(pathOrUrl: string): string {
  const clean = pathOrUrl.split(/[?#]/)[0] ?? "";
  return decodeURIComponent(clean.split("/").filter(Boolean).pop() ?? clean);
}

export function isPdfUrl(url: string): boolean {
  return /\.pdf($|[?#])/i.test(url);
}
