import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { PreconditionFailedError, type ObjectInfo, type ObjectStore, type StoredObject } from "./types.ts";

/**
 * Local-disk object store for development without GCP.
 * Objects live at <dataDir>/<path>; metadata (generation, content type, cache control) in a
 * sidecar at <dataDir>/.meta/<path>.json. Writes are serialised in-process, which is enough
 * for a single dev server.
 */

const META_DIR = ".meta";

type Meta = { generation: string; contentType: string; cacheControl: string; updated: string };

const EXT_TYPES: Record<string, string> = {
  ".json": "application/json",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".pdf": "application/pdf",
};

export function contentTypeForPath(p: string): string {
  return EXT_TYPES[path.extname(p).toLowerCase()] ?? "application/octet-stream";
}

/** Object paths are relative, slash-separated, without "..", and never inside the meta folder. */
export function isSafeObjectPath(p: string): boolean {
  if (!p || p.length > 512) return false;
  if (p.startsWith("/") || p.includes("\\") || p.includes("\0")) return false;
  const parts = p.split("/");
  if (parts.some((s) => s === "" || s === "." || s === "..")) return false;
  return parts[0] !== META_DIR;
}

export type LocalStore = ObjectStore & { readonly dataDir: string };

export function createLocalStore(opts: { dataDir: string; publicBaseUrl: string }): LocalStore {
  const root = path.resolve(opts.dataDir);
  const baseUrl = opts.publicBaseUrl.replace(/\/+$/, "");
  let lastGeneration = 0n;
  let queue: Promise<unknown> = Promise.resolve();

  /** Run writes one at a time so check-then-write on generations is atomic within this process. */
  function serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  }

  function resolve(p: string): { file: string; meta: string } {
    if (!isSafeObjectPath(p)) throw new Error(`unsafe object path: ${JSON.stringify(p)}`);
    const file = path.resolve(root, p);
    const meta = path.resolve(root, META_DIR, `${p}.json`);
    if (!file.startsWith(root + path.sep) || !meta.startsWith(path.join(root, META_DIR) + path.sep)) {
      throw new Error(`path escapes the data dir: ${JSON.stringify(p)}`);
    }
    return { file, meta };
  }

  function nextGeneration(after: string | undefined): string {
    let g = BigInt(Date.now()) * 1000n;
    const floor = after && /^\d+$/.test(after) ? BigInt(after) : 0n;
    if (g <= lastGeneration) g = lastGeneration + 1n;
    if (g <= floor) g = floor + 1n;
    lastGeneration = g;
    return g.toString();
  }

  async function readMeta(metaFile: string): Promise<Meta | null> {
    try {
      const m = JSON.parse(await fs.readFile(metaFile, "utf8")) as Partial<Meta>;
      if (typeof m.generation !== "string") return null;
      return {
        generation: m.generation,
        contentType: typeof m.contentType === "string" ? m.contentType : "",
        cacheControl: typeof m.cacheControl === "string" ? m.cacheControl : "",
        updated: typeof m.updated === "string" ? m.updated : "",
      };
    } catch {
      return null;
    }
  }

  async function info(p: string): Promise<ObjectInfo | null> {
    const { file, meta } = resolve(p);
    let st;
    try {
      st = await fs.stat(file);
    } catch {
      return null;
    }
    if (!st.isFile()) return null;
    const m = await readMeta(meta);
    return {
      path: p,
      size: st.size,
      contentType: m?.contentType || contentTypeForPath(p),
      updated: m?.updated || st.mtime.toISOString(),
      generation: m?.generation ?? String(Math.trunc(st.mtimeMs * 1000)),
    };
  }

  async function writeAtomic(file: string, data: Uint8Array | string): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${randomBytes(4).toString("hex")}`;
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, file);
  }

  async function walk(dir: string, rel: string, out: string[]): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.includes(".tmp-")) continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (!rel && e.name === META_DIR) continue;
      if (e.isDirectory()) await walk(path.join(dir, e.name), childRel, out);
      else if (e.isFile()) out.push(childRel);
    }
  }

  return {
    kind: "local",
    bucket: null,
    dataDir: root,

    async get(p) {
      const i = await info(p);
      if (!i) return null;
      const bytes = new Uint8Array(await fs.readFile(resolve(p).file));
      const out: StoredObject = { ...i, size: bytes.byteLength, bytes };
      return out;
    },

    put(p, bytes, o) {
      return serial(async () => {
        const { file, meta } = resolve(p);
        const current = await info(p);
        if (o.ifGenerationMatch !== undefined) {
          const live = current?.generation ?? "0";
          if (live !== o.ifGenerationMatch) throw new PreconditionFailedError(p);
        }
        const m: Meta = {
          generation: nextGeneration(current?.generation),
          contentType: o.contentType,
          cacheControl: o.cacheControl,
          updated: new Date().toISOString(),
        };
        await writeAtomic(file, bytes);
        await writeAtomic(meta, JSON.stringify(m));
        return { path: p, size: bytes.byteLength, contentType: m.contentType, updated: m.updated, generation: m.generation };
      });
    },

    async list(prefix) {
      const slash = prefix.lastIndexOf("/");
      const dirRel = slash >= 0 ? prefix.slice(0, slash) : "";
      if (dirRel && !isSafeObjectPath(dirRel)) return [];
      const files: string[] = [];
      await walk(dirRel ? path.join(root, dirRel) : root, dirRel, files);
      const out: ObjectInfo[] = [];
      for (const f of files) {
        if (!f.startsWith(prefix)) continue;
        const i = await info(f);
        if (i) out.push(i);
      }
      return out;
    },

    delete(p) {
      return serial(async () => {
        const { file, meta } = resolve(p);
        try {
          await fs.unlink(file);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
          throw err;
        }
        await fs.rm(meta, { force: true });
        return true;
      });
    },

    publicUrl(p) {
      return `${baseUrl}/files/${p.split("/").map(encodeURIComponent).join("/")}`;
    },
  };
}
