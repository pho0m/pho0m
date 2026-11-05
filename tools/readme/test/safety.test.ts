import { isSafeUrl } from "@pho0m/content";
import { beforeAll, describe, expect, it } from "vitest";
import type { Output } from "../src/generate.ts";
import { FONT_KEYS, fontFile, type FontKey } from "../src/font/fonts.ts";
import { subsetSvgFonts, usedText } from "../src/font/subset.ts";
import { readWoff2Metrics } from "../src/font/woff2.ts";
import { linkHref } from "../src/model.ts";
import { linked, mdLink } from "../src/readme.ts";
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
    expect(targets.length).toBeGreaterThan(40);
    for (const url of targets) expect(isSafeUrl(url), url).toBe(true);
  });

  it("drops unsafe URLs even when the content skipped validation, falling back to the site or to plain text", async () => {
    const c = clone();
    const site = c.site.url;
    c.profile.links.push({ kind: "website", label: "Evil", url: "javascript:alert(document.domain)" });
    c.profile.links.push({ kind: "website", label: "Evil 2", url: "JaVaScRiPt:alert(1)" });
    const companyProject = c.company.projects.find((p) => p.published)!;
    companyProject.url = "data:text/html,<script>alert(1)</script>";
    c.company.links = c.company.links.map((l) => (l.kind === "website" ? { ...l, url: "vbscript:msgbox(1)" } : l));
    const own = c.projects.find((p) => p.published && p.group !== "client")!;
    own.repo = "javascript:alert(2)";
    own.url = "//evil.example/x";
    const client = c.projects.find((p) => p.published && p.group === "client")!;
    client.url = " javascript:alert(3)";
    c.diary.company.website = "javascript:alert(4)";
    const o = await run({ content: c });
    expect(allText(o)).not.toMatch(/javascript:|vbscript:|data:text|evil\.example|alert\(/i);
    for (const url of linkTargets(o.readme)) expect(isSafeUrl(url), url).toBe(true);
    // the rows still link to their section of the site
    expect(o.readme).toContain(`**[${companyProject.name}](${site}/#utotech)**`);
    expect(o.readme).toContain(`**[${own.name}](${site}/#projects)**`);
    expect(o.readme).toContain(`**[${client.name}](${site}/#projects)**`);
    // no button for the bad profile links, and no company button or footer link without a safe URL
    expect(o.readme).not.toContain('alt="Evil"');
    expect(o.files.has("btn-evil-dark.svg")).toBe(false);
    expect(o.files.has("link-company-dark.svg")).toBe(false);
  });

  it("linkHref, linked() and mdLink() refuse unsafe targets", () => {
    const c = clone();
    expect(linkHref(c, "/media/x.pdf")).toBe(`${c.site.url}/media/x.pdf`);
    expect(linkHref(c, "https://github.com/pho0m")).toBe("https://github.com/pho0m");
    expect(linkHref(c, "mailto:a@b.co")).toBe("mailto:a@b.co");
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "//evil.example", "vbscript:x", ""]) expect(linkHref(c, bad), bad).toBe("");
    expect(linked("javascript:alert(1)", "<img>")).toBe("<img>");
    expect(linked("https://x.test/", "<img>")).toBe('<a href="https://x.test/"><img></a>');
    expect(mdLink("Name [1]", "javascript:alert(1)")).toBe("Name \\[1\\]");
    expect(mdLink("Name", "https://x.test/a b")).toBe("Name");
    expect(mdLink("Name", "https://x.test/a(b)")).toBe("[Name](https://x.test/a%28b%29)");
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
