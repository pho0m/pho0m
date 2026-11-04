import { describe, expect, it } from "vitest";
import { Content, seed, type ContentInput } from "@pho0m/content";
import {
  AI_USER_AGENTS,
  awardsOf,
  buildHead,
  buildJsonLd,
  buildLlmsFull,
  buildLlmsTxt,
  buildRobots,
  buildSitemap,
  buildSnapshot,
  diaryRange,
  esc,
  honorsIn,
  injectIntoHtml,
  jsonForScript,
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
