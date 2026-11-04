import { fit, measure, sentences, sentencesThatFit, wrap } from "../font/fonts.ts";
import type { Stat } from "../model.ts";
import { CARD_W, cardFrame, pxBox, pxRectPath, text, triangle } from "./kit.ts";
import { FILM, type Theme } from "./theme.ts";
import { esc, n, svgDocument } from "./xml.ts";

/** Avatar ready to embed: a dithered print PNG, a raw image with a duotone filter, or none. */
export type AvatarImage = { kind: "print" | "raw"; uri: string } | null;

export type HeroData = {
  name: string;
  handle: string;
  location: string;
  role: string;
  headline: string;
  bio: string;
  stats: Stat[];
  avatar: AvatarImage;
  avatarInitial: string;
};

const DEV_STEPS = ["DEV", "STOP", "FIX", "DRY"];

/** DEV ▸ STOP ▸ FIX ▸ DRY developing timer with the last step lit. Returns markup and width. */
export function devTimer(x: number, y: number, t: Theme, lit = DEV_STEPS.length - 1): { svg: string; width: number } {
  let cx = x;
  let svg = "";
  DEV_STEPS.forEach((step, i) => {
    const w = Math.ceil(measure(step, "led", 17, 1)) + 14;
    const on = i === lit;
    svg += pxBox(cx, y, w, 22, on ? { fill: t.accent, step: 2 } : { fill: t.bg, stroke: t.line2, border: 1, step: 2 });
    svg += text(cx + w / 2, y + 16, step, { font: "led", size: 17, fill: on ? t.onAccent : t.muted, anchor: "middle", spacing: 1 });
    cx += w;
    if (i < DEV_STEPS.length - 1) {
      svg += triangle(cx + 5, y + 11, 7, i < lit ? t.accent : t.line2);
      cx += 16;
    }
  });
  return { svg, width: cx - x };
}

function avatarPrint(d: HeroData, x: number, y: number, t: Theme): string {
  const pw = 196;
  const ph = 238;
  const img = 176;
  let s = "";
  // drop shadow, paper, tape
  s += `<path d="${pxRectPath(x + 6, y + 7, pw, ph, 3)}" fill="${t.shadow}" fill-opacity="${n(t.shadowOpacity)}"/>`;
  s += pxBox(x, y, pw, ph, { fill: FILM.paper, step: 3 });
  const ix = x + 10;
  const iy = y + 10;
  if (d.avatar?.kind === "print") {
    s += `<image x="${ix}" y="${iy}" width="${img}" height="${img}" href="${esc(d.avatar.uri)}" image-rendering="optimizeSpeed" style="image-rendering:pixelated" preserveAspectRatio="none"/>`;
  } else if (d.avatar?.kind === "raw") {
    s += `<image x="${ix}" y="${iy}" width="${img}" height="${img}" href="${esc(d.avatar.uri)}" preserveAspectRatio="xMidYMid slice" filter="url(#duotone)"/>`;
  } else {
    s += `<rect x="${ix}" y="${iy}" width="${img}" height="${img}" fill="${FILM.ink}"/>`;
    s += text(ix + img / 2, iy + img / 2 + 34, d.avatarInitial, { font: "px7", size: 96, fill: FILM.paper, anchor: "middle" });
  }
  s += `<rect x="${ix}" y="${iy}" width="${img}" height="${img}" fill="none" stroke="${FILM.ink}" stroke-opacity="0.35"/>`;
  s += text(ix, y + ph - 18, fit(`@${d.handle}`, "led", 22, 100), { font: "led", size: 22, fill: FILM.ink });
  if (d.location) {
    s += text(ix + img, y + ph - 18, fit(d.location.toUpperCase(), "led", 17, 70, 1), {
      font: "led", size: 17, fill: FILM.ink, anchor: "end", spacing: 1, opacity: 0.7,
    });
  }
  s += `<rect x="${x + pw / 2 - 32}" y="${y - 8}" width="64" height="18" fill="${t.accent}" fill-opacity="0.55" shape-rendering="crispEdges"/>`;
  return s;
}

function statChips(stats: Stat[], x: number, y: number, maxW: number, t: Theme): string {
  let cx = x;
  let s = "";
  for (const st of stats) {
    const label = st.label.toUpperCase();
    const vw = measure(st.value, "led", 30);
    const lw = measure(label, "led", 16, 1);
    const w = Math.ceil(12 + vw + 8 + lw + 12);
    if (cx + w > x + maxW) break;
    s += pxBox(cx, y, w, 38, { fill: t.panel, stroke: t.line, border: 2, step: 3 });
    s += text(cx + 12, y + 28, st.value, { font: "led", size: 30, fill: t.led });
    s += text(cx + 12 + vw + 8, y + 26, label, { font: "led", size: 16, fill: t.muted, spacing: 1 });
    cx += w + 8;
  }
  return s;
}

const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}+#]+/gu) ?? [];

/** Bio without sentences that only repeat the headline (most of their words already appear there). */
export function bioWithoutEcho(bio: string, headline: string): string {
  const head = new Set(words(headline));
  return sentences(bio)
    .filter((s) => {
      const w = words(s);
      return !w.length || w.filter((x) => head.has(x)).length / w.length < 0.7;
    })
    .join(" ");
}

export function heroCard(d: HeroData, t: Theme): string {
  let body = avatarPrint(d, 34, 34, t);

  const x = 266;
  const maxW = CARD_W - x - 34;
  body += devTimer(x, 30, t).svg;

  let nameSize = 46;
  while (nameSize > 26 && measure(d.name, "px7", nameSize) > maxW) nameSize -= 2;
  body += text(x - 2, 104, fit(d.name, "px7", nameSize, maxW), { font: "px7", size: nameSize, fill: t.text });
  body += text(x, 136, fit(d.role, "b6", 19, maxW), { font: "b6", size: 19, fill: t.accent });

  let y = 170;
  const headline = wrap(d.headline, "b4", 20, maxW, 2);
  for (const line of headline) {
    body += text(x, y, line, { font: "b4", size: 20, fill: t.text });
    y += 25;
  }
  const bioText = bioWithoutEcho(d.bio, d.headline);
  const bio = bioText ? wrap(sentencesThatFit(bioText, "b4", 14, maxW, 2), "b4", 14, maxW, 2) : [];
  y += 1;
  for (const line of bio) {
    body += text(x, y, line, { font: "b4", size: 14, fill: t.muted });
    y += 19;
  }
  const chipsY = Math.max(236, y + 6);
  body += statChips(d.stats, x, chipsY, maxW, t);
  const H = Math.max(310, chipsY + 38 + 28);
  const frame = cardFrame(CARD_W, H, t, "hero", { x: 0.1, y: 0.05 });
  body = frame.body + body;

  const defs =
    frame.defs +
    (d.avatar?.kind === "raw"
      ? `<filter id="duotone" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncR type="discrete" tableValues="0.169 0.169 0.937 0.937"/><feFuncG type="discrete" tableValues="0.114 0.114 0.906 0.906"/><feFuncB type="discrete" tableValues="0.09 0.09 0.847 0.847"/></feComponentTransfer></filter>`
      : "");
  return svgDocument(CARD_W, H, `${d.name} — ${d.role}`, body, defs);
}
