import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { XMLValidator } from "fast-xml-parser";
import { spritePixels, timelineFrames, type IconName } from "@pho0m/content";
import { beforeAll, describe, expect, it } from "vitest";
import { FILM_CARD_FRAMES, FILM_GIF_FRAMES, GENERATED_FILE, MAX_TABLE_ROWS, SVG_BUDGET, type Output } from "../src/generate.ts";
import { GIF_BUDGET, GIF_H, GIF_W, gifTimeline } from "../src/gif/film.ts";
import { WAKA_END, WAKA_START } from "../src/readme.ts";
import { MOTION_QUERY } from "../src/svg/motion.ts";
import { apply } from "../src/write.ts";
import { README_SAMPLE, WAKA_SAMPLE, clone, outsideMotionQuery, parseGif, referencedAssets, run, styleOf } from "./helpers.ts";

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
    for (const base of ["hero", "film-latest", "utotech", "band-film", "band-utotech", "band-projects", "band-skills", "panel-diary", "panel-docs", "roll-end"]) {
      expect(out.files.has(`${base}-dark.svg`), base).toBe(true);
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
    expect(out.files.get("utotech-light.svg")).toContain("data:image/webp;base64,");
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
    expect(groups).toBe(4);
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
    content.projects[0]!.name = `Pipe | <b>bold</b> & co`;
    content.company.name.en = `Uto & <Tech>`;
    const o = await run({ content });
    for (const [name, svg] of o.files) expect(XMLValidator.validate(svg), name).toBe(true);
    const film = o.files.get("film-latest-light.svg")!;
    expect(film).toContain("A &amp; B &lt;C&gt; &quot;D&quot;");
    expect(film).not.toContain("<C>");
    expect(o.files.get("utotech-dark.svg")).toContain("Uto &amp; &lt;Tech&gt;");
    expect(o.readme).not.toContain("<C>");
    expect(o.readme).not.toContain("<b>bold</b>");
    expect(o.readme).toContain("Pipe \\| &lt;b&gt;bold&lt;/b&gt; &amp; co");
  });
});

describe("README.md", () => {
  it("keeps the WakaTime block byte-for-byte inside a <details>", () => {
    expect(README_SAMPLE).toContain(WAKA_SAMPLE);
    expect(out.readme).toContain(`<details>\n<summary>Current languages (WakaTime)</summary>\n\n${WAKA_SAMPLE}\n\n</details>`);
    expect(out.readme.split(WAKA_START)).toHaveLength(2);
    expect(out.readme.split(WAKA_END)).toHaveLength(2);
  });

  it("creates an empty WakaTime block when the markers are missing", async () => {
    for (const currentReadme of [null, "# Hello\n\nno markers here\n"]) {
      const o = await run({ currentReadme });
      expect(o.readme).toContain(`${WAKA_START}\n${WAKA_END}`);
    }
  });

  it("uses <picture> with a dark source and a light <img> for every card", () => {
    const pictures = out.readme.match(/<picture>.*?<\/picture>/g) ?? [];
    expect(pictures.length).toBe(out.files.size / 2);
    for (const p of pictures) {
      expect(p).toMatch(/^<picture><source media="\(prefers-color-scheme: dark\)" srcset="assets\/readme\/[a-z0-9-]+-dark\.svg"><img src="assets\/readme\/[a-z0-9-]+-light\.svg" alt="[^"]*" (width|height)="[^"]+"><\/picture>$/);
    }
  });

  it("links sections of the live site and lists every published project when the tables are not capped", async () => {
    const site = clone().site.url;
    for (const id of ["top", "film", "projects", "skills", "diary", "documents"]) expect(out.readme).toContain(`${site}/#${id}`);
    const c = clone();
    const all = await run({ maxRows: 1000 });
    for (const p of c.projects.filter((x) => x.published)) expect(all.readme).toContain(`[${p.name}]`);
    for (const p of c.company.projects.filter((x) => x.published)) expect(all.readme).toContain(`[${p.name}]`);
    expect(all.readme).not.toMatch(/\*\*\+\d+ more\*\*/);
  });

  it("caps long project tables and says how many more there are, with a link to the site", async () => {
    const c = clone();
    const own = c.projects.filter((x) => x.published && x.group !== "client");
    const client = c.projects.filter((x) => x.published && x.group === "client");
    // grow the content well past the cap
    for (let i = 0; i < 30; i++) c.projects.push({ ...structuredClone(own[0]!), id: `extra-${i}`, name: `Extra ${i}`, featured: false });
    const o = await run({ content: c });
    const tables = o.readme.split("\n\n").filter((b) => b.startsWith("| Project |"));
    for (const t of tables) expect(t.split("\n").length - 2).toBeLessThanOrEqual(MAX_TABLE_ROWS);
    const ownTotal = own.length + 30;
    expect(o.readme).toContain(`**+${ownTotal - MAX_TABLE_ROWS} more** projects not listed here — [see all ${ownTotal} on the site →](${c.site.url}/#projects)`);
    if (client.length > MAX_TABLE_ROWS) expect(o.readme).toContain(`**+${client.length - MAX_TABLE_ROWS} more** client projects`);
    // featured projects always make the cut
    for (const p of own.filter((x) => x.featured).slice(0, MAX_TABLE_ROWS)) expect(o.readme).toContain(`[${p.name}]`);
  });

  it("labels client work clearly and shows it as text only", () => {
    const c = clone();
    const client = c.projects.filter((x) => x.published && x.group === "client");
    if (!client.length) return;
    expect(out.readme).toContain("**Client projects**");
    const section = out.readme.slice(out.readme.indexOf("**Client projects**"), out.readme.indexOf("**My own projects**"));
    expect(section).toContain(`[${client[0]!.name}]`);
    expect(section).not.toMatch(/\.(png|jpe?g|webp)/i);
    expect(out.readme).toMatch(/client projects at [^,"]+, \d+ more client works, and \d+ of my own \([^)]*\)\./);
    const badge = out.files.get(`badge-client-${client[0]!.id}-dark.svg`)!;
    expect(badge).toBeTruthy();
    expect(badge).toMatch(/client/i);
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
    const o = await run({
      github: { login: "pho0m", publicRepos: 42, followers: 7, stars: 99, repoStars: { "seyes-app": 5 } },
    });
    expect(o.files.get("hero-dark.svg")).toContain(">99</text>");
    expect(o.files.get("hero-dark.svg")).toContain("STARS");
    expect(o.readme).toContain("5 GitHub stars");
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
    expect(animated).toBeGreaterThanOrEqual(2 + 4 * 2); // hero + film (x2 themes) + the four bands (x2)
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
