import { parseContent, seed, type Content } from "@pho0m/content";

/**
 * Where the live content JSON lives (the public GCS object written by the admin API),
 * e.g. https://storage.googleapis.com/<bucket>/content/site.json. Unset → seed only.
 */
export const CONTENT_URL: string = (import.meta.env.VITE_CONTENT_URL as string | undefined) ?? "";

/** Base URL of the admin API (Cloud Run). Empty → same origin (/api, proxied in dev). */
export const API_URL: string = ((import.meta.env.VITE_API_URL as string | undefined) ?? "").replace(/\/+$/, "");

export { seed };

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
