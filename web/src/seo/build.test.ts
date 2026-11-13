import { afterEach, describe, expect, it, vi } from "vitest";
import { Content, isSafeImageUrl, isSafeUrl, parseContent, publicProjection, type ContentInput } from "@pho0m/content";
import { seed } from "@pho0m/content/seed";
import {
  AI_USER_AGENTS,
  awardsOf,
  buildHead,
  buildJsonLd,
  buildLlmsFull,
  buildLlmsTxt,
  buildRobots,
  buildSiteFiles,
  buildSitemap,
  buildSnapshot,
  CONTENT_SCRIPT_ID,
  diaryRange,
  esc,
  honorsIn,
  injectIntoHtml,
  jsonForScript,
  NO_FLASH_CSS,
  NO_FLASH_SCRIPT,
  pageTitle,
  parsePrice,
  projectGroups,
} from "./build.ts";

/** Seed with overrides, validated like live content. */
const withContent = (patch: (c: ContentInput) => void): Content => {
  const c = structuredClone(seed) as ContentInput;
  patch(c);
  return Content.parse(c);
};

/** A fixed project set covering every group, so tests do not depend on the seed's current list. */
const PROJECTS: ContentInput["projects"] = [
  { id: "eyes", name: "EyesApp", group: "utotech", description: { th: "แอปบ้าน", en: "Home app" }, image: { url: "/img/eyes.png" } },
  { id: "nda", name: "Clinic Dashboard", group: "client", description: { th: "แดชบอร์ดคลินิก", en: "A clinic dashboard" }, image: { url: "/img/secret.png" }, tags: ["Dashboard"] },
  { id: "bot", name: "Bot Kit", group: "personal", description: { th: "", en: "A bot" }, repo: "https://github.com/example/bot", year: "2022" },
  { id: "draft", name: "Hidden Draft", group: "client", description: { th: "", en: "Not yet" }, published: false },
  { id: "course", name: "Course Kit", group: "teaching", description: { th: "", en: "Slides" } },
];

type Node = Record<string, unknown>;
/** Every {"@id": …} reference anywhere in the value (objects that only carry an @id). */
function refs(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) for (const x of v) refs(x, out);
  else if (v && typeof v === "object") {
    const o = v as Node;
    const keys = Object.keys(o);
    if (keys.length === 1 && typeof o["@id"] === "string") out.push(o["@id"]);
    else for (const k of keys) refs(o[k], out);
  }
  return out;
}

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

  it("is a consistent graph: unique typed nodes, every @id reference resolves", () => {
    for (const c of [seed, withContent((x) => void (x.projects = PROJECTS)), withContent((x) => void ((x.projects = []), (x.company!.projects = [])))]) {
      const g = buildJsonLd(c) as { "@context": string; "@graph": Node[] };
      expect(g["@context"]).toBe("https://schema.org");
      const ids = g["@graph"].map((n) => n["@id"]);
      expect(ids.every((id) => typeof id === "string" && id.startsWith(`${c.site.url}/#`))).toBe(true);
      expect(new Set(ids).size).toBe(ids.length);
      for (const n of g["@graph"]) expect(typeof n["@type"]).toBe("string");
      const missing = refs(g["@graph"]).filter((id) => !ids.includes(id));
      expect(missing).toEqual([]);
      // Survives the trip through the <script> tag.
      expect(JSON.parse(jsonForScript(g))).toEqual(g);
    }
    // Empty project lists are left out, and so are the references to them.
    const empty = buildJsonLd(withContent((x) => void ((x.projects = []), (x.company!.projects = [])))) as { "@graph": Node[] };
    expect(empty["@graph"].filter((n) => n["@type"] === "ItemList")).toEqual([]);
    expect(empty["@graph"].find((n) => n["@type"] === "ProfilePage")!.hasPart).toEqual([]);
  });

  it("lists every published project by group; client work has no screenshot and drafts stay out", () => {
    const c = withContent((x) => void (x.projects = PROJECTS));
    const g = buildJsonLd(c) as { "@graph": Node[] };
    const list = g["@graph"].find((n) => n["@id"] === `${c.site.url}/#projects`) as { itemListElement: { position: number; item: Node }[]; numberOfItems: number };
    const items = list.itemListElement.map((e) => e.item);
    expect(items.map((i) => i.name)).toEqual(["EyesApp", "Clinic Dashboard", "Bot Kit", "Course Kit"]);
    expect(list.numberOfItems).toBe(4);
    expect(list.itemListElement.map((e) => e.position)).toEqual([1, 2, 3, 4]);
    const [eyes, nda, bot] = items as [Node, Node, Node];
    expect(nda).toMatchObject({ "@type": "CreativeWork", genre: "Client work", creator: { "@id": `${c.site.url}/#person` } });
    expect(nda.image).toBeUndefined();
    expect(eyes).toMatchObject({ genre: "Utotech", creator: { "@id": `${c.site.url}/#utotech` }, image: `${c.site.url}/img/eyes.png` });
    expect(bot).toMatchObject({ "@type": "SoftwareSourceCode", codeRepository: "https://github.com/example/bot", dateCreated: "2022" });
    expect(JSON.stringify(g)).not.toContain("Hidden Draft");
  });

  it("adds occupation, school, degree and awards only from what the content says", () => {
    const c = withContent((x) => {
      x.profile.education = [
        {
          school: { th: "มหาวิทยาลัยตัวอย่าง", en: "Example University" },
          program: { th: "", en: "Bachelor of Science, Computing · Second Class Honours · GPA 3.40" },
          period: "2019 – 2023",
        },
        { school: { th: "", en: "Night School" }, program: { th: "", en: "Short course" } },
      ];
      x.timeline = [
        { id: "cup", date: "2024-02", title: { th: "", en: "Code Cup" }, summary: { th: "", en: "Won second place." }, tags: ["Award"] },
        { id: "ctf", date: "2022-10", title: { th: "", en: "City CTF 2022" }, summary: { th: "", en: "Ranked 5th." }, tags: ["ctf"] },
        { id: "talk", date: "2023-01", title: { th: "", en: "Meetup talk" }, summary: { th: "", en: "Spoke." }, tags: ["Speaker"] },
        { id: "old", date: "2021", title: { th: "", en: "Draft prize" }, summary: { th: "", en: "x" }, tags: ["prize"], published: false },
      ];
    });
    expect(awardsOf(c)).toEqual([
      "Second Class Honours, Example University",
      "City CTF 2022 — Ranked 5th.",
      "Code Cup (Feb 2024) — Won second place.",
    ]);
    const person = (buildJsonLd(c) as { "@graph": Node[] })["@graph"].find((n) => n["@type"] === "Person")!;
    expect(person.award).toEqual(awardsOf(c));
    expect(person.alumniOf).toEqual([
      { "@type": "CollegeOrUniversity", name: "Example University", alternateName: "มหาวิทยาลัยตัวอย่าง" },
      { "@type": "CollegeOrUniversity", name: "Night School" },
    ]);
    expect(person.hasCredential).toEqual([
      {
        "@type": "EducationalOccupationalCredential",
        name: "Bachelor of Science, Computing",
        description: "Bachelor of Science, Computing · Second Class Honours · GPA 3.40",
        credentialCategory: "degree",
        recognizedBy: { "@type": "CollegeOrUniversity", name: "Example University", alternateName: "มหาวิทยาลัยตัวอย่าง" },
      },
      { "@type": "EducationalOccupationalCredential", name: "Short course", recognizedBy: { "@type": "CollegeOrUniversity", name: "Night School" } },
    ]);
    expect(person.hasOccupation).toMatchObject({ "@type": "Occupation", name: seed.company.role.en, occupationLocation: { "@type": "Country", name: seed.profile.location.en } });

    // No honours, no award-tagged frames → no award field at all.
    const plain = withContent((x) => {
      x.profile.education = [{ school: { th: "", en: "U" }, program: { th: "", en: "BSc" } }];
      x.timeline = x.timeline.map((f) => ({ ...f, tags: [] }));
    });
    expect(awardsOf(plain)).toEqual([]);
    expect((buildJsonLd(plain) as { "@graph": Node[] })["@graph"].find((n) => n["@type"] === "Person")!.award).toBeUndefined();
  });

  it("seed awards are quoted from the seed itself", () => {
    const text = JSON.stringify(seed);
    for (const a of awardsOf(seed)) for (const part of a.split(/ — |, (?=[A-Z])/)) expect(text).toContain(part.replace(/ \([A-Z][a-z]{2} \d{4}\)$/, ""));
  });
});

describe("content helpers", () => {
  it("honorsIn picks the honours part of a program", () => {
    expect(honorsIn("Bachelor's degree, Computer Technology (TCT) · First Class Honors · GPA 3.63")).toBe("First Class Honors");
    expect(honorsIn("BEng; first-class honours")).toBe("first-class honours");
    expect(honorsIn("Bachelor's degree · GPA 3.10")).toBeNull();
  });
  it("diaryRange reads the first and last entry", () => {
    expect(diaryRange(seed)).toMatch(/^\S+( \d{4})? to \S+ \d{4}$/);
    const two = (a: [string, string], b: [string, string]) =>
      diaryRange(
        withContent((x) => {
          x.diary.entries = [a, b].map(([month, period], i) => ({ id: `e${i}`, month: { th: "", en: month }, period, title: { th: "", en: "t" }, body: { th: "", en: "b" } }));
        }),
      );
    expect(two(["May", "1 May - 1 June 2023"], ["October", "1 October - 31 October 2023"])).toBe("May to October 2023");
    expect(two(["December", "1 - 31 December 2023"], ["January", "1 - 31 January 2024"])).toBe("December 2023 to January 2024");
    expect(diaryRange(withContent((x) => void (x.diary.entries = [])))).toBe("");
  });
  it("projectGroups follows the contract order and skips empty groups and drafts", () => {
    const groups = projectGroups(withContent((x) => void (x.projects = PROJECTS)));
    expect(groups.map((g) => g.group)).toEqual(["utotech", "client", "personal", "teaching"]);
    expect(groups[1]!.label).toEqual({ th: "งานลูกค้า", en: "Client work" });
    expect(groups[1]!.items.map((x) => x.id)).toEqual(["nda"]);
  });
});

describe("head + snapshot", () => {
  it("head has title, description, canonical, OG, Twitter and JSON-LD", () => {
    const h = buildHead(seed);
    for (const s of ["<title>", 'name="description"', 'rel="canonical"', 'property="og:image"', 'name="twitter:card"', "application/ld+json", 'href="/llms.txt"'])
      expect(h).toContain(s);
    expect(h.match(/<title>/g)).toHaveLength(1);
    expect(h).not.toMatch(/noindex/);
  });
  it("states the OG image size only when it is known", () => {
    expect(buildHead(seed)).toContain('property="og:image:width" content="1200"');
    const custom = buildHead(withContent((x) => void (x.site.ogImage = { url: "/media/og-custom.jpg" })));
    expect(custom).toContain(`content="${seed.site.url}/media/og-custom.jpg"`);
    expect(custom).not.toContain("og:image:width");
    const sized = buildHead(withContent((x) => void (x.site.ogImage = { url: "https://cdn.example/og.jpg", width: 800, height: 420 })));
    expect(sized).toContain('property="og:image:width" content="800"');
    expect(sized).toContain('property="og:image:height" content="420"');
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
    expect(real).toContain(esc(seed.profile.education[0]!.school.en));
  });
  it("snapshot groups projects like the site, client work included", () => {
    const s = buildSnapshot(withContent((x) => void (x.projects = PROJECTS)));
    const section = s.slice(s.indexOf('<section id="projects">'), s.indexOf("</section>", s.indexOf('<section id="projects">')));
    expect(section).toContain('<h3><span lang="th">งานลูกค้า</span> <span lang="en">Client work</span></h3>');
    expect(section.indexOf("EyesApp")).toBeLessThan(section.indexOf("Clinic Dashboard"));
    expect(section.indexOf("Clinic Dashboard")).toBeLessThan(section.indexOf("Bot Kit"));
    expect(section).toContain("A clinic dashboard");
    expect(section).not.toContain("secret.png");
    expect(section).not.toContain("Hidden Draft");
    // Every published client project from the seed is in the static HTML too.
    const snap = buildSnapshot(seed);
    for (const x of seed.projects.filter((p) => p.group === "client" && p.published)) expect(snap).toContain(esc(x.name));
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
  it("llms.txt lists projects with their group and the diary range from the content", () => {
    const s = buildLlmsTxt(withContent((x) => void (x.projects = PROJECTS)));
    expect(s).toContain("- Clinic Dashboard (Client work): A clinic dashboard\n");
    expect(s).toContain("- [Bot Kit](https://github.com/example/bot) (Personal, 2022): A bot\n");
    expect(s).not.toContain("Hidden Draft");
    expect(buildLlmsTxt(seed)).toContain(`monthly notes, ${diaryRange(seed)}`);
  });
  it("llms-full.txt includes every section, diary text and both languages", () => {
    const s = buildLlmsFull(seed);
    for (const h of ["## Profile", "## Timeline", "## Projects", "### Client work · งานลูกค้า", "## Skills", "### Services and prices", "### Portfolio"]) expect(s).toContain(h);
    for (const x of seed.projects.filter((p) => p.published)) expect(s).toContain(`#### ${x.name}`);
    for (const a of awardsOf(seed)) expect(s).toContain(`- Award: ${a}`);
    expect(s).toContain(seed.diary.entries[0]!.body.en.slice(0, 40));
    expect(s).toContain(seed.diary.entries[0]!.body.th.slice(0, 20));
    expect(s).not.toMatch(/\n{3,}/);
  });
  it("llms-full.txt states the content's updatedAt in the form deploy.yml reads", () => {
    const s = buildLlmsFull(withContent((x) => void (x.updatedAt = "2026-12-01T08:09:10.000Z")));
    // Same pattern as the sed in .github/workflows/deploy.yml ("Is the live site behind the content?").
    expect(s.match(/Last updated: ([^ ]*) /)?.[1]).toBe("2026-12-01T08:09:10.000Z");
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

/* ------------------------------------------------------------------ pages, safety, projection */

/** Like Vite's output: the module script and stylesheet sit in <head>. */
const SHELL = `<!doctype html>
<html lang="th">
  <head>
    <meta charset="UTF-8" />
    <title>old</title>
    <script type="module" crossorigin src="/assets/main-abc.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/main-abc.css">
  </head>
  <body>
    <!-- Keep #root empty -->
    <div id="root"></div>
  </body>
</html>`;

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const BASE = seed.site.url;

/** The facts a test needs from one built page. */
function inspect(html: string) {
  const doc = parse(html);
  const ld = [...doc.querySelectorAll('script[type="application/ld+json"]')];
  const data = [...doc.querySelectorAll(`script#${CONTENT_SCRIPT_ID}`)];
  const attr = (sel: string, name: string) => doc.querySelector(sel)?.getAttribute(name) ?? null;
  return {
    doc,
    lang: doc.documentElement.getAttribute("lang"),
    titles: doc.querySelectorAll("title").length,
    title: doc.title,
    canonical: attr('link[rel="canonical"]', "href"),
    ogUrl: attr('meta[property="og:url"]', "content"),
    ogLocale: attr('meta[property="og:locale"]', "content"),
    ogLocaleAlt: attr('meta[property="og:locale:alternate"]', "content"),
    hreflang: Object.fromEntries([...doc.querySelectorAll("link[hreflang]")].map((l) => [l.getAttribute("hreflang"), l.getAttribute("href")])),
    ld,
    graph: ld.length === 1 ? (JSON.parse(ld[0]!.textContent!) as { "@graph": Record<string, unknown>[] }) : null,
    data,
    content: data.length === 1 ? (JSON.parse(data[0]!.textContent!) as unknown) : null,
    roots: doc.querySelectorAll("#root").length,
    snapshot: doc.querySelector("#root > .seo-static"),
    moduleScripts: doc.querySelectorAll('script[type="module"]').length,
  };
}

/** Text in <body> outside #root and the content script (should be nothing). */
function strayBodyText(doc: Document): string {
  return [...doc.body.childNodes]
    .filter((n) => !(n instanceof Element && (n.id === "root" || n.id === CONTENT_SCRIPT_ID)) && n.nodeType !== 8)
    .map((n) => n.textContent ?? "")
    .join("")
    .trim();
}

/** Every string under url-like JSON-LD keys. */
function ldUrls(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) for (const x of v) ldUrls(x, out);
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      if (["url", "image", "logo", "codeRepository", "sameAs", "primaryImageOfPage", "email"].includes(k)) {
        for (const u of [x].flat()) if (typeof u === "string") out.push(u);
      } else ldUrls(x, out);
    }
  }
  return out;
}

describe("two pages: / (Thai) and /en/ (English)", () => {
  const files = buildSiteFiles(SHELL, seed);
  const th = inspect(files["index.html"]!);
  const en = inspect(files["en/index.html"]!);

  it("writes both pages and the text files", () => {
    expect(Object.keys(files).sort()).toEqual(["en/index.html", "index.html", "llms-full.txt", "llms.txt", "robots.txt", "sitemap.xml"]);
  });

  it("the Thai page is canonical at / and the English page at /en/", () => {
    expect(th).toMatchObject({ lang: "th", titles: 1, title: pageTitle(seed, "th"), canonical: `${BASE}/`, ogUrl: `${BASE}/`, ogLocale: "th_TH", ogLocaleAlt: "en_US" });
    expect(en).toMatchObject({ lang: "en", titles: 1, title: pageTitle(seed, "en"), canonical: `${BASE}/en/`, ogUrl: `${BASE}/en/`, ogLocale: "en_US", ogLocaleAlt: "th_TH" });
    const alternates = { th: `${BASE}/`, en: `${BASE}/en/`, "x-default": `${BASE}/` };
    expect(th.hreflang).toEqual(alternates);
    expect(en.hreflang).toEqual(alternates);
    expect(files["index.html"]).not.toContain("?lang=en");
    expect(files["en/index.html"]).not.toContain("?lang=en");
  });

  it("each page has one parseable JSON-LD graph naming its own URL", () => {
    for (const [page, url] of [[th, `${BASE}/`], [en, `${BASE}/en/`]] as const) {
      expect(page.ld).toHaveLength(1);
      const profile = page.graph!["@graph"].find((n) => n["@type"] === "ProfilePage")!;
      expect(profile.url).toBe(url);
      expect(profile["@id"]).toBe(`${url}#page`);
      // The person and the company are the same entities on both pages.
      expect(page.graph!["@graph"].find((n) => n["@type"] === "Person")!["@id"]).toBe(`${BASE}/#person`);
    }
  });

  it("the English page shows English first, the Thai page Thai first", () => {
    const firstLang = (p: typeof th) => p.snapshot!.querySelector("header p:not(.seo-handle) [lang]")!.getAttribute("lang");
    expect(firstLang(th)).toBe("th");
    expect(firstLang(en)).toBe("en");
    expect(buildSnapshot(seed, "en")).toContain(`<p lang="en">${esc(seed.profile.bio.en)}</p><p lang="th">`);
  });

  it("keeps the app shell: one module script, the snapshot inside #root between the markers", () => {
    for (const [p, html] of [[th, files["index.html"]!], [en, files["en/index.html"]!]] as const) {
      expect(p.moduleScripts).toBe(1);
      expect(p.roots).toBe(1);
      expect(p.snapshot).not.toBeNull();
      expect(html).toMatch(/<div id="root"><!--seo-snapshot--><div class="seo-static">[\s\S]*<!--\/seo-snapshot--><\/div>/);
      expect(strayBodyText(p.doc)).toBe("");
    }
  });

  it("embeds the public content as JSON that parses and validates", () => {
    for (const p of [th, en]) {
      expect(p.data).toHaveLength(1);
      expect(p.data[0]!.getAttribute("type")).toBe("application/json");
      const parsed = parseContent(p.content);
      expect(parsed.ok).toBe(true);
      expect(p.content).toEqual(JSON.parse(JSON.stringify(publicProjection(seed))));
    }
  });

  it("escapes <, U+2028 and U+2029 in the embedded JSON", () => {
    const tricky = withContent((x) => void (x.profile.bio.en = "a</script><script>alert(1)</script>\u2028b\u2029c <!-- d"));
    const html = injectIntoHtml(SHELL, tricky);
    const raw = html.slice(html.indexOf(`id="${CONTENT_SCRIPT_ID}">`));
    const body = raw.slice(raw.indexOf(">") + 1, raw.indexOf("</script>"));
    expect(body).not.toMatch(/[<\u2028\u2029]/);
    expect((JSON.parse(body) as Content).profile.bio.en).toBe(tricky.profile.bio.en);
    expect((inspect(html).content as Content).profile.bio.en).toBe(tricky.profile.bio.en);
  });

  it("hides the snapshot while the app loads (no flash), with a 4 s fallback", () => {
    for (const html of [files["index.html"]!, files["en/index.html"]!]) {
      const head = html.slice(0, html.indexOf("</head>"));
      expect(head).toContain(`<script data-seo>${NO_FLASH_SCRIPT}</script>`);
      expect(head).toContain(NO_FLASH_CSS);
      expect(NO_FLASH_CSS).toBe(".js .seo-static{display:none}");
      // The class goes on before <body> is parsed.
      expect(html.indexOf(NO_FLASH_SCRIPT)).toBeLessThan(html.indexOf("<body"));
    }
  });

  it("sitemap lists / and /en/ with th, en and x-default alternates", () => {
    const s = files["sitemap.xml"]!;
    expect(s.match(/<loc>[^<]+<\/loc>/g)).toEqual([`<loc>${BASE}/</loc>`, `<loc>${BASE}/en/</loc>`, `<loc>${BASE}/llms-full.txt</loc>`]);
    for (const [hl, href] of [["th", `${BASE}/`], ["en", `${BASE}/en/`], ["x-default", `${BASE}/`]]) {
      expect(s.split(`<xhtml:link rel="alternate" hreflang="${hl}" href="${href}"/>`)).toHaveLength(3);
    }
    expect(s).not.toContain("?lang=en");
  });

  it("llms.txt links the English page", () => {
    expect(files["llms.txt"]).toContain(`(${BASE}/en/)`);
    expect(files["llms.txt"]).not.toContain("?lang=en");
  });

  it("re-running gives the same pages, from the shell or from an earlier output", () => {
    expect(buildSiteFiles(files["index.html"]!, seed)).toEqual(files);
    expect(injectIntoHtml(files["index.html"]!, seed, "en")).toBe(files["en/index.html"]);
    expect(injectIntoHtml(files["en/index.html"]!, seed, "th")).toBe(files["index.html"]);
  });

  it("throws when the shell has no </body>", () => {
    expect(() => injectIntoHtml('<html lang="th"><head></head><div id="root"></div></html>', seed)).toThrow(/<\/body>/);
  });
});

describe("no-flash script", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.documentElement.classList.remove("js");
    document.body.innerHTML = "";
  });
  const run = () => new Function(NO_FLASH_SCRIPT)();

  it("adds the js class, and removes it after 4 s when the app has not mounted", () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="root"></div>';
    run();
    expect(document.documentElement.classList.contains("js")).toBe(true);
    vi.advanceTimersByTime(3999);
    expect(document.documentElement.classList.contains("js")).toBe(true);
    vi.advanceTimersByTime(1);
    expect(document.documentElement.classList.contains("js")).toBe(false);
  });

  it("keeps the js class when #root is marked data-mounted=1", () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="root"></div>';
    run();
    document.getElementById("root")!.setAttribute("data-mounted", "1");
    vi.advanceTimersByTime(5000);
    expect(document.documentElement.classList.contains("js")).toBe(true);
  });
});

describe("only the public projection is baked", () => {
  const SECRET = {
    email: "hidden-mail@example.test",
    phone: "+66 81 000 0000",
    frame: "Secret Frame Title",
    project: "Secret Draft Project",
    coProject: "Secret Company Draft",
    doc: "Secret Unfinished Document",
  };
  const c = withContent((x) => {
    x.profile.email = { value: SECRET.email, visible: false };
    x.profile.phone = { value: SECRET.phone, visible: false };
    x.timeline.push({ id: "secret-frame", date: "2025-01", title: { th: "", en: SECRET.frame }, summary: { th: "", en: "x" }, published: false });
    x.projects!.push({ id: "secret-project", name: SECRET.project, description: { th: "", en: "x" }, published: false });
    x.company.projects!.push({ id: "secret-co", name: SECRET.coProject, summary: { th: "", en: "x" }, published: false });
    x.documents!.push({ id: "secret-doc", title: { th: "", en: SECRET.doc }, url: "" });
  });

  it("drafts, hidden items and hidden contact details reach no output file", () => {
    const files = buildSiteFiles(SHELL, c);
    for (const [path, text] of Object.entries(files)) {
      for (const secret of [...Object.values(SECRET), SECRET.phone.replace(/[^+\d]/g, "")]) {
        expect(text.includes(secret), `${secret} in ${path}`).toBe(false);
      }
    }
    expect(inspect(files["index.html"]!).content).toEqual(JSON.parse(JSON.stringify(publicProjection(c))));
  });

  it("injectIntoHtml projects on its own too", () => {
    const html = injectIntoHtml(SHELL, c, "en");
    for (const secret of Object.values(SECRET)) expect(html).not.toContain(secret);
  });

  it("shows contact details marked visible", () => {
    const shown = withContent((x) => void (x.profile.email = { value: "shown@example.test", visible: true }));
    expect(buildSiteFiles(SHELL, shown)["index.html"]).toContain("mailto:shown@example.test");
  });
});

describe("unsafe link targets are dropped", () => {
  /** Content that got past the schema (older data, a direct caller): unsafe URLs everywhere. */
  const bad = (() => {
    const c = withContent((x) => {
      x.projects = PROJECTS;
      x.company.customers = [{ name: "Acme Customer" }, { name: "Good Customer", url: "https://good.example/" }];
    });
    const js = "javascript:alert(document.domain)";
    c.profile.links = [
      { kind: "github", label: "GitHub", url: js },
      { kind: "facebook", label: "Facebook", url: "JaVaScRiPt:alert(1)" },
      { kind: "website", label: "Home", url: "https://ok.example/" },
    ];
    c.profile.avatar = { url: "javascript:alert(2)", alt: { th: "", en: "" } };
    c.company.customers[0]!.url = "data:text/html,<script>alert(3)</script>";
    c.company.links = [{ kind: "website", label: "Utotech", url: "vbscript:msgbox(4)" }];
    c.company.logo = { url: "data:image/svg+xml,<svg onload=alert(5)>", alt: { th: "", en: "" } };
    c.company.projects[0]!.url = " javascript:alert(6)";
    c.company.projects[0]!.cover = { url: "javascript:alert(7)", alt: { th: "", en: "" } };
    c.projects[2]!.repo = "javascript:alert(8)";
    c.projects[0]!.url = "//evil.example/x";
    c.timeline[0]!.links = [{ kind: "demo", label: "Demo", url: "javascript:alert(9)" }];
    c.diary.company.website = "javascript:alert(10)";
    c.documents = [{ id: "cv", title: { th: "", en: "CV" }, description: { th: "", en: "" }, url: "javascript:alert(11)" }];
    c.site.ogImage = { url: "data:image/png;base64,AAAA", alt: { th: "", en: "" } };
    return c;
  })();
  const UNSAFE = /(?:java|vb)script:|data:|\/\/evil\.example/i;
  const files = buildSiteFiles(SHELL, bad);

  it("no href or src in either page points anywhere unsafe; the text stays", () => {
    for (const path of ["index.html", "en/index.html"]) {
      const { doc } = inspect(files[path]!);
      const targets = [...doc.querySelectorAll("[href]")].map((e) => e.getAttribute("href")!);
      targets.push(...[...doc.querySelectorAll("[src]")].map((e) => e.getAttribute("src")!));
      expect(targets.length).toBeGreaterThan(10);
      for (const href of targets) {
        expect(UNSAFE.test(href), `${href} in ${path}`).toBe(false);
        expect(isSafeUrl(href), `${href} in ${path}`).toBe(true);
      }
      for (const meta of doc.querySelectorAll('meta[property="og:image"], meta[name="twitter:image"]')) {
        expect(meta.getAttribute("content")).toBe(`${BASE}/og.png`);
      }
      // The names are still listed, without a link.
      const text = doc.querySelector("#root")!.textContent!;
      for (const name of ["Acme Customer", "GitHub", "Facebook", bad.company.projects[0]!.name]) expect(text).toContain(name);
      expect(doc.querySelector('a[href="https://good.example/"]')).not.toBeNull();
      expect(doc.querySelector('a[href="https://ok.example/"]')).not.toBeNull();
    }
  });

  it("JSON-LD keeps only safe URLs", () => {
    for (const path of ["index.html", "en/index.html"]) {
      const urls = ldUrls(inspect(files[path]!).graph);
      expect(urls.length).toBeGreaterThan(3);
      for (const u of urls) expect(UNSAFE.test(u), `${u} in ${path}`).toBe(false);
    }
    const g = buildJsonLd(bad) as { "@graph": Record<string, unknown>[] };
    const person = g["@graph"].find((n) => n["@type"] === "Person")!;
    expect(person.image).toBeUndefined();
    expect(person.sameAs).toEqual([]);
    const org = g["@graph"].find((n) => n["@type"] === "Organization")!;
    expect(org.logo).toBeUndefined();
    expect(org.url).toBeUndefined();
    // A repository link that is not safe does not make the project SoftwareSourceCode.
    expect(JSON.stringify(g)).not.toContain("SoftwareSourceCode");
  });

  it("llms.txt and llms-full.txt leave unsafe URLs out", () => {
    for (const path of ["llms.txt", "llms-full.txt"]) {
      const text = files[path]!;
      expect(UNSAFE.test(text), path).toBe(false);
      for (const m of text.matchAll(/\]\(([^)]*)\)/g)) expect(isSafeUrl(m[1]!), m[1]).toBe(true);
    }
    expect(files["llms.txt"]).toContain("- Project · ");
    expect(files["llms-full.txt"]).toContain("- Acme Customer\n");
    expect(files["llms-full.txt"]).toContain("- Good Customer (https://good.example/)");
    expect(files["llms-full.txt"]).not.toContain("## Documents");
  });

  it("images use http(s) or site paths only", () => {
    expect(isSafeImageUrl(inspect(files["index.html"]!).doc.querySelector('meta[property="og:image"]')!.getAttribute("content")!)).toBe(true);
  });
});

describe("content with $ patterns is inserted literally", () => {
  const PATTERNS = ["$&", "$'", "$`", "$$", "$1", "$<x>"];
  const marked = PATTERNS.map((p, i) => `[${i}]${p}[/${i}]`).join(" ");
  const c = withContent((x) => {
    x.company.services![0]!.price = { th: `ราคา ${marked}`, en: `from 5,000 THB (${marked} approx)` };
    x.profile.bio.en = `Bio ${marked}`;
    x.profile.name.en = `Kiattiphoom ${marked}`;
    x.site.title = { th: `ชื่อ ${marked}`, en: `Title ${marked}` };
  });

  it.each(["th", "en"] as const)("the %s page keeps every pattern as written", (lang) => {
    const html = injectIntoHtml(SHELL, c, lang);
    const p = inspect(html);
    expect(p.titles).toBe(1);
    expect(p.title).toBe(pageTitle(c, lang));
    expect(p.title).toContain(marked);
    expect(p.moduleScripts).toBe(1);
    expect(p.roots).toBe(1);
    expect(strayBodyText(p.doc)).toBe("");
    // JSON-LD: one block, parseable, price text intact.
    expect(p.ld).toHaveLength(1);
    const org = p.graph!["@graph"].find((n) => n["@type"] === "Organization") as { makesOffer: { description: string }[] };
    expect(org.makesOffer[0]!.description).toBe(c.company.services[0]!.price.en);
    // Snapshot text and embedded content intact.
    expect(p.snapshot!.textContent).toContain(`Bio ${marked}`);
    expect(p.snapshot!.textContent).toContain(c.company.services[0]!.price.en);
    expect((p.content as Content).company.services[0]!.price).toEqual(c.company.services[0]!.price);
    expect(parseContent(p.content).ok).toBe(true);
    // Idempotent with these patterns too.
    expect(injectIntoHtml(html, c, lang)).toBe(html);
  });
});

describe("no doubled full stops in generated text", () => {
  it("llms-full.txt and JSON-LD service descriptions never contain '..' after a word", () => {
    const full = buildLlmsFull(seed);
    expect(full).not.toMatch(/[A-Za-z)]\.\.(?!\.)/);
    const ld = JSON.stringify(buildJsonLd(seed));
    expect(ld).not.toMatch(/[A-Za-z)]\.\.(?!\.)/);
  });
});

describe("SITE_URL override", async () => {
  const { withSiteUrl, buildSitemap: sm } = await import("./build.ts");
  it("replaces site.url with an https origin and ignores anything else", () => {
    expect(withSiteUrl(seed, "https://example.pages.dev/").content.site.url).toBe("https://example.pages.dev");
    expect(sm(withSiteUrl(seed, "https://pho0m.dev").content)).toContain("<loc>https://pho0m.dev/</loc>");
    for (const bad of ["http://x.dev", "javascript:alert(1)", "https://x.dev/path"]) {
      const r = withSiteUrl(seed, bad);
      expect(r.content.site.url).toBe(seed.site.url);
      expect(r.warning).toBeTruthy();
    }
    expect(withSiteUrl(seed, "").content).toBe(seed);
    expect(withSiteUrl(seed, undefined).warning).toBeUndefined();
  });
});
