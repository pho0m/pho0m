import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seed } from "@pho0m/content";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseArgs, run as cli } from "../src/cli.ts";
import { contentUrl, loadContent, loadGithubStats } from "../src/load.ts";
import { createMediaLoader } from "../src/media.ts";
import { apply, plan } from "../src/write.ts";
import { README_SAMPLE, ROOT, WAKA_SAMPLE, run } from "./helpers.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("content source", () => {
  it("prefers CONTENT_URL, then the bucket object, then the seed", () => {
    expect(contentUrl({ CONTENT_URL: "https://x.test/c.json", SERVICE_ACCOUNT_BUCKET_NAME: "b" })).toBe("https://x.test/c.json");
    expect(contentUrl({ SERVICE_ACCOUNT_BUCKET_NAME: "my-bucket" })).toBe("https://storage.googleapis.com/my-bucket/content/site.json");
    expect(contentUrl({})).toBeNull();
  });

  it("uses fetched content when it validates", async () => {
    const live = structuredClone(seed);
    live.profile.nickname = "Live";
    const fetchMock = vi.fn(async () => json(live));
    const r = await loadContent({ SERVICE_ACCOUNT_BUCKET_NAME: "b" }, fetchMock as unknown as typeof fetch, () => {});
    expect(fetchMock).toHaveBeenCalledWith("https://storage.googleapis.com/b/content/site.json", expect.anything());
    expect(r.content.profile.nickname).toBe("Live");
  });

  it("falls back to the seed with a warning on invalid content or network errors", async () => {
    const warn = vi.fn();
    const bad = await loadContent({ CONTENT_URL: "https://x.test/c.json" }, (async () => json({ schemaVersion: 2 })) as unknown as typeof fetch, warn);
    expect(bad.content).toBe(seed);
    const down = await loadContent({ CONTENT_URL: "https://x.test/c.json" }, (async () => { throw new Error("offline"); }) as unknown as typeof fetch, warn);
    expect(down.content).toBe(seed);
    const missing = await loadContent({ CONTENT_URL: "https://x.test/c.json" }, (async () => json({}, 404)) as unknown as typeof fetch, warn);
    expect(missing.source).toBe("seed");
    expect(warn).toHaveBeenCalledTimes(3);
  });
});

describe("GitHub stats", () => {
  it("needs a token", async () => {
    const f = vi.fn();
    expect(await loadGithubStats({}, "pho0m", f as unknown as typeof fetch)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("sums stars over own non-fork repos across pages and honours GITHUB_USER", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({ name: `R${i}`, fork: i === 0, stargazers_count: 1 }));
    const page2 = [{ name: "Seyes-App", fork: false, stargazers_count: 5 }];
    const urls: string[] = [];
    const f = async (url: string) => {
      urls.push(url);
      if (url.endsWith("/users/someone")) return json({ login: "someone", public_repos: 101, followers: 3 });
      return json(url.endsWith("&page=1") ? page1 : page2);
    };
    const stats = await loadGithubStats({ GITHUB_TOKEN: "t", GITHUB_USER: "someone" }, "pho0m", f as unknown as typeof fetch);
    expect(stats).toEqual(expect.objectContaining({ login: "someone", publicRepos: 101, followers: 3, stars: 99 + 5 }));
    expect(stats!.repoStars["seyes-app"]).toBe(5);
    expect(stats!.repoStars.r0).toBeUndefined();
    expect(urls).toHaveLength(3);
  });

  it("returns null (and warns) when the API fails", async () => {
    const warn = vi.fn();
    expect(await loadGithubStats({ GITHUB_TOKEN: "t" }, "pho0m", (async () => json({}, 401)) as unknown as typeof fetch, warn)).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("media loader", () => {
  const loader = (f?: typeof fetch) =>
    createMediaLoader({ publicDir: join(ROOT, "web", "public"), siteUrl: "https://site.test", fetch: f, warn: () => {} });

  it("reads site-relative and same-origin URLs from web/public without the network", async () => {
    const f = vi.fn();
    const load = loader(f as unknown as typeof fetch);
    expect((await load("/img/profile.jpg"))?.mime).toBe("image/jpeg");
    expect((await load("https://site.test/media/utotech/logo.webp"))?.mime).toBe("image/webp");
    expect(f).not.toHaveBeenCalled();
  });

  it("refuses paths that escape web/public", async () => {
    expect(await loader()("/../../package.json")).toBeNull();
    expect(await loader()("/img/missing.png")).toBeNull();
  });
});

describe("writing and --check", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "readme-io-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes, then reports no changes, then notices edits and stale files", async () => {
    const out = await run();
    const outDir = join(dir, "assets");
    const readme = join(dir, "README.md");
    await writeFile(join(dir, "keep.txt"), "x");
    const first = await apply(out, outDir, readme);
    expect(first.changed.length).toBe(out.files.size + out.binaries.size + 1);
    expect(await readFile(join(outDir, "film.gif"))).toEqual(Buffer.from(out.binaries.get("film.gif")!));
    expect(await plan(out, outDir, readme)).toEqual({ changed: [], removed: [] });

    await writeFile(join(outDir, "hero-dark.svg"), "<svg/>");
    await writeFile(join(outDir, "badge-old-thing-dark.svg"), "<svg/>");
    await writeFile(join(outDir, "notes-dark.svg"), "<svg/>");
    const p = await plan(out, outDir, readme);
    expect(p.changed).toEqual([join(outDir, "hero-dark.svg")]);
    expect(p.removed).toEqual([join(outDir, "badge-old-thing-dark.svg")]);

    await apply(out, outDir, readme);
    const files = await readdir(outDir);
    expect(files).not.toContain("badge-old-thing-dark.svg");
    expect(files).toContain("notes-dark.svg");
    expect(await readFile(join(dir, "keep.txt"), "utf8")).toBe("x");
  });

  it("parses CLI flags", () => {
    expect(parseArgs(["--out-dir", "a", "--readme=b.md", "--check"])).toEqual({ outDir: "a", readme: "b.md", check: true, help: false });
    expect(() => parseArgs(["--nope"])).toThrow();
    expect(() => parseArgs(["--out-dir"])).toThrow();
  });

  it("CLI --check exits 1 when out of date and 0 after generating; the waka block survives", async () => {
    const readme = join(dir, "README.md");
    const outDir = join(dir, "assets", "readme");
    await writeFile(readme, README_SAMPLE);
    const args = ["--out-dir", outDir, "--readme", readme];
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await cli([...args, "--check"], {})).toBe(1);
      expect(await cli(args, {})).toBe(0);
      expect(await cli([...args, "--check"], {})).toBe(0);
      const written = await readFile(readme, "utf8");
      expect(written).toContain(WAKA_SAMPLE);
      expect(written).toContain('srcset="assets/readme/hero-dark.svg"');
      expect(written).not.toContain("Old intro.");
    } finally {
      log.mockRestore();
      err.mockRestore();
    }
  });
});
