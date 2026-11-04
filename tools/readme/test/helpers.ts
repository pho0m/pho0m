import { join } from "node:path";
import { seed, type Content } from "@pho0m/content";
import { generate, type GenerateInput, type Output } from "../src/generate.ts";
import { createMediaLoader } from "../src/media.ts";
import { repoRoot } from "../src/paths.ts";

export const ROOT = repoRoot();

export const WAKA_SAMPLE = [
  "<!--START_SECTION:waka-->",
  "",
  "```txt",
  "Markdown     6 hrs 9 mins          ████████████░░░░░░░░░░░░░   47.57 %",
  "TypeScript   1 hr 26 mins          ██▓░░░░░░░░░░░░░░░░░░░░░░   11.19 %   ",
  "Weird        <b>&amp;</b> | * _ `  ░░░░░░░░░░░░░░░░░░░░░░░░░   00.01 %",
  "```",
  "",
  "<!--END_SECTION:waka-->",
].join("\n");

export const README_SAMPLE = `# Hi\n\nOld intro.\n\n${WAKA_SAMPLE}\n\nOld footer.\n`;

export function clone(content: Content = seed): Content {
  return structuredClone(content);
}

export async function run(overrides: Partial<GenerateInput> = {}): Promise<Output> {
  const content = overrides.content ?? seed;
  return generate({
    content,
    github: null,
    media: createMediaLoader({ publicDir: join(ROOT, "web", "public"), siteUrl: content.site.url, warn: () => {} }),
    currentReadme: README_SAMPLE,
    assetPath: "assets/readme",
    warn: () => {},
    ...overrides,
  });
}

/** Relative asset paths referenced from README markdown (src= and srcset=). */
export function referencedAssets(readme: string): string[] {
  const out = new Set<string>();
  for (const m of readme.matchAll(/\b(?:src|srcset)="([^"]+)"/g)) {
    const url = m[1]!;
    if (!/^[a-z]+:/i.test(url)) out.add(url);
  }
  return [...out];
}
