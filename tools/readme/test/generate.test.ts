import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { XMLValidator } from "fast-xml-parser";
import { spritePixels, timelineFrames, type IconName } from "@pho0m/content";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GENERATED_FILE, type Output } from "../src/generate.ts";
import { WAKA_END, WAKA_START } from "../src/readme.ts";
import { apply } from "../src/write.ts";
import { README_SAMPLE, WAKA_SAMPLE, clone, referencedAssets, run } from "./helpers.ts";

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

  it("draws each frame sprite with exactly one <rect> per spritePixels() pixel", () => {
    const svgs = [out.files.get("film-latest-dark.svg")!, out.files.get("band-film-light.svg")!];
    let groups = 0;
    for (const svg of svgs) {
      for (const m of svg.matchAll(/<g data-sprite="([a-z]+)"[^>]*>((?:<g fill="[^"]*">(?:<rect [^>]*\/>)*<\/g>)*)<\/g>/g)) {
        const icon = m[1] as IconName;
        const rects = m[2]!.match(/<rect /g)?.length ?? 0;
        expect(rects, icon).toBe(spritePixels(icon).length);
        groups++;
      }
    }
    const latest = timelineFrames(clone()).slice(-5);
    expect(groups).toBe(latest.length + 1);
    const film = out.files.get("film-latest-dark.svg")!;
    for (const f of latest) expect(film).toContain(`data-sprite="${f.icon}"`);
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

  it("links sections of the live site and lists every published project", () => {
    const site = clone().site.url;
    for (const id of ["top", "film", "projects", "skills", "diary", "documents"]) expect(out.readme).toContain(`${site}/#${id}`);
    const c = clone();
    for (const p of c.projects.filter((x) => x.published)) expect(out.readme).toContain(`[${p.name}]`);
    for (const p of c.company.projects.filter((x) => x.published)) expect(out.readme).toContain(`[${p.name}]`);
  });

  it("references only assets that exist, and every generated asset is used", async () => {
    const dir = await mkdtemp(join(tmpdir(), "readme-test-"));
    try {
      const outDir = join(dir, "assets", "readme");
      const readmePath = join(dir, "README.md");
      await apply(out, outDir, readmePath);
      const written = await readFile(readmePath, "utf8");
      const refs = referencedAssets(written);
      expect(refs.length).toBe(out.files.size);
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
