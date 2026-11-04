import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GENERATED_FILE, type Output } from "./generate.ts";

export type Plan = {
  /** files (absolute paths) whose content would be created or changed */
  changed: string[];
  /** stale generated SVGs (absolute paths) that would be deleted */
  removed: string[];
};

async function readOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

/** Compare the output with what is on disk. Only files matching GENERATED_FILE are ever removed. */
export async function plan(out: Output, outDir: string, readmePath: string): Promise<Plan> {
  const changed: string[] = [];
  for (const [name, svg] of out.files) {
    const path = join(outDir, name);
    if ((await readOrNull(path)) !== svg) changed.push(path);
  }
  if ((await readOrNull(readmePath)) !== out.readme) changed.push(readmePath);
  let existing: string[] = [];
  try {
    existing = await readdir(outDir);
  } catch {
    existing = [];
  }
  const removed = existing
    .filter((f) => GENERATED_FILE.test(f) && !out.files.has(f))
    .sort()
    .map((f) => join(outDir, f));
  return { changed, removed };
}

/** Write changed files and delete stale ones. Returns what was done. */
export async function apply(out: Output, outDir: string, readmePath: string): Promise<Plan> {
  const p = await plan(out, outDir, readmePath);
  await mkdir(outDir, { recursive: true });
  for (const [name, svg] of out.files) {
    const path = join(outDir, name);
    if (p.changed.includes(path)) await writeFile(path, svg);
  }
  if (p.changed.includes(readmePath)) await writeFile(readmePath, out.readme);
  for (const path of p.removed) await rm(path);
  return p;
}
