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

/** The stored public content. `json` is a result because a hand-edited object may not be JSON. */
export type StoredContent = {
  generation: string;
  /** Raw text, so a legacy full copy can be moved into history byte-for-byte. */
  text: string;
  json: { ok: true; value: unknown } | { ok: false; error: string };
};

/** A private object as stored: the raw (encrypted envelope) text and its generation. */
export type StoredText = { generation: string; text: string };

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

/**
 * Object layout (the bucket is publicly readable, so private data is only ever stored encrypted;
 * encryption itself happens in the app, see content-crypto.ts):
 *   private/content.enc            full content incl. drafts and hidden items (encrypted envelope).
 *                                  Its generation is the one the admin sees and the conflict check uses.
 *   private/history/<stamp>.enc    previous full versions (encrypted envelopes), newest 50 kept
 *   content/site.json              public projection only (plain JSON, what the site reads)
 *   content/history/<stamp>.json   legacy plaintext history from before encryption; moved by
 *                                  migrateLegacyHistory() and never written any more
 */
export interface Storage {
  readonly kind: "gcs" | "local";
  readonly bucket: string | null;
  /** private/content.enc as stored (envelope text), or null when it does not exist yet. */
  readPrivate(): Promise<StoredText | null>;
  /**
   * Write private/content.enc only if its generation is still `ifGeneration`
   * (null → it must not exist). Throws ConflictError otherwise.
   */
  writePrivate(text: string, ifGeneration: string | null): Promise<{ generation: string; updated: string }>;
  /** content/site.json, or null when it does not exist yet. */
  readContent(): Promise<StoredContent | null>;
  /** Replace content/site.json (public projection; no precondition, the private write is the check). */
  writeContent(json: string): Promise<{ generation: string; updated: string }>;
  /** Store an (encrypted) previous version under private/history/. Returns its path. */
  writeHistory(text: string, at: Date): Promise<string>;
  /** Newest first. */
  listHistory(): Promise<HistoryEntry[]>;
  /** Raw text of one history object, or null when missing. Caller validates the path. */
  readHistory(path: string): Promise<string | null>;
  /** Keep the newest `keep` history objects, delete the rest. Returns how many were deleted. */
  pruneHistory(keep: number): Promise<number>;
  /**
   * Move legacy plaintext history (content/history/*.json) to private/history/<same stamp>.enc,
   * passing each through `seal`, then delete the plaintext. Returns how many were moved.
   */
  migrateLegacyHistory(seal: (text: string) => string): Promise<number>;
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
