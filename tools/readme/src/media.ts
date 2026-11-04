import { readFile } from "node:fs/promises";
import { join, normalize, sep } from "node:path";
import { sniffMime } from "./image/print.ts";

/**
 * Loads image bytes for ImageRef URLs. Site-relative URLs (and absolute ones on the site's
 * own origin) are read from web/public; other http(s) URLs are fetched. Images embedded
 * inside the SVGs must be inlined because GitHub shows SVGs through <img>, which blocks
 * external requests.
 */
export type Media = { bytes: Uint8Array; mime: string };
export type MediaLoader = (url: string) => Promise<Media | null>;

const MAX_BYTES = 8 * 1024 * 1024;

export function createMediaLoader(opts: {
  publicDir: string;
  siteUrl: string;
  fetch?: typeof fetch;
  warn?: (message: string) => void;
}): MediaLoader {
  const cache = new Map<string, Promise<Media | null>>();
  const warn = opts.warn ?? ((m: string) => console.warn(m));
  const doFetch = opts.fetch ?? globalThis.fetch;
  let siteOrigin = "";
  try {
    siteOrigin = new URL(opts.siteUrl).origin;
  } catch {
    siteOrigin = "";
  }

  const readLocal = async (pathname: string): Promise<Media | null> => {
    const rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, "");
    const file = join(opts.publicDir, rel);
    if (!file.startsWith(normalize(opts.publicDir) + sep)) return null;
    try {
      const bytes = new Uint8Array(await readFile(file));
      return { bytes, mime: sniffMime(bytes) ?? "application/octet-stream" };
    } catch {
      return null;
    }
  };

  const load = async (url: string): Promise<Media | null> => {
    if (!url) return null;
    if (url.startsWith("data:")) {
      const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(url);
      if (!m) return null;
      const bytes = m[2] ? Buffer.from(m[3]!, "base64") : Buffer.from(decodeURIComponent(m[3]!));
      return { bytes: new Uint8Array(bytes), mime: m[1]! };
    }
    if (url.startsWith("/")) {
      const local = await readLocal(url.split(/[?#]/)[0]!);
      if (!local) warn(`[readme] image not found in web/public: ${url}`);
      return local;
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      warn(`[readme] not a valid image URL: ${url}`);
      return null;
    }
    if (parsed.origin === siteOrigin) {
      const local = await readLocal(parsed.pathname);
      if (local) return local;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    try {
      const res = await doFetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength > MAX_BYTES) throw new Error("file too large");
      return { bytes, mime: sniffMime(bytes) ?? res.headers.get("content-type") ?? "application/octet-stream" };
    } catch (err) {
      warn(`[readme] could not fetch ${url}: ${(err as Error).message}`);
      return null;
    }
  };

  return (url) => {
    let hit = cache.get(url);
    if (!hit) {
      hit = load(url);
      cache.set(url, hit);
    }
    return hit;
  };
}
