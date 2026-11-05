import { randomBytes } from "node:crypto";
import { MEDIA_PREFIX, slugify } from "@pho0m/content";

/** Upload rules: type comes from the file's magic bytes, never from the declared MIME type or name. */

export type Sniffed = { contentType: string; ext: string };

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let s = "";
  for (let i = start; i < end && i < bytes.length; i++) s += String.fromCharCode(bytes[i] ?? 0);
  return s;
}

function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  if (bytes.length < sig.length) return false;
  return sig.every((b, i) => bytes[i] === b);
}

export function sniffType(bytes: Uint8Array): Sniffed | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { contentType: "image/jpeg", ext: "jpg" };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { contentType: "image/png", ext: "png" };
  if (ascii(bytes, 0, 4) === "GIF8") return { contentType: "image/gif", ext: "gif" };
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return { contentType: "image/webp", ext: "webp" };
  if (ascii(bytes, 4, 8) === "ftyp") {
    const brand = ascii(bytes, 8, 12);
    if (brand === "avif" || brand === "avis") return { contentType: "image/avif", ext: "avif" };
  }
  if (ascii(bytes, 0, 5) === "%PDF-") return { contentType: "application/pdf", ext: "pdf" };
  return null;
}

export const FOLDER_RE = /^[a-z0-9-]{1,40}$/;
/** Paths the DELETE route may touch. */
export const MEDIA_PATH_RE = /^media\/[a-z0-9/_.-]+$/;

export function isDeletableMediaPath(p: string): boolean {
  if (!MEDIA_PATH_RE.test(p)) return false;
  if (p.includes("..") || p.includes("//") || p.endsWith("/")) return false;
  return true;
}

/** "My Photo (final).PNG" → "my-photo-final". */
export function baseSlug(filename: string): string {
  const name = filename.split(/[\\/]/).pop() ?? "";
  const stem = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;
  // slugify() keeps a-z0-9 only (Thai-only names become "item") and caps the length at 60.
  return slugify(stem).replace(/-+$/, "") || "item";
}

/** media/<yyyy>/<mm>/<folder?>/<slug>-<8 hex>.<ext> (UTC date). */
export function mediaPath(opts: {
  filename: string;
  ext: string;
  folder?: string | null;
  now: Date;
  random?: () => string;
}): string {
  const yyyy = String(opts.now.getUTCFullYear());
  const mm = String(opts.now.getUTCMonth() + 1).padStart(2, "0");
  const rand = (opts.random ?? (() => randomBytes(4).toString("hex")))();
  const folder = opts.folder ? `${opts.folder}/` : "";
  return `${MEDIA_PREFIX}${yyyy}/${mm}/${folder}${baseSlug(opts.filename)}-${rand}.${opts.ext}`;
}
