import { CONTENT_OBJECT, HISTORY_PREFIX as LEGACY_HISTORY_PREFIX, MEDIA_PREFIX } from "@pho0m/content";
import {
  ConflictError,
  PreconditionFailedError,
  type HistoryEntry,
  type MediaObject,
  type ObjectInfo,
  type ObjectStore,
  type Storage,
  type StoredContent,
  type StoredText,
} from "./types.ts";

export const CONTENT_CACHE_CONTROL = "no-cache, max-age=0";
export const MEDIA_CACHE_CONTROL = "public, max-age=31536000, immutable";
/** Private objects are ciphertext; still keep them out of shared caches. */
export const PRIVATE_CACHE_CONTROL = "private, no-store";
/** Full content (drafts, hidden items), encrypted. See types.ts for the whole layout. */
export const PRIVATE_CONTENT_OBJECT = "private/content.enc";
export const PRIVATE_HISTORY_PREFIX = "private/history/";
export { LEGACY_HISTORY_PREFIX };
const PRIVATE_EXT = ".enc";
/** File names (without extension) of history objects: historyStamp() plus an optional "-N". */
export const HISTORY_NAME_RE = /^[A-Za-z0-9_-]{1,100}$/;
const JSON_TYPE = "application/json";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8");

/** "2026-11-04T09:38:12.345Z" → "2026-11-04T09-38-12-345Z" (safe in object names and URLs). */
export function historyStamp(at: Date): string {
  return at.toISOString().replace(/[:.]/g, "-");
}

function newestFirst<T extends { updated: string; path: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.updated !== b.updated) return a.updated < b.updated ? 1 : -1;
    return a.path < b.path ? 1 : a.path > b.path ? -1 : 0;
  });
}

const toHistory = (o: ObjectInfo): HistoryEntry => ({ path: o.path, updated: o.updated, size: o.size });
const toMedia = (o: ObjectInfo): MediaObject => ({
  path: o.path,
  size: o.size,
  contentType: o.contentType,
  updated: o.updated,
});

/** Content/history/media rules shared by every driver. */
export function createStorage(store: ObjectStore): Storage {
  async function listHistoryObjects(): Promise<ObjectInfo[]> {
    const all = await store.list(PRIVATE_HISTORY_PREFIX);
    // History names are ISO stamps, so name order is time order even if two share an `updated`.
    return all
      .filter((o) => o.path.endsWith(PRIVATE_EXT) && !o.path.slice(PRIVATE_HISTORY_PREFIX.length).includes("/"))
      .sort((a, b) => (a.path < b.path ? 1 : a.path > b.path ? -1 : 0));
  }

  /** Create `${base}.enc` (or `${base}-1.enc`, …) without ever overwriting an existing object. */
  async function putNewHistory(base: string, text: string): Promise<string> {
    for (let i = 0; i < 5; i++) {
      const path = i === 0 ? `${base}${PRIVATE_EXT}` : `${base}-${i}${PRIVATE_EXT}`;
      try {
        await store.put(path, encoder.encode(text), {
          contentType: JSON_TYPE,
          cacheControl: PRIVATE_CACHE_CONTROL,
          ifGenerationMatch: "0",
        });
        return path;
      } catch (err) {
        if (!(err instanceof PreconditionFailedError)) throw err;
      }
    }
    throw new Error("could not find a free history file name");
  }

  return {
    kind: store.kind,
    bucket: store.bucket,

    async readPrivate(): Promise<StoredText | null> {
      const obj = await store.get(PRIVATE_CONTENT_OBJECT);
      if (!obj) return null;
      return { generation: obj.generation, text: decoder.decode(obj.bytes) };
    },

    async writePrivate(text, ifGeneration) {
      try {
        const info = await store.put(PRIVATE_CONTENT_OBJECT, encoder.encode(text), {
          contentType: JSON_TYPE,
          cacheControl: PRIVATE_CACHE_CONTROL,
          ifGenerationMatch: ifGeneration ?? "0",
        });
        return { generation: info.generation, updated: info.updated };
      } catch (err) {
        if (err instanceof PreconditionFailedError) {
          const live = await store.get(PRIVATE_CONTENT_OBJECT).catch(() => null);
          throw new ConflictError(ifGeneration, live?.generation ?? null);
        }
        throw err;
      }
    },

    async readContent(): Promise<StoredContent | null> {
      const obj = await store.get(CONTENT_OBJECT);
      if (!obj) return null;
      const text = decoder.decode(obj.bytes);
      let json: StoredContent["json"];
      try {
        json = { ok: true, value: JSON.parse(text) as unknown };
      } catch (err) {
        json = { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      return { generation: obj.generation, text, json };
    },

    async writeContent(json) {
      const info = await store.put(CONTENT_OBJECT, encoder.encode(json), {
        contentType: JSON_TYPE,
        cacheControl: CONTENT_CACHE_CONTROL,
      });
      return { generation: info.generation, updated: info.updated };
    },

    writeHistory(text, at) {
      // Two saves in the same millisecond are practically impossible, but never overwrite history.
      return putNewHistory(`${PRIVATE_HISTORY_PREFIX}${historyStamp(at)}`, text);
    },

    async listHistory() {
      return (await listHistoryObjects()).map(toHistory);
    },

    async readHistory(path) {
      const obj = await store.get(path);
      return obj ? decoder.decode(obj.bytes) : null;
    },

    async pruneHistory(keep) {
      const items = await listHistoryObjects();
      const stale = items.slice(Math.max(0, keep));
      let deleted = 0;
      for (const item of stale) {
        if (await store.delete(item.path)) deleted++;
      }
      return deleted;
    },

    async migrateLegacyHistory(sealText) {
      const legacy = (await store.list(LEGACY_HISTORY_PREFIX)).filter((o) => o.path.endsWith(".json"));
      let moved = 0;
      for (const item of legacy) {
        const name = item.path.slice(LEGACY_HISTORY_PREFIX.length, -".json".length);
        // Only names this API wrote (ISO stamps); anything else is left alone.
        if (!HISTORY_NAME_RE.test(name)) continue;
        const obj = await store.get(item.path);
        if (!obj) continue; // deleted meanwhile
        try {
          await store.put(`${PRIVATE_HISTORY_PREFIX}${name}${PRIVATE_EXT}`, encoder.encode(sealText(decoder.decode(obj.bytes))), {
            contentType: JSON_TYPE,
            cacheControl: PRIVATE_CACHE_CONTROL,
            ifGenerationMatch: "0",
          });
        } catch (err) {
          // Already moved by an earlier run that stopped before deleting the plaintext.
          if (!(err instanceof PreconditionFailedError)) throw err;
        }
        await store.delete(item.path);
        moved++;
      }
      return moved;
    },

    async uploadMedia(path, bytes, contentType) {
      if (!path.startsWith(MEDIA_PREFIX)) throw new Error(`media path must start with ${MEDIA_PREFIX}`);
      const info = await store.put(path, bytes, {
        contentType,
        cacheControl: MEDIA_CACHE_CONTROL,
        ifGenerationMatch: "0",
      });
      return toMedia(info);
    },

    async listMedia() {
      return newestFirst(await store.list(MEDIA_PREFIX)).map(toMedia);
    },

    deleteMedia(path) {
      if (!path.startsWith(MEDIA_PREFIX)) return Promise.resolve(false);
      return store.delete(path);
    },

    publicUrl: (path) => store.publicUrl(path),
    getObject: (path) => store.get(path),
  };
}
