import { Storage as GcsClient, type File } from "@google-cloud/storage";
import type { ServiceAccountKey } from "../config.ts";
import { PreconditionFailedError, type ObjectInfo, type ObjectStore, type StoredObject } from "./types.ts";

/** Google Cloud Storage driver. Objects are read publicly via https://storage.googleapis.com/<bucket>/<path>. */

export function gcsClient(credentials: ServiceAccountKey | null): GcsClient {
  if (!credentials) return new GcsClient(); // Application Default Credentials (Cloud Run service account)
  return new GcsClient({
    projectId: credentials.project_id,
    credentials: { client_email: credentials.client_email, private_key: credentials.private_key },
  });
}

export function errorCode(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  const code = (err as { code?: unknown }).code;
  if (typeof code === "number") return code;
  if (typeof code === "string" && /^\d+$/.test(code)) return Number(code);
  return null;
}

export function gcsPublicUrl(bucket: string, path: string): string {
  return `https://storage.googleapis.com/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

function toInfo(file: File): ObjectInfo {
  const m = file.metadata;
  return {
    path: file.name,
    size: Number(m.size ?? 0),
    contentType: m.contentType ?? "application/octet-stream",
    updated: m.updated ?? m.timeCreated ?? new Date(0).toISOString(),
    generation: String(m.generation ?? ""),
  };
}

export function createGcsStore(opts: { bucket: string; credentials: ServiceAccountKey | null; client?: GcsClient }): ObjectStore {
  const client = opts.client ?? gcsClient(opts.credentials);
  const bucket = client.bucket(opts.bucket);

  return {
    kind: "gcs",
    bucket: opts.bucket,

    async get(path) {
      // Read metadata, then download exactly that generation so bytes and generation agree.
      for (let attempt = 0; attempt < 3; attempt++) {
        let meta;
        try {
          [meta] = await bucket.file(path).getMetadata();
        } catch (err) {
          if (errorCode(err) === 404) return null;
          throw err;
        }
        const generation = meta.generation;
        try {
          const [buf] = await bucket.file(path, { generation }).download();
          const out: StoredObject = {
            path,
            size: buf.byteLength,
            contentType: meta.contentType ?? "application/octet-stream",
            updated: meta.updated ?? new Date(0).toISOString(),
            generation: String(generation ?? ""),
            bytes: new Uint8Array(buf),
          };
          return out;
        } catch (err) {
          // Replaced between the two calls: try again with the new generation.
          if (errorCode(err) === 404) continue;
          throw err;
        }
      }
      return null;
    },

    async put(path, bytes, o) {
      const file = bucket.file(path);
      try {
        await file.save(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), {
          resumable: false,
          contentType: o.contentType,
          metadata: { contentType: o.contentType, cacheControl: o.cacheControl },
          ...(o.ifGenerationMatch !== undefined ? { preconditionOpts: { ifGenerationMatch: o.ifGenerationMatch } } : {}),
        });
      } catch (err) {
        if (errorCode(err) === 412) throw new PreconditionFailedError(path);
        throw err;
      }
      if (file.metadata.generation === undefined) await file.getMetadata();
      const info = toInfo(file);
      return { ...info, size: info.size || bytes.byteLength };
    },

    async list(prefix) {
      const [files] = await bucket.getFiles({ prefix, autoPaginate: true });
      return files.filter((f) => !f.name.endsWith("/")).map(toInfo);
    },

    async delete(path) {
      try {
        await bucket.file(path).delete();
        return true;
      } catch (err) {
        if (errorCode(err) === 404) return false;
        throw err;
      }
    },

    publicUrl: (path) => gcsPublicUrl(opts.bucket, path),
  };
}
