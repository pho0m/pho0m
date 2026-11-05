import { PreconditionFailedError, type ObjectInfo, type ObjectStore, type StoredObject } from "./types.ts";

type Entry = { bytes: Uint8Array; info: ObjectInfo; cacheControl: string };

export type MemoryStore = ObjectStore & {
  /** Test helper: inspect what was written (including Cache-Control). */
  peek(path: string): { bytes: Uint8Array; info: ObjectInfo; cacheControl: string } | undefined;
  /** Test helper: every stored path. */
  paths(): string[];
};

/** In-process object store for tests. Behaves like GCS for generations and preconditions. */
export function createMemoryStore(
  opts: { now?: () => Date; baseUrl?: string } = {},
): MemoryStore {
  const now = opts.now ?? (() => new Date());
  const baseUrl = (opts.baseUrl ?? "https://storage.test/bucket").replace(/\/+$/, "");
  const objects = new Map<string, Entry>();
  let counter = 1_000_000;

  return {
    kind: "local",
    bucket: null,

    async get(path) {
      const e = objects.get(path);
      if (!e) return null;
      const out: StoredObject = { ...e.info, bytes: e.bytes.slice() };
      return out;
    },

    async put(path, bytes, o) {
      const current = objects.get(path);
      if (o.ifGenerationMatch !== undefined) {
        const live = current?.info.generation ?? "0";
        if (live !== o.ifGenerationMatch) throw new PreconditionFailedError(path);
      }
      counter += 1;
      const info: ObjectInfo = {
        path,
        size: bytes.byteLength,
        contentType: o.contentType,
        updated: now().toISOString(),
        generation: String(counter),
      };
      objects.set(path, { bytes: bytes.slice(), info, cacheControl: o.cacheControl });
      return { ...info };
    },

    async list(prefix) {
      return [...objects.values()].filter((e) => e.info.path.startsWith(prefix)).map((e) => ({ ...e.info }));
    },

    async delete(path) {
      return objects.delete(path);
    },

    publicUrl(path) {
      return `${baseUrl}/${path.split("/").map(encodeURIComponent).join("/")}`;
    },

    peek(path) {
      return objects.get(path);
    },

    paths() {
      return [...objects.keys()].sort();
    },
  };
}
