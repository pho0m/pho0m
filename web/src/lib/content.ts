import { parseContent, type Content } from "@pho0m/content";

/**
 * Where the live content JSON lives (the public GCS object written by the admin API),
 * e.g. https://storage.googleapis.com/<bucket>/content/site.json. Unset → seed only.
 */
export const CONTENT_URL: string = (import.meta.env.VITE_CONTENT_URL as string | undefined) ?? "";

/** Base URL of the admin API (Cloud Run). Empty → same origin (/api, proxied in dev). */
export const API_URL: string = ((import.meta.env.VITE_API_URL as string | undefined) ?? "").replace(/\/+$/, "");


/**
 * id of the <script type="application/json"> the SEO post-step writes into the built
 * pages (dist/index.html, dist/en/index.html): the content it baked, with "<" escaped.
 */
export const EMBEDDED_CONTENT_ID = "pho0m-content";

/**
 * The content baked into the page by the build, validated. Null when the page has none
 * (dev server, tests) or it does not parse. Read it before React replaces #root.
 */
export function readEmbeddedContent(doc: Document | undefined = typeof document === "undefined" ? undefined : document): Content | null {
  const el = doc?.getElementById(EMBEDDED_CONTENT_ID);
  if (!el || (el.getAttribute("type") ?? "").toLowerCase() !== "application/json") return null;
  try {
    const parsed = parseContent(JSON.parse(el.textContent ?? ""));
    if (parsed.ok) return parsed.content;
    console.warn("The content baked into the page failed validation, using the built-in copy.", parsed.issues);
  } catch (err) {
    console.warn("Could not read the content baked into the page:", err);
  }
  return null;
}

/**
 * First content to render: what the build baked into the page. Only when a page has none
 * (dev server, tests, a broken build) is the seed loaded — as a separate chunk, so the
 * production bundle never carries it.
 */
export async function initialContent(doc?: Document): Promise<Content> {
  const embedded = readEmbeddedContent(doc);
  if (embedded) return embedded;
  const { seed } = await import("@pho0m/content/seed");
  return seed;
}

const stamp = (s: string): number | null => {
  const v = Date.parse(s);
  return Number.isNaN(v) ? null : v;
};

/**
 * True when `live` was saved after `current` (by updatedAt). Live content without a
 * readable updatedAt is never treated as newer; one with a date beats content without one.
 */
export function isNewerContent(live: Content, current: Content): boolean {
  const a = stamp(live.updatedAt);
  if (a === null) return false;
  const b = stamp(current.updatedAt);
  return b === null || a > b;
}

/** Fetch and validate the live content. Returns null when unset, unreachable or invalid. */
export async function fetchLiveContent(signal?: AbortSignal): Promise<Content | null> {
  if (!CONTENT_URL) return null;
  try {
    const sep = CONTENT_URL.includes("?") ? "&" : "?";
    const res = await fetch(`${CONTENT_URL}${sep}v=${Date.now()}`, { cache: "no-store", signal });
    if (!res.ok) return null;
    const parsed = parseContent(await res.json());
    if (!parsed.ok) {
      console.warn("Live content failed validation, using the built-in copy.", parsed.issues);
      return null;
    }
    return parsed.content;
  } catch (err) {
    if ((err as Error).name !== "AbortError") console.warn("Could not load live content:", err);
    return null;
  }
}
