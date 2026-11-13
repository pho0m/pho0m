import { isSafeUrl } from "@pho0m/content";
import { beforeAll, describe, expect, it } from "vitest";
import type { Output } from "../src/generate.ts";
import { FONT_KEYS, fontFile, type FontKey } from "../src/font/fonts.ts";
import { subsetSvgFonts, usedText } from "../src/font/subset.ts";
import { readWoff2Metrics } from "../src/font/woff2.ts";
import { linkHref } from "../src/model.ts";
import { linked } from "../src/readme.ts";
import { clone, run } from "./helpers.ts";

const unescape = (v: string) => v.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** Every link target in the README: HTML href="…" and markdown ](…). */
function linkTargets(readme: string): string[] {
  return [
    ...[...readme.matchAll(/\bhref="([^"]*)"/g)].map((m) => unescape(m[1]!)),
    ...[...readme.matchAll(/\]\(([^)\s]*)\)/g)].map((m) => m[1]!),
  ];
}

/** README text plus every card (fonts and images stripped), to search for leaked strings. */
function allText(o: Output): string {
  return [o.readme, ...[...o.files.values()].map((svg) => svg.replace(/data:[^")]+/g, ""))].join("\n");
}

describe("links (sec-4)", () => {
  let normal: Output;
  beforeAll(async () => {
    normal = await run();
  });

  it("only writes links that pass isSafeUrl", () => {
    const targets = linkTargets(normal.readme);
    // hero, profile buttons, GIF, film band and card, skills band, the two panels, footer links
    const site = clone().site.url;
    expect(targets.length).toBe((normal.readme.match(/<a /g) ?? []).length);
    expect(targets.length).toBeGreaterThanOrEqual(12);
    for (const url of targets) expect(isSafeUrl(url), url).toBe(true);
    for (const id of ["top", "film", "skills", "diary", "documents"]) expect(targets).toContain(`${site}/#${id}`);
    expect(targets).toContain("https://github.com/pho0m");
    expect(targets.filter((u) => u.startsWith("mailto:"))).toHaveLength(1);
  });

  it("drops unsafe URLs even when the content skipped validation, falling back to the site or to plain text", async () => {
    const c = clone();
    const site = c.site.url;
    c.profile.links.push({ kind: "website", label: "Evil", url: "javascript:alert(document.domain)" });
    c.profile.links.push({ kind: "website", label: "Evil 2", url: "JaVaScRiPt:alert(1)" });
    c.profile.links.push({ kind: "website", label: "Evil 3", url: "//evil.example/x" });
    c.profile.links.push({ kind: "website", label: "Evil 4", url: " data:text/html,<script>alert(5)</script>" });
    c.profile.links.push({ kind: "website", label: "CV", url: "/media/cv.pdf" });
    c.profile.links = c.profile.links.filter((l) => l.label !== c.company.shortName); // leave only the company's own link to it
    c.company.links = c.company.links.map((l) => (l.kind === "website" ? { ...l, url: "vbscript:msgbox(1)" } : l));
    c.diary.company.website = "javascript:alert(4)";
    // project links no longer reach the README at all, but must not leak through anything else either
    const companyProject = c.company.projects.find((p) => p.published)!;
    companyProject.url = "data:text/html,<script>alert(1)</script>";
    const own = c.projects.find((p) => p.published && p.group !== "client")!;
    own.repo = "javascript:alert(2)";
    own.url = "//evil.example/y";
    const client = c.projects.find((p) => p.published && p.group === "client")!;
    client.url = " javascript:alert(3)";
    const o = await run({ content: c });
    expect(allText(o)).not.toMatch(/javascript:|vbscript:|data:text|evil\.example|alert\(|msgbox/i);
    const targets = linkTargets(o.readme);
    for (const url of targets) expect(isSafeUrl(url), url).toBe(true);
    // a site-relative profile link becomes a link to the site
    expect(targets).toContain(`${site}/media/cv.pdf`);
    expect(o.readme).toContain('alt="CV"');
    // no button for the bad profile links, and no company button, footer link or "work" contact without a safe URL
    for (const label of ["Evil", "Evil 2", "Evil 3", "Evil 4"]) expect(o.readme, label).not.toContain(`alt="${label}"`);
    expect([...o.files.keys()].filter((name) => name.startsWith("btn-evil"))).toEqual([]);
    expect(o.files.has(`btn-${c.company.shortName.toLowerCase()}-dark.svg`)).toBe(false);
    expect(o.files.has("link-company-dark.svg")).toBe(false);
    expect(o.readme).not.toMatch(/Documents &amp; contact — [^"]*\bwork /);
    // the panels fall back to plain text (no diary website) and still link to their sections of the site
    expect(o.files.get("panel-diary-dark.svg")).not.toContain("JAVASCRIPT");
    expect(targets).toContain(`${site}/#diary`);
    expect(targets).toContain(`${site}/#documents`);
  });

  it("linkHref and linked() refuse unsafe targets", () => {
    const c = clone();
    expect(linkHref(c, "/media/x.pdf")).toBe(`${c.site.url}/media/x.pdf`);
    expect(linkHref(c, "https://github.com/pho0m")).toBe("https://github.com/pho0m");
    expect(linkHref(c, "mailto:a@b.co")).toBe("mailto:a@b.co");
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "//evil.example", "vbscript:x", ""]) expect(linkHref(c, bad), bad).toBe("");
    expect(linked("javascript:alert(1)", "<img>")).toBe("<img>");
    expect(linked("https://x.test/", "<img>")).toBe('<a href="https://x.test/"><img></a>');
    expect(linked("", "<img>")).toBe("<img>");
    expect(linked(undefined, "<img>")).toBe("<img>");
    expect(linked('https://x.test/?a="b"&c=<d>', "x")).toBe('<a href="https://x.test/?a=&quot;b&quot;&amp;c=&lt;d&gt;">x</a>');
  });
});

describe("public projection", () => {
  it("builds only from what may be published: drafts, hidden contact details and documents without a file stay out", async () => {
    const c = clone();
    c.profile.email = { value: "hidden-mail@example.com", visible: false };
    c.profile.phone = { value: "+66 81 234 5678", visible: false };
    const companyProject = c.company.projects.find((p) => p.published)!;
    companyProject.published = false;
    companyProject.name = "Hidden company project";
    const project = c.projects.find((p) => p.published)!;
    project.published = false;
    project.name = "Hidden draft project";
    const frame = c.timeline.find((f) => f.published)!;
    frame.published = false;
    frame.title = { th: "", en: "Hidden draft frame" };
    c.documents.push({ id: "draft-doc", title: { th: "", en: "Draft document" }, description: { th: "", en: "" }, url: "" });
    const o = await run({ content: c });
    const text = allText(o);
    for (const secret of ["hidden-mail@example.com", "234 5678", "234-5678", "+66812345678", "Hidden company project", "Hidden draft project", "Hidden draft frame", "Draft document"]) {
      expect(text, secret).not.toContain(secret);
    }
    expect(o.files.has("link-email-dark.svg")).toBe(false);
    expect(o.files.has("link-phone-dark.svg")).toBe(false);
  });
});

describe("embedded fonts (readme-5)", () => {
  let out: Output;
  beforeAll(async () => {
    out = await run();
  });

  const embedded = (svg: string) =>
    [...svg.matchAll(/font-family:"(\w+)";font-weight:(\d+);font-style:normal;src:url\(data:font\/woff2;base64,([A-Za-z0-9+/=]+)\)/g)].map((m) => ({
      family: m[1]!,
      weight: Number(m[2]),
      bytes: Buffer.from(m[3]!, "base64"),
    }));
  const keyOf = (family: string, weight: number): FontKey =>
    family === "PxLed" ? "led" : family === "PxDisplay" ? "px7" : weight === 600 ? "b6" : "b4";

  it("embeds each font cut down to exactly the glyphs that card draws", () => {
    let fonts = 0;
    for (const [name, svg] of out.files) {
      const used = usedText(svg);
      for (const f of embedded(svg)) {
        fonts++;
        const key = keyOf(f.family, f.weight);
        const whole = readWoff2Metrics(fontFile(key).bytes);
        const sub = readWoff2Metrics(f.bytes);
        expect(f.bytes.byteLength, `${name} ${key}`).toBeLessThan(fontFile(key).bytes.byteLength);
        const chars = used.get(key) ?? "";
        expect(chars, `${name} uses ${key}`).not.toBe("");
        for (const ch of chars) {
          const cp = ch.codePointAt(0)!;
          // every drawn character the font has is kept, with the same advance width
          expect(sub.advance(cp), `${name} ${key} ${JSON.stringify(ch)}`).toBe(whole.advance(cp));
        }
        // and characters the card never draws are gone
        const unused = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"].filter((ch) => !chars.includes(ch));
        for (const ch of unused) expect(sub.advance(ch.codePointAt(0)!), `${name} ${key} keeps ${ch}`).toBeUndefined();
      }
    }
    expect(fonts).toBeGreaterThan(20);
  });

  it("keeps the font bytes far below whole-file embedding", () => {
    let subset = 0;
    let whole = 0;
    for (const svg of out.files.values()) {
      for (const f of embedded(svg)) {
        subset += f.bytes.byteLength;
        whole += fontFile(keyOf(f.family, f.weight)).bytes.byteLength;
      }
    }
    expect(subset / whole).toBeLessThan(0.35);
  });

  it("reads characters from escaped text and leaves SVGs without fonts alone", async () => {
    const svg = `<svg><defs><style>@font-face{font-family:"PxLed";font-weight:400;font-style:normal;src:url(data:font/woff2;base64,${fontFile("led").base64}) format("woff2")}</style></defs><text class="f-led" font-size="10">A&amp;B &lt;&#67;&#x44;</text></svg>`;
    expect(usedText(svg).get("led")).toBe(" &<ABCD");
    const small = await subsetSvgFonts(svg);
    expect(small.length).toBeLessThan(svg.length / 2);
    expect(await subsetSvgFonts(svg)).toBe(small);
    const plain = `<svg><path d="M0 0h1"/></svg>`;
    expect(await subsetSvgFonts(plain)).toBe(plain);
    for (const key of FONT_KEYS) expect(small).not.toContain(fontFile(key).base64);
  });
});
