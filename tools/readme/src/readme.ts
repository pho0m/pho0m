/** HTML helpers for README.md: every card is a <picture>, every link an <a> that passed isSafeUrl. */

import { isSafeUrl } from "@pho0m/content";

/** Escape HTML special characters for attribute values and inline HTML text. */
export function html(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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

