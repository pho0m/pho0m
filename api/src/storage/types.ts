/**
 * Two layers:
 *  - ObjectStore: a tiny bucket abstraction (get/put/list/delete with generation preconditions).
 *    Implemented by gcs.ts, local.ts and memory.ts.
 *  - Storage: what the routes use (content, history, media), built once on top of any
 *    ObjectStore by createStorage() in ./storage.ts, so all drivers share the same rules.
 */

export type ObjectInfo = {
  path: string;
  size: number;
  contentType: string;
  /** ISO timestamp of the last write. */
  updated: string;
  /** Monotonic version string (GCS object generation). */
  generation: string;
};

export type StoredObject = ObjectInfo & { bytes: Uint8Array<ArrayBuffer> };

export type PutOptions = {
  contentType: string;
  cacheControl: string;
  /**
   * Write only if the live object has this generation. "0" means the object must not exist yet
   * (same meaning as GCS ifGenerationMatch=0). Omit for an unconditional write.
   */
  ifGenerationMatch?: string;
};

export interface ObjectStore {
  readonly kind: "gcs" | "local";
  readonly bucket: string | null;
  get(path: string): Promise<StoredObject | null>;
  /** Throws PreconditionFailedError when ifGenerationMatch does not hold. */
  put(path: string, bytes: Uint8Array, opts: PutOptions): Promise<ObjectInfo>;
  /** Every object whose path starts with prefix (any order). */
  list(prefix: string): Promise<ObjectInfo[]>;
  /** false when the object did not exist. */
  delete(path: string): Promise<boolean>;
  publicUrl(path: string): string;
}

export class PreconditionFailedError extends Error {
  override readonly name = "PreconditionFailedError";
  constructor(readonly path: string) {
    super(`generation precondition failed for ${path}`);
  }
}

/** The stored live content. `json` is a result because a hand-edited object may not be JSON. */
export type StoredContent = {
  generation: string;
  /** Raw text, so history copies keep the previous version byte-for-byte. */
  text: string;
  json: { ok: true; value: unknown } | { ok: false; error: string };
};

export class ConflictError extends Error {
  override readonly name = "ConflictError";
  constructor(
    /** Generation the client based its edit on. */
    readonly expected: string | null,
    /** Generation that is live now (null = nothing stored). */
    readonly actual: string | null,
  ) {
    super("content was saved elsewhere since it was loaded");
  }
}

export type HistoryEntry = { path: string; updated: string; size: number };
export type MediaObject = { path: string; size: number; contentType: string; updated: string };

export interface Storage {
  readonly kind: "gcs" | "local";
  readonly bucket: string | null;
  /** null when content/site.json does not exist yet. */
  readContent(): Promise<StoredContent | null>;
  /**
   * Write content/site.json only if its generation is still `ifGeneration`
   * (null → it must not exist). Throws ConflictError otherwise.
   */
  writeContent(json: string, ifGeneration: string | null): Promise<{ generation: string; updated: string }>;
  /** Store a copy of a previous live version under content/history/. Returns its path. */
  writeHistory(text: string, at: Date): Promise<string>;
  /** Newest first. */
  listHistory(): Promise<HistoryEntry[]>;
  /** Raw text of one history object, or null when missing. Caller validates the path. */
  readHistory(path: string): Promise<string | null>;
  /** Keep the newest `keep` history objects, delete the rest. Returns how many were deleted. */
  pruneHistory(keep: number): Promise<number>;
  /** Must not overwrite: the path is new (random suffix). */
  uploadMedia(path: string, bytes: Uint8Array, contentType: string): Promise<MediaObject>;
  /** Newest first. */
  listMedia(): Promise<MediaObject[]>;
  /** false when it did not exist. */
  deleteMedia(path: string): Promise<boolean>;
  publicUrl(path: string): string;
  /** Raw object read (used to serve files in local mode). */
  getObject(path: string): Promise<StoredObject | null>;
}
