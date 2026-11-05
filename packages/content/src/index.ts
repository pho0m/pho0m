import { Content, type Frame, type Lang, type Localized } from "./schema.ts";

export * from "./schema.ts";
export * from "./sprites.ts";
export * from "./api.ts";
export * from "./public.ts";

export type ParseResult =
  | { ok: true; content: Content }
  | { ok: false; issues: { path: string; message: string }[] };

/** Validate unknown JSON against the content schema (defaults are filled in). */
export function parseContent(input: unknown): ParseResult {
  const r = Content.safeParse(input);
  if (r.success) return { ok: true, content: r.data };
  return {
    ok: false,
    issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  };
}

/** Pick a language with fallback to the other one. */
export function t(value: Localized | undefined, lang: Lang): string {
  if (!value) return "";
  const primary = value[lang];
  if (primary && primary.trim()) return primary;
  return lang === "th" ? value.en : value.th;
}

/** Published frames sorted oldest → newest (stable for equal dates). */
export function timelineFrames(content: Content, opts: { includeDrafts?: boolean } = {}): Frame[] {
  return content.timeline
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => opts.includeDrafts || f.published)
    .sort((a, b) => (a.f.date === b.f.date ? a.i - b.i : a.f.date < b.f.date ? -1 : 1))
    .map(({ f }) => f);
}

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2023-05" → "2023.05"; dateLabel wins when set. */
export function frameDateLabel(f: Pick<Frame, "date" | "dateLabel">): string {
  if (f.dateLabel.trim()) return f.dateLabel.trim();
  return f.date.replace("-", ".");
}

/** Film-camera date imprint, e.g. "'23 05" or "'21". */
export function frameStamp(f: Pick<Frame, "date">): string {
  const [y, m] = f.date.split("-");
  return m ? `'${y!.slice(2)} ${m}` : `'${y!.slice(2)}`;
}

/** "2023-05" → "May 2023" (English, for README/meta). */
export function frameDateLong(f: Pick<Frame, "date" | "dateLabel">): string {
  if (f.dateLabel.trim()) return f.dateLabel.trim();
  const [y, m] = f.date.split("-");
  return m ? `${MONTHS_EN[Number(m) - 1]} ${y}` : `${y}`;
}

/** Make site-relative media URLs absolute (needed by the README and by social cards). */
export function absoluteUrl(url: string, siteUrl: string): string {
  if (!url) return url;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  return siteUrl.replace(/\/+$/, "") + "/" + url.replace(/^\/+/, "");
}

export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "item"
  );
}

export const emptyLocalized = (): Localized => ({ th: "", en: "" });
