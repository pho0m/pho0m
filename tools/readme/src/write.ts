import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GENERATED_FILE, type Output } from "./generate.ts";

export type Plan = {
  /** files (absolute paths) whose content would be created or changed */
  changed: string[];
  /** stale generated SVGs (absolute paths) that would be deleted */
  removed: string[];
};

async function readOrNull(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

const same = (disk: Buffer | null, data: string | Uint8Array) =>
  disk !== null && disk.equals(typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data.buffer, data.byteOffset, data.byteLength));

/** Every file the output holds: SVG cards and binary assets. */
function outputs(out: Output): [string, string | Uint8Array][] {
  return [...out.files, ...out.binaries];
}

/** Compare the output with what is on disk (byte for byte). Only files matching GENERATED_FILE are ever removed. */
export async function plan(out: Output, outDir: string, readmePath: string): Promise<Plan> {
  const changed: string[] = [];
  for (const [name, data] of outputs(out)) {
    const path = join(outDir, name);
    if (!same(await readOrNull(path), data)) changed.push(path);
  }
  if (!same(await readOrNull(readmePath), out.readme)) changed.push(readmePath);
  let existing: string[] = [];
  try {
    existing = await readdir(outDir);
  } catch {
    existing = [];
  }
  const removed = existing
    .filter((f) => GENERATED_FILE.test(f) && !out.files.has(f) && !out.binaries.has(f))
    .sort()
    .map((f) => join(outDir, f));
  return { changed, removed };
}

/** Write changed files and delete stale ones. Returns what was done. */
export async function apply(out: Output, outDir: string, readmePath: string): Promise<Plan> {
  const p = await plan(out, outDir, readmePath);
  await mkdir(outDir, { recursive: true });
  for (const [name, data] of outputs(out)) {
    const path = join(outDir, name);
    if (p.changed.includes(path)) await writeFile(path, data);
  }
  if (p.changed.includes(readmePath)) await writeFile(readmePath, out.readme);
  for (const path of p.removed) await rm(path);
  return p;
}
