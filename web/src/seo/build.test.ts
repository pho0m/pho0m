import { describe, expect, it } from "vitest";
import { Content, seed } from "@pho0m/content";
import {
  AI_USER_AGENTS,
  buildHead,
  buildJsonLd,
  buildLlmsFull,
  buildLlmsTxt,
  buildRobots,
  buildSitemap,
  buildSnapshot,
  injectIntoHtml,
  jsonForScript,
  parsePrice,
} from "./build.ts";

const HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>old</title>
    <meta name="description" content="old" />
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;

describe("robots.txt", () => {
  const r = buildRobots(seed);
  it("allows every listed AI crawler and everyone else", () => {
    for (const ua of AI_USER_AGENTS) expect(r).toContain(`User-agent: ${ua}\n`);
    expect(r).toContain("User-agent: *\nAllow: /");
    expect(r).not.toMatch(/Disallow: \/\s*$/m);
  });
  it("keeps the admin out and points to the sitemap", () => {
    expect(r).toContain("Disallow: /admin");
    expect(r).toContain(`Sitemap: ${seed.site.url}/sitemap.xml`);
  });
});

describe("sitemap.xml", () => {
  it("lists the home page with hreflang alternates", () => {
    const s = buildSitemap(seed);
    expect(s).toContain(`<loc>${seed.site.url}/</loc>`);
    expect(s).toContain('hreflang="en"');
    expect(s).toContain('hreflang="x-default"');
    expect(s).toContain("<lastmod>2026-11-04</lastmod>");
  });
});

describe("JSON-LD", () => {
  const ld = buildJsonLd(seed) as { "@graph": Record<string, unknown>[] };
  const byType = (t: string) => ld["@graph"].find((n) => n["@type"] === t)!;
  it("describes the person, Utotech, services with prices and projects", () => {
    expect(byType("Person").name).toBe("Kiattiphoom Poonketkit");
    expect(byType("Person").worksFor).toEqual({ "@id": `${seed.site.url}/#utotech` });
    const org = byType("Organization");
    expect(org.name).toBe("Utotech Co., Ltd.");
    expect(org.taxID).toBe("0105565119323");
    const offers = org.makesOffer as { priceSpecification?: { minPrice: number } }[];
    expect(offers).toHaveLength(seed.company.services.length);
    expect(offers[0]!.priceSpecification?.minPrice).toBe(20000);
    const lists = ld["@graph"].filter((n) => n["@type"] === "ItemList");
    expect(lists).toHaveLength(2);
  });
  it("never leaks hidden contact details", () => {
    const json = JSON.stringify(ld);
    expect(json).not.toContain(seed.profile.phone.value.replace(/[^\d]/g, "").slice(-7) + '"'); // personal phone hidden
    expect(byType("Person").telephone).toBeUndefined();
  });
  it("is safe inside a script tag", () => {
    expect(jsonForScript({ a: "</script><script>alert(1)</script>" })).not.toContain("</script>");
  });
});

describe("head + snapshot", () => {
  it("head has title, description, canonical, OG, Twitter and JSON-LD", () => {
    const h = buildHead(seed);
    for (const s of ["<title>", 'name="description"', 'rel="canonical"', 'property="og:image"', 'name="twitter:card"', "application/ld+json", 'href="/llms.txt"'])
      expect(h).toContain(s);
  });
  it("snapshot contains real content in both languages and escapes HTML", () => {
    const evil = Content.parse({ ...seed, profile: { ...seed.profile, headline: { th: "", en: '<img src=x onerror="x">' } } });
    const s = buildSnapshot(evil);
    expect(s).toContain("&lt;img src=x");
    expect(s).not.toContain("<img src=x");
    const real = buildSnapshot(seed);
    expect(real).toContain("Utotech Co., Ltd.");
    expect(real).toContain('lang="th"');
    expect(real).toContain("SEYES");
    expect(real).toContain("Package from 20,000 THB");
  });
  it("injects into index.html, replacing old tags and filling #root", () => {
    const out = injectIntoHtml(HTML, seed);
    expect(out.match(/<title>/g)).toHaveLength(1);
    expect(out).not.toContain(">old<");
    expect(out).not.toContain('content="old"');
    expect(out).toMatch(/<div id="root"><!--seo-snapshot--><div class="seo-static">/);
    expect(out).toContain('<html lang="th"');
  });
  it("is idempotent: running twice gives the same page", () => {
    const once = injectIntoHtml(HTML, seed);
    expect(injectIntoHtml(once, seed)).toBe(once);
  });
  it("throws when the template is missing the root div", () => {
    expect(() => injectIntoHtml("<html><head></head><body></body></html>", seed)).toThrow();
  });
});

describe("llms.txt", () => {
  it("follows the llms.txt shape: H1, summary blockquote, link sections", () => {
    const s = buildLlmsTxt(seed);
    expect(s.startsWith("# Kiattiphoom Poonketkit (pho0m)\n\n> ")).toBe(true);
    expect(s).toContain("## Timeline");
    expect(s).toContain("## Utotech Co., Ltd.");
    expect(s).toContain(`(${seed.site.url}/llms-full.txt)`);
  });
  it("llms-full.txt includes every section, diary text and both languages", () => {
    const s = buildLlmsFull(seed);
    for (const h of ["## Profile", "## Timeline", "## Personal projects", "## Skills", "### Services and prices", "### Client projects"]) expect(s).toContain(h);
    expect(s).toContain(seed.diary.entries[0]!.body.en.slice(0, 40));
    expect(s).toContain(seed.diary.entries[0]!.body.th.slice(0, 20));
    expect(s).not.toMatch(/\n{3,}/);
  });
});

describe("parsePrice", () => {
  it("reads THB amounts", () => {
    expect(parsePrice("Package from 20,000 THB")).toBe(20000);
    expect(parsePrice("Start from 45,000")).toBe(45000);
    expect(parsePrice("Price upon request")).toBeNull();
  });
});

describe("sentences", async () => {
  const { sentences, pageDescription } = await import("./build.ts");
  it("never doubles punctuation", () => {
    expect(sentences("CEO, Utotech Co., Ltd.", "From intern")).toBe("CEO, Utotech Co., Ltd. From intern.");
    expect(pageDescription(seed)).not.toContain("..");
    expect(buildLlmsTxt(seed)).not.toContain("..");
  });
});
