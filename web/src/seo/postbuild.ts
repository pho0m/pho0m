/**
 * Runs after `vite build` (see web/package.json "build"): writes SEO + AI-crawler files into web/dist.
 * Content source: VITE_CONTENT_URL (the live JSON the admin publishes) when reachable and valid,
 * otherwise content/seed.json — so CI builds bake in the latest edits.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseContent, seed, type Content } from "@pho0m/content";
import { buildLlmsFull, buildLlmsTxt, buildRobots, buildSitemap, injectIntoHtml } from "./build.ts";

const dist = fileURLToPath(new URL("../../dist/", import.meta.url));

async function loadContent(): Promise<{ content: Content; source: string }> {
  const url = process.env.VITE_CONTENT_URL;
  if (url) {
    try {
      const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}v=${Date.now()}`, { cache: "no-store" });
      if (res.ok) {
        const parsed = parseContent(await res.json());
        if (parsed.ok) return { content: parsed.content, source: url };
        console.warn(`[seo] live content is invalid, using seed:\n${parsed.issues.map((i) => `  ${i.path}: ${i.message}`).join("\n")}`);
      } else {
        console.warn(`[seo] ${url} → HTTP ${res.status}, using seed`);
      }
    } catch (err) {
      console.warn(`[seo] could not fetch ${url} (${(err as Error).message}), using seed`);
    }
  }
  return { content: seed, source: "content/seed.json" };
}

const { content, source } = await loadContent();
const indexPath = `${dist}index.html`;
const html = await readFile(indexPath, "utf8");
await writeFile(indexPath, injectIntoHtml(html, content));
await writeFile(`${dist}robots.txt`, buildRobots(content));
await writeFile(`${dist}sitemap.xml`, buildSitemap(content));
await writeFile(`${dist}llms.txt`, buildLlmsTxt(content));
await writeFile(`${dist}llms-full.txt`, buildLlmsFull(content));
console.log(`[seo] wrote index.html snapshot, robots.txt, sitemap.xml, llms.txt, llms-full.txt (content: ${source})`);
