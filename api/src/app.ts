import { Hono, type Context, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import {
  ALLOWED_UPLOAD_TYPES,
  CONTENT_OBJECT,
  MAX_UPLOAD_BYTES,
  parseContent,
  seed,
  type ApiError,
  type ContentResponse,
  type HealthResponse,
  type HistoryResponse,
  type LoginResponse,
  type MediaItem,
  type MediaListResponse,
  type MeResponse,
  type SaveContentResponse,
} from "@pho0m/content";
import type { Config } from "./config.ts";
import {
  bearer,
  clientKey,
  GLOBAL_LOGIN_MAX_FAILURES,
  issueToken,
  LOGIN_WINDOW_MS,
  LoginLimiter,
  passwordMatches,
  verifyToken,
} from "./auth.ts";
import { FOLDER_RE, isDeletableMediaPath, mediaPath, sniffType } from "./media.ts";
import type { Redeployer } from "./redeploy.ts";
import { CONTENT_CACHE_CONTROL, MEDIA_CACHE_CONTROL } from "./storage/storage.ts";
import { ConflictError, PreconditionFailedError, type Storage } from "./storage/types.ts";

export const JSON_BODY_LIMIT = 2 * 1024 * 1024;
export const HISTORY_KEEP = 50;
export const HISTORY_LIST_MAX = 30;
/** Multipart overhead allowance on top of the file size limit. */
const UPLOAD_BODY_LIMIT = MAX_UPLOAD_BYTES + 1024 * 1024;
const HISTORY_ITEM_RE = /^content\/history\/[A-Za-z0-9_-]{1,100}\.json$/;
const LOCAL_FILE_RE = /^(content|media)\/[A-Za-z0-9/_.-]+$/;

export type Logger = Pick<Console, "error" | "warn">;

export type AppDeps = {
  config: Config;
  storage: Storage;
  /** Injectable clock (tests). */
  now?: () => Date;
  logger?: Logger;
  /** Told after every successful save (GitHub repository_dispatch → site rebuild). Optional. */
  redeploy?: Redeployer | null;
};

type Env = {
  /** @hono/node-server passes the Node request as env.incoming. */
  Bindings: { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  Variables: { tokenExp: number };
};

const SaveRequest = z.object({
  content: z.unknown(),
  generation: z
    .string()
    .regex(/^\d{1,30}$/, "generation must be a number string or null")
    .nullable(),
});
const LoginBody = z.object({ password: z.string().max(1024) });

function fail(
  c: Context,
  status: ContentfulStatusCode,
  error: string,
  extra: Partial<ApiError> & Record<string, unknown> = {},
): Response {
  return c.json({ error, ...extra } satisfies ApiError, status);
}

function clientIp(c: Context<Env>): string {
  return clientKey(c.req.header("x-forwarded-for"), c.env?.incoming?.socket?.remoteAddress);
}

/** Key of the limiter that counts failures from every address together. */
const ALL_CLIENTS = "*";

function zodIssues(err: z.ZodError): { path: string; message: string }[] {
  return err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

export function createApp(deps: AppDeps): Hono<Env> {
  const { config, storage } = deps;
  const now = deps.now ?? (() => new Date());
  const log: Logger = deps.logger ?? console;
  const redeploy = deps.redeploy ?? null;
  const limiter = new LoginLimiter();
  const globalLimiter = new LoginLimiter(GLOBAL_LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS);
  const app = new Hono<Env>();
  const contentUrl = storage.publicUrl(CONTENT_OBJECT);

  const tooLarge = (max: string) => (c: Context) => fail(c, 413, `request body is too large (max ${max})`);

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return fail(c, err.status as ContentfulStatusCode, err.message || "request failed");
    }
    log.error("[api] unhandled error:", err instanceof Error ? (err.stack ?? err.message) : err);
    return fail(c, 500, "internal server error");
  });
  app.notFound((c) => fail(c, 404, `not found: ${c.req.method} ${c.req.path}`));

  app.use("*", async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
  });

  app.use(
    "/api/*",
    cors({
      origin: (origin) => (config.allowedOrigins.includes(origin) ? origin : null),
      allowMethods: ["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Authorization", "Content-Type", "Accept"],
      exposeHeaders: ["Retry-After"],
      maxAge: 600,
    }),
  );
  app.use("/api/*", async (c, next) => {
    await next();
    if (!c.res.headers.has("Cache-Control")) c.header("Cache-Control", "no-store");
  });

  const requireAuth: MiddlewareHandler<Env> = async (c, next) => {
    const token = bearer(c.req.header("authorization"));
    if (!token) return fail(c, 401, "missing bearer token");
    const ok = await verifyToken(token, config.sessionSecret, now());
    if (!ok) return fail(c, 401, "invalid or expired token");
    c.set("tokenExp", ok.exp);
    await next();
  };
  // In Hono "/x/*" also matches "/x" itself.
  for (const p of ["/api/auth/me", "/api/content/*", "/api/media/*"]) {
    app.use(p, requireAuth);
  }

  // ---- public -------------------------------------------------------------------------------

  app.get("/", (c) => c.json({ ok: true, service: "pho0m admin api", health: "/api/health" }));

  app.get("/api/health", (c) =>
    c.json({
      ok: true,
      driver: storage.kind,
      bucket: storage.bucket,
      contentUrl,
      authConfigured: config.adminPassword !== null,
    } satisfies HealthResponse),
  );

  app.post("/api/auth/login", bodyLimit({ maxSize: 16 * 1024, onError: tooLarge("16 KB") }), async (c) => {
    if (config.adminPassword === null) {
      return fail(c, 503, "login is disabled: ADMIN_PASSWORD is not set on the server");
    }
    const ip = clientIp(c);
    const nowMs = now().getTime();
    // Checked before the password, so a locked-out client learns nothing from more guesses.
    const waitAll = globalLimiter.retryAfter(ALL_CLIENTS, nowMs);
    if (waitAll > 0) {
      c.header("Retry-After", String(waitAll));
      return fail(c, 429, `login is paused after too many failed attempts; try again in ${waitAll} s`);
    }
    const wait = limiter.retryAfter(ip, nowMs);
    if (wait > 0) {
      c.header("Retry-After", String(wait));
      return fail(c, 429, `too many failed logins; try again in ${wait} s`);
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return fail(c, 400, "request body must be JSON: {\"password\": \"…\"}");
    }
    const parsed = LoginBody.safeParse(body);
    if (!parsed.success) return fail(c, 400, "password is required", { issues: zodIssues(parsed.error) });
    if (!passwordMatches(parsed.data.password, config.adminPassword)) {
      limiter.fail(ip, nowMs);
      globalLimiter.fail(ALL_CLIENTS, nowMs);
      return fail(c, 401, "wrong password");
    }
    limiter.reset(ip);
    const session = await issueToken(config.sessionSecret, now(), config.tokenTtlSeconds);
    return c.json(session satisfies LoginResponse);
  });

  // ---- authenticated ------------------------------------------------------------------------

  app.get("/api/auth/me", (c) =>
    c.json({ ok: true, expiresAt: new Date(c.get("tokenExp") * 1000).toISOString() } satisfies MeResponse),
  );

  app.get("/api/content", async (c) => {
    const stored = await storage.readContent();
    if (!stored) return c.json({ content: seed, generation: null, url: contentUrl } satisfies ContentResponse);
    if (!stored.json.ok) {
      return fail(c, 500, `${CONTENT_OBJECT} is not valid JSON`, {
        issues: [{ path: "", message: stored.json.error }],
        generation: stored.generation,
      });
    }
    const parsed = parseContent(stored.json.value);
    if (!parsed.ok) {
      return fail(c, 500, `${CONTENT_OBJECT} does not match the content schema`, {
        issues: parsed.issues,
        generation: stored.generation,
      });
    }
    return c.json({ content: parsed.content, generation: stored.generation, url: contentUrl } satisfies ContentResponse);
  });

  app.put("/api/content", bodyLimit({ maxSize: JSON_BODY_LIMIT, onError: tooLarge("2 MB") }), async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return fail(c, 400, "request body must be JSON");
    }
    const req = SaveRequest.safeParse(body);
    if (!req.success) {
      return fail(c, 400, "expected { content, generation }", { issues: zodIssues(req.error) });
    }
    const parsed = parseContent(req.data.content);
    if (!parsed.ok) return fail(c, 400, "content is invalid", { issues: parsed.issues });

    const at = now();
    const updatedAt = at.toISOString();
    const text = JSON.stringify({ ...parsed.content, updatedAt });
    const expected = req.data.generation;

    const conflict = (actual: string | null) =>
      fail(c, 409, "conflict", {
        message: "content was saved elsewhere since you loaded it; reload before saving",
        expected,
        generation: actual,
      });

    const current = await storage.readContent();
    const live = current?.generation ?? null;
    if (live !== expected) return conflict(live);

    // Keep the version being replaced, then swap the live object only if nobody else did meanwhile.
    if (current) await storage.writeHistory(current.text, at);
    let written: { generation: string };
    try {
      written = await storage.writeContent(text, expected);
    } catch (err) {
      if (err instanceof ConflictError) return conflict(err.actual);
      throw err;
    }
    try {
      await storage.pruneHistory(HISTORY_KEEP);
    } catch (err) {
      log.warn("[api] could not prune history:", err instanceof Error ? err.message : err);
    }
    // Fire-and-forget: the rebuild request must never delay or fail the save.
    try {
      redeploy?.notify();
    } catch (err) {
      log.warn("[api] could not request a site rebuild:", err instanceof Error ? err.message : err);
    }
    return c.json({ generation: written.generation, updatedAt, url: contentUrl } satisfies SaveContentResponse);
  });

  app.get("/api/content/history", async (c) => {
    const items = (await storage.listHistory()).slice(0, HISTORY_LIST_MAX);
    return c.json({ items } satisfies HistoryResponse);
  });

  app.get("/api/content/history/item", async (c) => {
    const path = c.req.query("path") ?? "";
    if (!HISTORY_ITEM_RE.test(path)) {
      return fail(c, 400, "path must be a file directly inside content/history/ (e.g. content/history/<time>.json)");
    }
    const text = await storage.readHistory(path);
    if (text === null) return fail(c, 404, `history version not found: ${path}`);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (err) {
      return fail(c, 500, `${path} is not valid JSON`, {
        issues: [{ path: "", message: err instanceof Error ? err.message : String(err) }],
      });
    }
    const parsed = parseContent(json);
    if (!parsed.ok) return fail(c, 500, `${path} does not match the content schema`, { issues: parsed.issues });
    return c.json({ content: parsed.content });
  });

  const toItem = (o: { path: string; size: number; contentType: string; updated: string }): MediaItem => ({
    path: o.path,
    url: storage.publicUrl(o.path),
    size: o.size,
    contentType: o.contentType,
    updated: o.updated,
  });

  app.get("/api/media", async (c) => {
    const items = (await storage.listMedia()).map(toItem);
    return c.json({ items } satisfies MediaListResponse);
  });

  app.post(
    "/api/media",
    bodyLimit({ maxSize: UPLOAD_BODY_LIMIT, onError: tooLarge(`${MAX_UPLOAD_BYTES / 1024 / 1024} MB per file`) }),
    async (c) => {
      let form: Record<string, string | File>;
      try {
        form = await c.req.parseBody();
      } catch {
        return fail(c, 400, "expected multipart/form-data with a \"file\" field");
      }
      const file = form["file"];
      if (!(file instanceof File)) return fail(c, 400, "missing \"file\" field (multipart/form-data)");
      if (file.size === 0) return fail(c, 400, "the file is empty");
      if (file.size > MAX_UPLOAD_BYTES) {
        return fail(c, 413, `file is too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB)`);
      }
      const rawFolder = form["folder"];
      let folder: string | null = null;
      if (typeof rawFolder === "string" && rawFolder !== "") {
        if (!FOLDER_RE.test(rawFolder)) return fail(c, 400, "folder must match [a-z0-9-]{1,40}");
        folder = rawFolder;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const sniffed = sniffType(bytes);
      if (!sniffed) {
        return fail(c, 415, `unsupported file type; allowed: ${ALLOWED_UPLOAD_TYPES.join(", ")}`);
      }
      for (let attempt = 0; ; attempt++) {
        const path = mediaPath({ filename: file.name, ext: sniffed.ext, folder, now: now() });
        try {
          const saved = await storage.uploadMedia(path, bytes, sniffed.contentType);
          return c.json(toItem(saved) satisfies MediaItem, 201);
        } catch (err) {
          // Random suffix collided with an existing object: pick another one.
          if (err instanceof PreconditionFailedError && attempt < 3) continue;
          throw err;
        }
      }
    },
  );

  app.delete("/api/media", async (c) => {
    const path = c.req.query("path") ?? "";
    if (!isDeletableMediaPath(path)) return fail(c, 400, "path must be an uploaded file under media/");
    const deleted = await storage.deleteMedia(path);
    if (!deleted) return fail(c, 404, `not found: ${path}`);
    return c.json({ ok: true as const });
  });

  // ---- local driver only: serve stored files so dev works without a bucket -----------------

  if (storage.kind === "local") {
    app.get("/files/*", async (c) => {
      let path: string;
      try {
        path = decodeURIComponent(c.req.path.slice("/files/".length));
      } catch {
        return fail(c, 400, "bad path encoding");
      }
      if (!LOCAL_FILE_RE.test(path) || path.split("/").some((s) => s === "" || s === "." || s === "..")) {
        return fail(c, 404, "not found");
      }
      const obj = await storage.getObject(path);
      if (!obj) return fail(c, 404, `not found: ${path}`);
      return c.body(obj.bytes, 200, {
        "Content-Type": obj.contentType,
        "Cache-Control": path.startsWith("media/") ? MEDIA_CACHE_CONTROL : CONTENT_CACHE_CONTROL,
        "Access-Control-Allow-Origin": "*",
        ETag: `"${obj.generation}"`,
      });
    });
  }

  return app;
}
