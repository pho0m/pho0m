import { fit, measure, wrap } from "../font/fonts.ts";
import { cardFrame, glyph, text } from "./kit.ts";
import type { Theme } from "./theme.ts";
import { svgDocument } from "./xml.ts";

export const PANEL_W = 416;
/**
 * Transparent strip on the inner side of each panel (diary: right, docs: left). The README puts
 * the two images edge to edge with no whitespace between them (so they can never wrap onto two
 * lines), and these strips make the visible gap between the two frames.
 */
export const PANEL_GUTTER = 6;
const PAD = 24;

export type DiaryPanelData = {
  title: string;
  intro: string;
  entries: { month: string; title: string }[];
  footer: string;
};
export type DocsPanelData = {
  title: string;
  documents: { title: string; description: string }[];
  contact: { label: string; value: string }[];
};

type Built = { body: string; height: number; title: string };

function header(label: string, title: string, t: Theme): string {
  return (
    text(PAD, 38, label, { font: "led", size: 18, fill: t.accent, spacing: 1 }) +
    text(PAD, 66, fit(title, "px7", 21, PANEL_W - 2 * PAD), { font: "px7", size: 21, fill: t.text })
  );
}

function diaryBody(d: DiaryPanelData, t: Theme): Built {
  let s = header("CO-OP DIARY", d.title, t);
  let y = 92;
  for (const line of wrap(d.intro, "b4", 13, PANEL_W - 2 * PAD, 2)) {
    s += text(PAD, y, line, { font: "b4", size: 13, fill: t.muted });
    y += 18;
  }
  y += 8;
  const monthW = Math.max(44, ...d.entries.map((e) => measure(e.month, "led", 20, 1))) + 12;
  d.entries.forEach((e, i) => {
    s += `<rect x="${PAD}" y="${y}" width="${PANEL_W - 2 * PAD}" height="26" fill="${i % 2 ? t.bg : t.panel}" shape-rendering="crispEdges"/>`;
    s += text(PAD + 8, y + 19, e.month, { font: "led", size: 20, fill: t.led, spacing: 1 });
    s += text(PAD + 8 + monthW, y + 18, fit(e.title, "b4", 13, PANEL_W - 2 * PAD - monthW - 16), { font: "b4", size: 13, fill: t.text });
    y += 26;
  });
  y += 24;
  if (d.footer) s += text(PAD, y, fit(d.footer, "led", 17, PANEL_W - 2 * PAD, 1), { font: "led", size: 17, fill: t.muted, spacing: 1 });
  return { body: s, height: y + 20, title: `${d.title} — ${d.intro}` };
}

function docsBody(d: DocsPanelData, t: Theme): Built {
  let s = header("DOCUMENTS · CONTACT", d.title, t);
  let y = 84;
  for (const doc of d.documents) {
    s += glyph("doc", PAD, y + 4, 16, t.led);
    s += text(PAD + 26, y + 16, fit(doc.title, "b6", 14, PANEL_W - 2 * PAD - 26), { font: "b6", size: 14, fill: t.text });
    if (doc.description) s += text(PAD + 26, y + 34, fit(doc.description, "b4", 12, PANEL_W - 2 * PAD - 26), { font: "b4", size: 12, fill: t.muted });
    y += 46;
  }
  if (d.documents.length) {
    s += `<rect x="${PAD}" y="${y + 2}" width="${PANEL_W - 2 * PAD}" height="2" fill="${t.line}" shape-rendering="crispEdges"/>`;
    y += 14;
  }
  const labelW = Math.max(...d.contact.map((c) => measure(c.label, "led", 18, 1)), 40) + 14;
  for (const c of d.contact) {
    s += text(PAD, y + 18, c.label, { font: "led", size: 18, fill: t.muted, spacing: 1 });
    s += text(PAD + labelW, y + 18, fit(c.value, "b4", 14, PANEL_W - 2 * PAD - labelW), { font: "b4", size: 14, fill: t.text });
    y += 28;
  }
  return { body: s, height: y + 18, title: d.title };
}

/** The two side-by-side panels, built together so they share one size (PANEL_W + PANEL_GUTTER wide). */
export function panelCards(diary: DiaryPanelData, docs: DocsPanelData, t: Theme): { diary: string; docs: string } {
  const a = diaryBody(diary, t);
  const b = docsBody(docs, t);
  const H = Math.max(a.height, b.height);
  const wrapPanel = (built: Built, id: string, offset: number) => {
    const frame = cardFrame(PANEL_W, H, t, id, { x: 0.1, y: 0 });
    const body = frame.body + built.body;
    return svgDocument(PANEL_W + PANEL_GUTTER, H, built.title, offset ? `<g transform="translate(${offset} 0)">${body}</g>` : body, frame.defs);
  };
  return { diary: wrapPanel(a, "pd", 0), docs: wrapPanel(b, "pc", PANEL_GUTTER) };
}
