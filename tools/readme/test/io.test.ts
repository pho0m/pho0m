import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seed } from "@pho0m/content/seed";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseArgs, run as cli } from "../src/cli.ts";
import { LiveContentError, contentUrl, loadContent, loadGithubStats, withSiteUrl } from "../src/load.ts";
import { createMediaLoader } from "../src/media.ts";
import { apply, plan } from "../src/write.ts";
import { README_SAMPLE, ROOT, run } from "./helpers.ts";

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

  describe("README_REQUIRE_LIVE_CONTENT=1", () => {
    const env = { CONTENT_URL: "https://x.test/c.json", README_REQUIRE_LIVE_CONTENT: "1" };
    const fails: [string, () => Promise<Response>][] = [
      ["HTTP 503", async () => json({}, 503)],
      ["HTTP 403", async () => json({}, 403)],
      ["a network error", async () => { throw new Error("offline"); }],
      ["a timeout", async () => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); }],
      ["invalid JSON", async () => new Response("<html>oops", { status: 200 })],
      ["content that fails the schema", async () => json({ schemaVersion: 2 })],
    ];
    for (const [what, f] of fails) {
      it(`refuses to fall back to the seed on ${what}`, async () => {
        const warn = vi.fn();
        await expect(loadContent(env, f as unknown as typeof fetch, warn)).rejects.toBeInstanceOf(LiveContentError);
        expect(warn).not.toHaveBeenCalled();
      });
    }

    it("still uses the seed on HTTP 404 (nothing saved yet) or with no content source, and live content when it loads", async () => {
      const missing = await loadContent(env, (async () => json({}, 404)) as unknown as typeof fetch, () => {});
      expect(missing).toEqual({ content: seed, source: "seed" });
      expect(await loadContent({ README_REQUIRE_LIVE_CONTENT: "1" }, vi.fn() as unknown as typeof fetch)).toEqual({ content: seed, source: "seed" });
      const live = await loadContent(env, (async () => json(seed)) as unknown as typeof fetch);
      expect(live.source).toBe("https://x.test/c.json");
    });

    it("only the exact value 1 turns it on", async () => {
      const r = await loadContent({ ...env, README_REQUIRE_LIVE_CONTENT: "0" }, (async () => json({}, 503)) as unknown as typeof fetch, () => {});
      expect(r.source).toBe("seed");
    });
  });
});

describe("SITE_URL", () => {
  it("replaces site.url with an https origin (trailing slash dropped) and leaves the seed untouched", () => {
    const warn = vi.fn();
    const before = seed.site.url;
    const c = withSiteUrl(seed, " https://example.pages.dev/ ", warn);
    expect(c.site.url).toBe("https://example.pages.dev");
    expect(c.site.title).toEqual(seed.site.title);
    expect(withSiteUrl(seed, "https://pho0m.dev:8443", warn).site.url).toBe("https://pho0m.dev:8443");
    expect(seed.site.url).toBe(before);
    expect(warn).not.toHaveBeenCalled();
  });

  it("ignores anything that is not an https origin, with a warning, and does nothing when unset", () => {
    for (const bad of ["http://example.dev", "javascript:alert(1)", "//example.dev", "example.dev", "https://", "https://x.dev/path", "https://x.dev?q=1", "https://user@x.dev"]) {
      const warn = vi.fn();
      expect(withSiteUrl(seed, bad, warn), bad).toBe(seed);
      expect(warn, bad).toHaveBeenCalledOnce();
      expect(String(warn.mock.calls[0]![0])).toContain("SITE_URL");
    }
    const warn = vi.fn();
    for (const unset of [undefined, "", "   "]) expect(withSiteUrl(seed, unset, warn)).toBe(seed);
    expect(withSiteUrl(seed, seed.site.url, warn)).toBe(seed);
    expect(warn).not.toHaveBeenCalled();
  });

  it("is applied to whatever content loads: the seed and live content", async () => {
    const fromSeed = await loadContent({ SITE_URL: "https://example.pages.dev" }, vi.fn() as unknown as typeof fetch, () => {});
    expect(fromSeed).toEqual({ content: expect.objectContaining({ site: expect.objectContaining({ url: "https://example.pages.dev" }) }), source: "seed" });
    const live = structuredClone(seed);
    live.site.url = "https://old.example";
    const r = await loadContent({ CONTENT_URL: "https://x.test/c.json", SITE_URL: "https://example.pages.dev" }, (async () => json(live)) as unknown as typeof fetch, () => {});
    expect(r.content.site.url).toBe("https://example.pages.dev");
    const warn = vi.fn();
    const ignored = await loadContent({ SITE_URL: "http://example.pages.dev" }, vi.fn() as unknown as typeof fetch, warn);
    expect(ignored.content).toBe(seed);
    expect(warn).toHaveBeenCalledOnce();
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
    expect(stats).toEqual({ login: "someone", publicRepos: 101, followers: 3, stars: 99 + 5 });
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

  it("CLI exits 1 and writes nothing when README_REQUIRE_LIVE_CONTENT=1 and the live content can't be read", async () => {
    const readme = join(dir, "README.md");
    const outDir = join(dir, "assets", "readme");
    await writeFile(readme, README_SAMPLE);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchMock = vi.fn(async () => json({}, 503));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const env = { SERVICE_ACCOUNT_BUCKET_NAME: "b", README_REQUIRE_LIVE_CONTENT: "1" };
      expect(await cli(["--out-dir", outDir, "--readme", readme], env)).toBe(1);
      expect(await cli(["--out-dir", outDir, "--readme", readme, "--check"], env)).toBe(1);
      expect(fetchMock).toHaveBeenCalledWith("https://storage.googleapis.com/b/content/site.json", expect.anything());
      expect(err.mock.calls.flat().join("\n")).toMatch(/HTTP 503.*README_REQUIRE_LIVE_CONTENT=1/);
      expect(await readFile(readme, "utf8")).toBe(README_SAMPLE);
      await expect(stat(outDir)).rejects.toThrow();
      // without the flag the same failure falls back to the seed and writes
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(await cli(["--out-dir", outDir, "--readme", readme], { SERVICE_ACCOUNT_BUCKET_NAME: "b" })).toBe(0);
      expect(warn.mock.calls.flat().join("\n")).toContain("Falling back to the seed");
      warn.mockRestore();
    } finally {
      vi.unstubAllGlobals();
      err.mockRestore();
      log.mockRestore();
    }
  });

  it("parses CLI flags", () => {
    expect(parseArgs(["--out-dir", "a", "--readme=b.md", "--check"])).toEqual({ outDir: "a", readme: "b.md", check: true, help: false });
    expect(() => parseArgs(["--nope"])).toThrow();
    expect(() => parseArgs(["--out-dir"])).toThrow();
  });

  it("CLI --check exits 1 when out of date and 0 after generating; old sections are replaced", async () => {
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
      expect(written).not.toContain("SECTION:waka");
      expect(written).toContain('srcset="assets/readme/hero-dark.svg"');
      expect(written).not.toContain("Old intro.");
    } finally {
      log.mockRestore();
      err.mockRestore();
    }
  });

  it("CLI points every site link at SITE_URL", async () => {
    const readme = join(dir, "README.md");
    const outDir = join(dir, "assets", "readme");
    const args = ["--out-dir", outDir, "--readme", readme];
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const env = { SITE_URL: "https://example.pages.dev/" };
    try {
      expect(await cli(args, env)).toBe(0);
      expect(await cli([...args, "--check"], env)).toBe(0);
      // without it the links would go back to the content's own site.url
      expect(await cli([...args, "--check"], {})).toBe(1);
      const written = await readFile(readme, "utf8");
      for (const id of ["top", "film", "skills", "diary", "documents"]) expect(written).toContain(`href="https://example.pages.dev/#${id}"`);
      expect(written).toContain('href="https://example.pages.dev"');
      expect(written).not.toContain(seed.site.url);
      expect(written).not.toContain(new URL(seed.site.url).host);
      expect(await readFile(join(outDir, "link-site-dark.svg"), "utf8")).toContain("example.pages.dev");
      expect(log.mock.calls.flat().join("\n")).toContain("site: https://example.pages.dev;");
    } finally {
      log.mockRestore();
      err.mockRestore();
    }
  });
});
