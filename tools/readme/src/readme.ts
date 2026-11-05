/** Markdown helpers and the WakaTime block that the waka-readme Action keeps updating. */

import { isSafeUrl } from "@pho0m/content";

export const WAKA_START = "<!--START_SECTION:waka-->";
export const WAKA_END = "<!--END_SECTION:waka-->";

/** The waka block (markers included) copied verbatim from the current README, or an empty one. */
export function extractWaka(readme: string | null): string {
  if (readme) {
    const start = readme.indexOf(WAKA_START);
    const end = start >= 0 ? readme.indexOf(WAKA_END, start + WAKA_START.length) : -1;
    if (start >= 0 && end >= 0) return readme.slice(start, end + WAKA_END.length);
  }
  return `${WAKA_START}\n${WAKA_END}`;
}

/** Escape HTML special characters for attribute values and inline HTML text. */
export function html(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Text for a markdown table cell: one line, no pipes, no raw HTML, no accidental markdown. */
export function cell(value: string): string {
  return html(value.replace(/\s+/g, " ").trim())
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/([*_`[\]])/g, "\\$1");
}

/** Markdown link text: escape the characters that would end or nest it. */
export function linkText(value: string): string {
  return html(value.replace(/\s+/g, " ").trim()).replace(/([\\[\]*_`|])/g, "\\$1");
}

/** URLs inside markdown links: spaces and parentheses must be encoded. */
export function linkUrl(url: string): string {
  return url.trim().replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/\|/g, "%7C");
}

export type Picture = { dark: string; light: string; alt: string; width?: string; height?: number };

/** <picture> that follows the viewer's GitHub theme. */
export function picture(p: Picture): string {
  const size = p.height !== undefined ? ` height="${p.height}"` : ` width="${p.width ?? "100%"}"`;
  return (
    `<picture><source media="(prefers-color-scheme: dark)" srcset="${html(p.dark)}">` +
    `<img src="${html(p.light)}" alt="${html(p.alt)}"${size}></picture>`
  );
}

/** Wrap `inner` in a link, or return it unlinked when `href` is empty or not a safe URL (isSafeUrl). */
export function linked(href: string | undefined, inner: string): string {
  return href && isSafeUrl(href) ? `<a href="${html(href)}">${inner}</a>` : inner;
}

/** Markdown link `[text](url)`, or the escaped text alone when `url` is empty or not a safe URL. */
export function mdLink(text: string, url: string): string {
  return url && isSafeUrl(url) ? `[${linkText(text)}](${linkUrl(url)})` : linkText(text);
}
