import type { Content } from "./schema.ts";

/**
 * Admin API contract (api/ implements it, web/src/admin consumes it).
 * All authenticated routes take `Authorization: Bearer <token>`.
 * Every error response is `ApiError` with an appropriate HTTP status.
 *
 *   GET    /api/health                      → HealthResponse              (public)
 *   POST   /api/auth/login   {password}     → LoginResponse               (401 wrong password, 429 too many attempts)
 *   GET    /api/auth/me                     → MeResponse
 *   GET    /api/content                     → ContentResponse             (seed + generation null when nothing saved yet)
 *   PUT    /api/content      SaveContentRequest → SaveContentResponse     (400 invalid + issues, 409 generation mismatch)
 *   GET    /api/content/history             → HistoryResponse             (newest first, max 30)
 *   GET    /api/content/history/item?path=  → { content: Content }        (path must be inside content/history/)
 *   GET    /api/media                       → MediaListResponse           (newest first)
 *   POST   /api/media        multipart/form-data: file (required), folder (optional, [a-z0-9-]{1,40})
 *                                           → 201 MediaItem               (413 too large, 415 unsupported type)
 *   DELETE /api/media?path=media/…          → { ok: true }                (only paths under media/)
 *
 * Storage layout in the bucket (SERVICE_ACCOUNT_BUCKET_NAME):
 *   content/site.json                 live content, Cache-Control: no-cache
 *   content/history/<timestamp>.json  previous versions (written on every save)
 *   media/<yyyy>/<mm>/<folder?>/<slug>-<random>.<ext>   uploads, Cache-Control: public, max-age=31536000, immutable
 * Public URL of an object: https://storage.googleapis.com/<bucket>/<path>
 */

export const CONTENT_OBJECT = "content/site.json";
export const HISTORY_PREFIX = "content/history/";
export const MEDIA_PREFIX = "media/";
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const ALLOWED_UPLOAD_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "application/pdf",
] as const;

export type ApiError = { error: string; issues?: { path: string; message: string }[] };

export type HealthResponse = {
  ok: true;
  driver: "gcs" | "local";
  bucket: string | null;
  /** Public URL of content/site.json (what the site fetches). */
  contentUrl: string | null;
  authConfigured: boolean;
};

export type LoginRequest = { password: string };
export type LoginResponse = { token: string; expiresAt: string };
export type MeResponse = { ok: true; expiresAt: string };

export type ContentResponse = {
  content: Content;
  /** Storage generation of content/site.json; null when nothing has been saved yet. */
  generation: string | null;
  url: string | null;
};
export type SaveContentRequest = { content: unknown; generation: string | null };
export type SaveContentResponse = { generation: string; updatedAt: string; url: string | null };

export type HistoryItem = { path: string; updated: string; size: number };
export type HistoryResponse = { items: HistoryItem[] };

export type MediaItem = {
  path: string;
  url: string;
  size: number;
  contentType: string;
  updated: string;
};
export type MediaListResponse = { items: MediaItem[] };
