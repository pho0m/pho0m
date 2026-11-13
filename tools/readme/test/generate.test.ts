import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { XMLValidator } from "fast-xml-parser";
import { spritePixels, timelineFrames, type IconName } from "@pho0m/content";
import { beforeAll, describe, expect, it } from "vitest";
import { FILM_CARD_FRAMES, FILM_GIF_FRAMES, GENERATED_FILE, SVG_BUDGET, type Output } from "../src/generate.ts";
import { heroStats, type GithubStats } from "../src/model.ts";
import { heroChips } from "../src/svg/hero.ts";
import { PANEL_GUTTER, PANEL_W } from "../src/svg/panels.ts";
import { GIF_BUDGET, GIF_H, GIF_W, gifTimeline } from "../src/gif/film.ts";
import { MOTION_QUERY } from "../src/svg/motion.ts";
import { apply } from "../src/write.ts";
import { clone, outsideMotionQuery, parseGif, referencedAssets, run, styleOf } from "./helpers.ts";

const GH: GithubStats = { login: "pho0m", publicRepos: 42, followers: 37, stars: 43 };

let out: Output;
beforeAll(async () => {
  out = await run();
});

describe("generated SVGs", () => {
  it("produces a dark and a light variant of every card, all named with the tool's prefix", () => {
    expect(out.files.size).toBeGreaterThan(20);
    for (const name of out.files.keys()) {
      expect(name).toMatch(GENERATED_FILE);
      const twin = name.endsWith("-dark.svg") ? name.replace(/-dark\.svg$/, "-light.svg") : name.replace(/-light\.svg$/, "-dark.svg");
      expect(out.files.has(twin), `${name} has no ${twin}`).toBe(true);
    }
    for (const base of ["hero", "film-latest", "band-film", "band-skills", "panel-diary", "panel-docs"]) {
      expect(out.files.has(`${base}-dark.svg`), base).toBe(true);
    }
  });

  it("no longer makes the company card, the project bands and badges, or the end-of-roll strip", () => {
    for (const base of ["utotech", "band-utotech", "band-projects", "roll-end"]) {
      expect(out.files.has(`${base}-dark.svg`), base).toBe(false);
      expect(out.files.has(`${base}-light.svg`), base).toBe(false);
    }
    for (const name of out.files.keys()) expect(name, name).not.toMatch(/^(utotech|badge|roll)-/);
    // the old names still match GENERATED_FILE, so leftovers in the folder are cleaned up as stale
    for (const old of ["utotech-dark.svg", "band-projects-light.svg", "badge-project-seyes-dark.svg", "roll-end-light.svg"]) {
      expect(GENERATED_FILE.test(old), old).toBe(true);
    }
  });

  it("is well-formed XML, has a title and stays small", () => {
    for (const [name, svg] of out.files) {
      const result = XMLValidator.validate(svg);
      expect(result, `${name}: ${JSON.stringify(result)}`).toBe(true);
      expect(svg.startsWith("<svg xmlns=\"http://www.w3.org/2000/svg\""), name).toBe(true);
      expect(svg).toMatch(/<title id="title">[^<]+<\/title>/);
      expect(Buffer.byteLength(svg), name).toBeLessThan(250 * 1024);
    }
  });

  it("embeds fonts and images inline only (GitHub blocks external requests inside SVG images)", () => {
    for (const [name, svg] of out.files) {
      for (const m of svg.matchAll(/(?:href|url\()\s*=?\s*"?([^")\s]+)/g)) {
        const ref = m[1]!;
        expect(ref.startsWith("data:") || ref.startsWith("#"), `${name} references ${ref.slice(0, 60)}`).toBe(true);
      }
    }
    expect(out.files.get("hero-dark.svg")).toContain("data:image/png;base64,");
    expect(out.files.get("hero-dark.svg")).toContain("data:font/woff2;base64,");
    // the company logo is embedded in its pill button and footer link
    expect(out.files.get("btn-utotech-light.svg")).toContain("data:image/webp;base64,");
    expect(out.files.get("link-company-light.svg")).toContain("data:image/webp;base64,");
  });

  it("gives the light and dark variants different palettes", () => {
    expect(out.files.get("hero-dark.svg")).toContain("#120303");
    expect(out.files.get("hero-light.svg")).not.toContain('fill="#120303"');
  });

  it("draws each band sprite with exactly one <rect> per spritePixels() pixel", () => {
    let groups = 0;
    for (const [name, svg] of out.files) {
      if (!name.startsWith("band-") || !name.endsWith("-dark.svg")) continue;
      for (const m of svg.matchAll(/<g data-sprite="([a-z]+)"[^>]*>((?:<g fill="[^"]*">(?:<rect [^>]*\/>)*<\/g>)*)<\/g>/g)) {
        const icon = m[1] as IconName;
        const rects = m[2]!.match(/<rect /g)?.length ?? 0;
        expect(rects, icon).toBe(spritePixels(icon).length);
        groups++;
      }
    }
    expect(groups).toBe(2); // film and skills
  });

  it("prints the latest frames on the film card as clear duotone prints with their developing dithers", () => {
    const latest = timelineFrames(clone()).slice(-FILM_CARD_FRAMES);
    const film = out.files.get("film-latest-dark.svg")!;
    // one clear print and two dither stages per frame, each embedded once
    expect(film.match(/<image id="c\d+"/g)).toHaveLength(latest.length);
    expect(film.match(/<image id="d\d+-\d+"/g)).toHaveLength(latest.length * 2);
    expect(film).toContain('<filter id="duo"');
    expect(film).toContain('<filter id="neg"');
    for (const f of latest.slice(-5)) expect(film).toContain(String(timelineFrames(clone()).indexOf(f) + 1).padStart(2, "0"));
  });

  it("escapes text from the content", async () => {
    const content = clone();
    const last = timelineFrames(content).at(-1)!;
    last.title = { th: "", en: `A & B <C> "D"` };
    content.profile.role = { th: "", en: `CEO & <Boss>` };
    content.skills[0]!.items[0]!.name = `Pipe | <b>bold</b> & co`;
    content.diary.entries[0]!.title = { th: "", en: `Uto & <Tech>` };
    content.documents.find((d) => d.url.trim())!.title = { th: "", en: `Slides "v2" <final>` };
    content.profile.links.push({ kind: "website", label: `Blog "<i>x</i>"`, url: "https://blog.example/" });
    const o = await run({ content });
    for (const [name, svg] of o.files) expect(XMLValidator.validate(svg), name).toBe(true);
    // the cards
    const film = o.files.get("film-latest-light.svg")!;
    expect(film).toContain("A &amp; B &lt;C&gt; &quot;D&quot;");
    expect(film).not.toContain("<C>");
    expect(o.files.get("hero-dark.svg")).toContain("CEO &amp; &lt;Boss&gt;");
    const skills = [...o.files].filter(([name]) => name.startsWith("skills-")).map(([, svg]) => svg).join("");
    expect(skills).toContain("&lt;b&gt;bold&lt;/b&gt; &amp; co");
    expect(skills).not.toContain("<b>bold</b>");
    expect(o.files.get("panel-diary-dark.svg")).toContain("Uto &amp; &lt;Tech&gt;");
    expect(o.files.get("panel-docs-dark.svg")).toContain("Slides &quot;v2&quot; &lt;final&gt;");
    expect(o.files.get("btn-blog-i-x-i-dark.svg")).toContain("Blog &quot;&lt;i&gt;x&lt;/i&gt;&quot;");
    // the README: every piece of content text sits in an attribute, escaped
    for (const raw of ["<C>", "<Boss>", "<b>bold</b>", "<Tech>", "<final>", "<i>x</i>"]) expect(o.readme, raw).not.toContain(raw);
    expect(o.readme).toContain("A &amp; B &lt;C&gt; &quot;D&quot;"); // GIF and film card alt
    expect(o.readme).toContain("CEO &amp; &lt;Boss&gt;"); // hero alt
    expect(o.readme).toContain("Pipe | &lt;b&gt;bold&lt;/b&gt; &amp; co"); // skills alt
    expect(o.readme).toContain("Uto &amp; &lt;Tech&gt;"); // diary alt
    expect(o.readme).toContain("Slides &quot;v2&quot; &lt;final&gt;"); // documents alt
    expect(o.readme).toContain('alt="Blog &quot;&lt;i&gt;x&lt;/i&gt;&quot;"'); // profile button
  });
});

describe("README.md", () => {
  it("has no WakaTime block (WakaTime was removed)", () => {
    expect(out.readme).not.toMatch(/SECTION:waka|WakaTime/);
  });

  it("uses <picture> with a dark source and a light <img> for every card", () => {
    const pictures = out.readme.match(/<picture>.*?<\/picture>/g) ?? [];
    expect(pictures.length).toBe(out.files.size / 2);
    for (const p of pictures) {
      expect(p).toMatch(/^<picture><source media="\(prefers-color-scheme: dark\)" srcset="assets\/readme\/[a-z0-9-]+-dark\.svg"><img src="assets\/readme\/[a-z0-9-]+-light\.svg" alt="[^"]*" (width|height)="[^"]+"><\/picture>$/);
    }
  });

  it("links the sections of the live site that the README shows, in order", () => {
    const site = clone().site.url;
    const ids = ["top", "film", "skills", "diary", "documents"];
    for (const id of ids) expect(out.readme).toContain(`${site}/#${id}`);
    const at = ids.map((id) => out.readme.indexOf(`${site}/#${id}"`));
    expect(at).toEqual([...at].sort((a, b) => a - b));
    // the skills band is now section 02, right after the film
    expect(out.files.get("band-skills-dark.svg")).toContain(">02</text>");
    expect(out.files.get("band-film-dark.svg")).toContain(">01</text>");
  });

  it("has no Utotech card, no Projects section and no end-of-roll strip", () => {
    const c = clone();
    for (const gone of ["/#utotech", "/#projects", "| Project |", "**Client work**", "**My own projects**", `**${c.company.shortName} projects**`, "more** projects", "END OF ROLL", "badge-", "roll-end-", "utotech-dark.svg", "band-projects-", "band-utotech-", 'alt="Projects —', 'alt="Utotech —']) {
      expect(out.readme, gone).not.toContain(gone);
    }
    expect(out.readme).not.toMatch(/\*\*\+\d+ more\*\*/);
    // no markdown tables or markdown links at all: the README is cards and <a> links only
    expect(out.readme).not.toMatch(/^\|/m);
    expect(out.readme).not.toMatch(/\]\(/);
    // services, prices and customers stay on the site
    for (const { name } of c.company.customers) expect(out.readme, name).not.toContain(name);
  });

  it("never lists projects, however many there are (the hero only counts them)", async () => {
    const c = clone();
    const own = c.projects.filter((x) => x.published && x.group !== "client");
    for (let i = 0; i < 30; i++) c.projects.push({ ...structuredClone(own[0]!), id: `extra-${i}`, name: `Extra project ${i}`, featured: false });
    const o = await run({ content: c });
    expect(o.readme).not.toContain("Extra project");
    expect([...o.files.keys()].filter((name) => /extra/.test(name))).toEqual([]);
    expect(o.readme).toContain(`${own.length + 30} own projects`);
  });

  it("counts the company's project list, client work and my own projects separately in the hero, each under its own name", () => {
    const c = clone();
    const company = c.company.shortName;
    const companyWork = c.company.projects.filter((x) => x.published);
    const client = c.projects.filter((x) => x.published && x.group === "client");
    const own = c.projects.filter((x) => x.published && x.group !== "client");
    expect(out.readme).not.toMatch(/Client work at|client works|more client/i);
    // hero chips and their alt text: one number per kind, none of them a sum
    expect(out.readme).toContain(`${companyWork.length} ${company} projects, ${client.length} client projects`);
    expect(out.readme).toContain(`${own.length} own projects`);
    const hero = out.files.get("hero-light.svg")!;
    expect(hero).toContain(`>${companyWork.length}</text>`);
    expect(hero).toContain(`>${company.toUpperCase()} PROJECTS</text>`);
    expect(hero).toContain(`>${client.length}</text>`);
    expect(hero).toContain(">CLIENT PROJECTS</text>");
    expect(hero).not.toContain(`>${companyWork.length + client.length}</text>`);
    expect(hero).not.toContain("CLIENT WORKS");
  });

  it("references only assets that exist, and every generated asset is used", async () => {
    const dir = await mkdtemp(join(tmpdir(), "readme-test-"));
    try {
      const outDir = join(dir, "assets", "readme");
      const readmePath = join(dir, "README.md");
      await apply(out, outDir, readmePath);
      const written = await readFile(readmePath, "utf8");
      const refs = referencedAssets(written);
      expect(refs.length).toBe(out.files.size + out.binaries.size);
      for (const ref of refs) expect(existsSync(join(dir, ref)), ref).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("is deterministic: two runs give identical output", async () => {
    const again = await run();
    expect(again.readme).toBe(out.readme);
    expect([...again.files.keys()]).toEqual([...out.files.keys()]);
    for (const [name, svg] of out.files) expect(again.files.get(name), name).toBe(svg);
    expect([...again.binaries.keys()]).toEqual([...out.binaries.keys()]);
    for (const [name, bytes] of out.binaries) expect(Buffer.from(again.binaries.get(name)!).equals(Buffer.from(bytes)), name).toBe(true);
  });

  it("shows GitHub numbers only when they are known", async () => {
    expect(out.files.get("hero-dark.svg")).not.toMatch(/STARS|FOLLOWERS/);
    expect(out.readme).not.toContain("GitHub stars");
    const o = await run({ github: { login: "pho0m", publicRepos: 42, followers: 7, stars: 99 } });
    expect(o.files.get("hero-dark.svg")).toContain(">99</text>");
    expect(o.files.get("hero-dark.svg")).toContain("STARS");
    // the hero alt says the same, and it is the only place GitHub numbers appear in the README
    const heroAlt = o.readme.match(/srcset="assets\/readme\/hero-dark\.svg"><img [^>]*alt="([^"]*)"/)![1]!;
    expect(heroAlt).toContain("99 GitHub stars");
    expect(o.readme.match(/GitHub stars/g)).toHaveLength(1);
  });

  it("draws the hero chips in a fixed order (company and content numbers before GitHub) and its alt lists exactly those", async () => {
    const all = heroStats(clone(), GH);
    expect(all.map((s) => s.label)).toEqual(["Utotech projects", "Client projects", "Customers", "Team", "Own projects", "Coding since", "Stars", "Followers", "Repos"]);
    const altOf = (readme: string) => readme.match(/srcset="assets\/readme\/hero-dark\.svg"><img [^>]*alt="([^"]*)"/)![1]!;
    const chipLabels = (svg: string) => [...svg.matchAll(/<text [^>]*font-size="16" fill="[^"]+" letter-spacing="1">([^<]+)<\/text>/g)].map((m) => m[1]!);
    for (const github of [null, GH]) {
      const warnings: string[] = [];
      const o = await run({ github, warn: (m) => warnings.push(m) });
      const { shown, dropped } = heroChips(heroStats(clone(), github));
      const hero = o.files.get("hero-light.svg")!;
      // the card draws `shown`, in order, and nothing else
      expect(chipLabels(hero)).toEqual(shown.map((s) => s.label.toUpperCase()));
      const alt = altOf(o.readme);
      expect(alt.endsWith(` ${shown.map((s) => s.alt).join(", ")}.`), alt).toBe(true);
      for (const s of dropped) expect(alt).not.toContain(s.alt);
      // a fact that does not fit is never dropped silently
      if (dropped.length) expect(warnings.join("\n")).toContain(dropped.map((s) => s.alt).join(", "));
      else expect(warnings.join("\n")).not.toContain("no room");
      // the company numbers always make it, GitHub ones only after them
      expect(shown.slice(0, 4).map((s) => s.label)).toEqual(["Utotech projects", "Client projects", "Customers", "Team"]);
    }
    // without GitHub every content fact fits (two rows), including "coding since"
    expect(heroChips(heroStats(clone(), null)).dropped).toEqual([]);
  });

  it("puts the diary and documents panels edge to edge so they never wrap, with the gap drawn inside the SVGs", () => {
    const line = out.readme.split("\n").find((l) => l.includes("panel-diary-"))!;
    expect(line).toContain("panel-docs-");
    // nothing (not even a space) between the two links, and 2 × 49.5% always fits the column
    expect(line).toMatch(/^ {2}<a href="[^"]+\/#diary"><picture>.*<\/picture><\/a><a href="[^"]+\/#documents"><picture>.*<\/picture><\/a>$/);
    expect(line.match(/width="49\.5%"/g)).toHaveLength(2);
    const size = (svg: string) => svg.match(/^<svg [^>]*width="([\d.]+)" height="([\d.]+)"/)!.slice(1).map(Number);
    for (const theme of ["dark", "light"]) {
      const diary = out.files.get(`panel-diary-${theme}.svg`)!;
      const docs = out.files.get(`panel-docs-${theme}.svg`)!;
      // same size, so they scale alike and line up; the docs frame sits right of its gutter
      expect(size(diary)).toEqual(size(docs));
      expect(size(diary)[0]).toBe(PANEL_W + PANEL_GUTTER);
      expect(docs).toContain(`<g transform="translate(${PANEL_GUTTER} 0)">`);
      expect(diary).not.toContain("<g transform=");
    }
  });
});

describe("film GIF", () => {
  it("is a looping GIF89a of the right size with one frame per animation tick", () => {
    const gif = out.binaries.get("film.gif")!;
    expect(gif).toBeTruthy();
    expect(GENERATED_FILE.test("film.gif")).toBe(true);
    const info = parseGif(gif);
    expect(info.version).toBe("GIF89a");
    expect([info.width, info.height]).toEqual([GIF_W, GIF_H]);
    expect(info.globalColors).toBeLessThanOrEqual(256);
    expect(info.loop).toBe(0); // NETSCAPE2.0, 0 = loop forever
    const frames = Math.min(FILM_GIF_FRAMES, timelineFrames(clone()).length);
    expect(info.frames.length).toBe(gifTimeline(frames).length);
    expect([info.frames[0]!.x, info.frames[0]!.y, info.frames[0]!.w, info.frames[0]!.h]).toEqual([0, 0, GIF_W, GIF_H]);
    for (const f of info.frames) {
      expect(f.x + f.w).toBeLessThanOrEqual(GIF_W);
      expect(f.y + f.h).toBeLessThanOrEqual(GIF_H);
      expect(f.delay).toBeGreaterThanOrEqual(60);
      expect(f.dispose).toBe(1);
    }
    // 10–15 fps while things move; the whole loop is a few seconds per frame of film
    const ticks = info.frames.filter((f) => f.delay <= 100);
    expect(ticks.length / info.frames.length).toBeGreaterThan(0.8);
    for (const f of ticks) expect(1000 / f.delay).toBeGreaterThanOrEqual(10);
    const total = info.frames.reduce((a, f) => a + f.delay, 0);
    expect(total).toBeGreaterThan(frames * 1500);
    expect(total).toBeLessThan(frames * 4000);
  });

  it("stays under the size budget", () => {
    expect(out.binaries.get("film.gif")!.byteLength).toBeLessThan(1.5 * 1024 * 1024);
  });

  it("is referenced near the top of the README, linked to the film section", () => {
    const at = out.readme.indexOf('src="assets/readme/film.gif"');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(out.readme.indexOf("band-film-"));
    expect(out.readme).toMatch(/<a href="[^"]+\/#film"><img src="assets\/readme\/film\.gif" alt="Animated film strip[^"]+" width="100%"><\/a>/);
  });

  it("is still made when there is only one frame", async () => {
    const c = clone();
    const keep = timelineFrames(c).at(-1)!;
    c.timeline = c.timeline.filter((f) => f.id === keep.id);
    const o = await run({ content: c });
    const info = parseGif(o.binaries.get("film.gif")!);
    expect(info.frames.length).toBe(gifTimeline(1).length);
    expect(o.files.get("film-latest-dark.svg")).not.toContain("@keyframes roll");
  });
});

describe("clear images", () => {
  it("tones any avatar format the browser shows with the duotone filter (WebP is embedded as is)", async () => {
    const c = clone();
    c.profile.avatar = { url: "/media/utotech/logo.webp", alt: { th: "", en: "" } };
    const o = await run({ content: c });
    const hero = o.files.get("hero-light.svg")!;
    expect(hero).toMatch(/<image id="av-src"[^>]*href="data:image\/webp;base64,[^"]+"[^>]*filter="url\(#duotone\)"/);
    expect(hero).toContain('<use class="av-d0" href="#av-src" opacity="0" filter="url(#poster)"/>');
    expect(hero.match(/data:image\/webp/g)).toHaveLength(1);
    expect(hero).toContain('<feColorMatrix type="matrix"');
  });

  it("uses a frame's JPEG/PNG photo as a smooth clear print in the film card and the GIF", async () => {
    const c = clone();
    const newest = timelineFrames(c).at(-1)!;
    newest.images = [{ url: "/img/profile.jpg", alt: { th: "", en: "" } }];
    const o = await run({ content: c });
    const film = o.files.get("film-latest-dark.svg")!;
    const last = Math.min(FILM_CARD_FRAMES, timelineFrames(c).length) - 1;
    const tag = film.match(new RegExp(`<image id="c${last}"[^>]*>`))![0];
    expect(tag).not.toContain("pixelated");
    expect(tag).toContain("data:image/png;base64,");
    expect(parseGif(o.binaries.get("film.gif")!).frames.length).toBeGreaterThan(10);
    expect(Buffer.from(o.binaries.get("film.gif")!).equals(Buffer.from(out.binaries.get("film.gif")!))).toBe(false);
  });
});

describe("size budgets", () => {
  it("keeps the GIF and every card in budget even when every frame is a photo", async () => {
    const c = clone();
    for (const f of timelineFrames(c).slice(-FILM_CARD_FRAMES)) f.images = [{ url: "/img/profile.jpg", alt: { th: "", en: "" } }];
    const o = await run({ content: c });
    expect(o.binaries.get("film.gif")!.byteLength).toBeLessThan(GIF_BUDGET);
    for (const [name, svg] of o.files) expect(Buffer.byteLength(svg), name).toBeLessThan(SVG_BUDGET);
    // the film card still shows the photos (1x when 2x would not fit)
    expect(o.files.get("film-latest-dark.svg")!.match(/<image id="c\d+"[^>]*>/g)!.filter((t) => !t.includes("pixelated")).length).toBe(Math.min(FILM_CARD_FRAMES, timelineFrames(c).length));
  });
});

describe("card animations", () => {
  it("keeps every animation inside the reduced-motion guard", () => {
    let animated = 0;
    for (const [name, svg] of out.files) {
      const css = styleOf(svg);
      if (!/@keyframes|animation/.test(css)) continue;
      animated++;
      expect(css, name).toContain(MOTION_QUERY);
      const outside = outsideMotionQuery(css);
      expect(outside, name).not.toMatch(/@keyframes|animation/);
    }
    expect(animated).toBeGreaterThanOrEqual(2 * 2 + 2 * 2); // hero + film, and the film and skills bands, each in two themes
  });

  it("animates the hero, the film strip and the band sprites", () => {
    for (const theme of ["dark", "light"]) {
      const hero = styleOf(out.files.get(`hero-${theme}.svg`)!);
      expect(hero).toContain("@keyframes blink");
      expect(hero).toMatch(/@keyframes avd\d/);
      expect(hero).toContain("@keyframes lit3");
      const film = styleOf(out.files.get(`film-latest-${theme}.svg`)!);
      expect(film).toContain("@keyframes roll");
      expect(film).toContain("@keyframes flash");
      expect(film).toMatch(/steps\(\d+,end\)/);
      const band = styleOf(out.files.get(`band-film-${theme}.svg`)!);
      expect(band).toContain("@keyframes bob");
      expect(band).toMatch(/@keyframes bob\{[^}]*steps\(/);
      expect(band).toMatch(/scale\(1\.2,0\.78\)/); // squash on landing
    }
  });

  it("moves the film to the RIGHT (translate grows) and loops", () => {
    const film = styleOf(out.files.get("film-latest-dark.svg")!);
    const xs = [...film.matchAll(/@keyframes roll\{(.*?)\}\}/g)][0]![1]!.match(/translate\(([-\d.]+)px/g)!.map((m) => Number(m.slice(10, -2)));
    for (let i = 1; i < xs.length; i++) expect(xs[i]!).toBeGreaterThanOrEqual(xs[i - 1]!);
    expect(xs[0]).toBe(0);
    expect(xs.at(-1)).toBeGreaterThan(0);
  });

  it("shows the finished state when nothing animates: clear avatar print, DRY lit, developing layers hidden", () => {
    const hero = out.files.get("hero-dark.svg")!;
    expect(hero).toMatch(/<image id="av-src"[^>]*filter="url\(#duotone\)"/);
    expect(hero).toContain('<filter id="duotone"');
    for (const m of hero.matchAll(/<(?:image|rect|use) class="av-[^"]*"[^>]*>/g)) expect(m[0]).toContain('opacity="0"');
    expect(hero).toMatch(/<g class="lit lit3">/);
    for (const i of [0, 1, 2]) expect(hero).toContain(`<g class="lit lit${i}" opacity="0">`);
    const film = out.files.get("film-latest-dark.svg")!;
    for (const m of film.matchAll(/<use class="d\d+-\d+"[^>]*>/g)) expect(m[0]).toContain('opacity="0"');
  });
});
