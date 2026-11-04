/**
 * Runs after `vite build` (see web/package.json "build"): writes SEO + AI-crawler files into web/dist.
 * Content source: VITE_CONTENT_URL (the live JSON the admin publishes) when reachable and valid,
 * otherwise content/seed.json — so CI builds bake in the latest edits.
 *
 * SEO_REQUIRE_LIVE_CONTENT=1 (set by deploy.yml for content refreshes) turns "could not read the
 * live content" into a failed build instead of quietly baking the seed. A 404 is not a failure:
 * nothing has been saved from /admin yet, so the seed is the live content.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseContent, seed, type Content } from "@pho0m/content";
import { buildLlmsFull, buildLlmsTxt, buildRobots, buildSitemap, injectIntoHtml } from "./build.ts";

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

const { content, source, problem } = await loadContent();
if (problem) {
  if (process.env.SEO_REQUIRE_LIVE_CONTENT === "1") {
    console.error(`[seo] ${problem}`);
    console.error("[seo] SEO_REQUIRE_LIVE_CONTENT=1: refusing to bake the seed instead of the live content.");
    process.exit(1);
  }
  console.warn(`[seo] ${problem}; using the seed`);
}

const indexPath = `${dist}index.html`;
const html = await readFile(indexPath, "utf8");
await writeFile(indexPath, injectIntoHtml(html, content));
await writeFile(`${dist}robots.txt`, buildRobots(content));
await writeFile(`${dist}sitemap.xml`, buildSitemap(content));
await writeFile(`${dist}llms.txt`, buildLlmsTxt(content));
await writeFile(`${dist}llms-full.txt`, buildLlmsFull(content));
// For the CI run summary only; dot files are not deployed (firebase.json "ignore": "**/.*").
const note = `${source}, content updatedAt ${content.updatedAt || "unknown"}`;
await writeFile(`${dist}.seo-source`, `${note}\n`);
console.log(`[seo] wrote index.html snapshot, robots.txt, sitemap.xml, llms.txt, llms-full.txt (content: ${note})`);
