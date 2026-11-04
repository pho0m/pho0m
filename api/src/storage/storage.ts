import { CONTENT_OBJECT, HISTORY_PREFIX, MEDIA_PREFIX } from "@pho0m/content";
import {
  ConflictError,
  PreconditionFailedError,
  type HistoryEntry,
  type MediaObject,
  type ObjectInfo,
  type ObjectStore,
  type Storage,
  type StoredContent,
} from "./types.ts";

export const CONTENT_CACHE_CONTROL = "no-cache, max-age=0";
export const MEDIA_CACHE_CONTROL = "public, max-age=31536000, immutable";
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
    const all = await store.list(HISTORY_PREFIX);
    // History names are ISO stamps, so name order is time order even if two share an `updated`.
    return all
      .filter((o) => o.path.endsWith(".json"))
      .sort((a, b) => (a.path < b.path ? 1 : a.path > b.path ? -1 : 0));
  }

  return {
    kind: store.kind,
    bucket: store.bucket,

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

    async writeContent(json, ifGeneration) {
      try {
        const info = await store.put(CONTENT_OBJECT, encoder.encode(json), {
          contentType: JSON_TYPE,
          cacheControl: CONTENT_CACHE_CONTROL,
          ifGenerationMatch: ifGeneration ?? "0",
        });
        return { generation: info.generation, updated: info.updated };
      } catch (err) {
        if (err instanceof PreconditionFailedError) {
          const live = await store.get(CONTENT_OBJECT).catch(() => null);
          throw new ConflictError(ifGeneration, live?.generation ?? null);
        }
        throw err;
      }
    },

    async writeHistory(text, at) {
      const base = `${HISTORY_PREFIX}${historyStamp(at)}`;
      // Two saves in the same millisecond are practically impossible, but never overwrite history.
      for (let i = 0; i < 5; i++) {
        const path = i === 0 ? `${base}.json` : `${base}-${i}.json`;
        try {
          await store.put(path, encoder.encode(text), {
            contentType: JSON_TYPE,
            cacheControl: CONTENT_CACHE_CONTROL,
            ifGenerationMatch: "0",
          });
          return path;
        } catch (err) {
          if (!(err instanceof PreconditionFailedError)) throw err;
        }
      }
      throw new Error("could not find a free history file name");
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
