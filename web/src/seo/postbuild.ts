/**
 * Runs after `vite build` (see web/package.json "build"): writes SEO + AI-crawler files into web/dist:
 * index.html (Thai first, "/") and en/index.html (English first, "/en/") with head tags, the static
 * snapshot and the content as JSON, plus robots.txt, sitemap.xml, llms.txt and llms-full.txt.
 * Content source: VITE_CONTENT_URL (the live JSON the admin publishes) when reachable and valid,
 * otherwise content/seed.json — so CI builds bake in the latest edits. Only the public projection
 * of that content is baked (buildSiteFiles applies publicProjection).
 *
 * SITE_URL (e.g. https://pho0m.kiattiphoom.workers.dev or a custom domain) overrides content.site.url, so
 * canonical, hreflang, Open Graph, sitemap.xml and llms.txt point at where the site is deployed.
 *
 * SEO_REQUIRE_LIVE_CONTENT=1 (set by deploy.yml for content refreshes) turns "could not read the
 * live content" into a failed build instead of quietly baking the seed. A 404 is not a failure:
 * nothing has been saved from /admin yet, so the seed is the live content.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseContent, type Content } from "@pho0m/content";
import { seed } from "@pho0m/content/seed";
import { buildSiteFiles, withSiteUrl } from "./build.ts";

const dist = fileURLToPath(new URL("../../dist/", import.meta.url));
const FETCH_TIMEOUT_MS = 20_000;

type Loaded = { content: Content; source: string; problem?: string };

async function loadContent(): Promise<Loaded> {
  const url = process.env.VITE_CONTENT_URL?.trim();
  if (!url) return { content: seed, source: "content/seed.json (VITE_CONTENT_URL not set)" };
  let problem: string;
  try {
    const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}v=${Date.now()}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status === 404) {
      return { content: seed, source: `content/seed.json (${url} does not exist yet: nothing saved from /admin)` };
    }
    if (res.ok) {
      const parsed = parseContent(await res.json());
      if (parsed.ok) return { content: parsed.content, source: url };
      problem = `live content is invalid:\n${parsed.issues.map((i) => `  ${i.path}: ${i.message}`).join("\n")}`;
    } else {
      problem = `${url} → HTTP ${res.status}`;
    }
  } catch (err) {
    problem = `could not fetch ${url} (${(err as Error).message})`;
  }
  return { content: seed, source: "content/seed.json (live content unavailable)", problem };
}

const loaded = await loadContent();
const { source, problem } = loaded;
const site = withSiteUrl(loaded.content, process.env.SITE_URL);
if (site.warning) console.warn(`[seo] ${site.warning}`);
const content = site.content;
if (problem) {
  if (process.env.SEO_REQUIRE_LIVE_CONTENT === "1") {
    console.error(`[seo] ${problem}`);
    console.error("[seo] SEO_REQUIRE_LIVE_CONTENT=1: refusing to bake the seed instead of the live content.");
    process.exit(1);
  }
  console.warn(`[seo] ${problem}; using the seed`);
}

// The app shell Vite wrote (or an earlier run's output: injecting is repeatable).
const html = await readFile(`${dist}index.html`, "utf8");
const files = buildSiteFiles(html, content);
for (const [path, text] of Object.entries(files)) {
  const target = `${dist}${path}`;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, text);
}
// For the CI run summary only. Written next to dist (not inside it) so it is never deployed.
const note = `${source}, site ${content.site.url}, content updatedAt ${content.updatedAt || "unknown"}`;
await writeFile(fileURLToPath(new URL("../../.seo-source", import.meta.url)), `${note}\n`);
console.log(`[seo] wrote ${Object.keys(files).join(", ")} (content: ${note})`);
