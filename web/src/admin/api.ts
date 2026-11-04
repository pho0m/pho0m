import type {
  ApiError,
  Content,
  ContentResponse,
  HealthResponse,
  HistoryResponse,
  LoginResponse,
  MeResponse,
  MediaItem,
  MediaListResponse,
  SaveContentRequest,
  SaveContentResponse,
} from "@pho0m/content";
import { MAX_UPLOAD_BYTES } from "@pho0m/content";
import { formatBytes } from "./image.ts";

/**
 * Typed client for the admin API (contract: packages/content/src/api.ts).
 * Every failure is thrown as AdminApiError with a Thai `message` ready for the UI,
 * the server's own text in `detail`, and validation `issues` when the server sent them.
 */

export type Issue = { path: string; message: string };

export type ErrorKind =
  | "network"
  | "aborted"
  | "wrong-password"
  | "unauthorized"
  | "forbidden"
  | "not-found"
  | "invalid"
  | "conflict"
  | "too-large"
  | "unsupported"
  | "rate-limited"
  | "not-configured"
  | "server"
  | "bad-response";

export class AdminApiError extends Error {
  override readonly name = "AdminApiError";
  readonly kind: ErrorKind;
  readonly status: number;
  /** Raw error text from the server (often English), for the small print. */
  readonly detail: string;
  readonly issues: Issue[];
  /** Seconds to wait (from Retry-After) for 429 responses. */
  readonly retryAfter: number | null;
  constructor(
    kind: ErrorKind,
    message: string,
    init: { status?: number; detail?: string; issues?: Issue[]; retryAfter?: number | null } = {},
  ) {
    super(message);
    this.kind = kind;
    this.status = init.status ?? 0;
    this.detail = init.detail ?? "";
    this.issues = init.issues ?? [];
    this.retryAfter = init.retryAfter ?? null;
  }
}

export function isApiError(e: unknown): e is AdminApiError {
  return e instanceof AdminApiError;
}

/** Readable Thai message for anything thrown (API errors, upload rejections, plain errors). */
export function errorMessage(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return "เกิดข้อผิดพลาดที่ไม่คาดคิด";
}

function parseRetryAfter(v: string | null | undefined): number | null {
  if (!v) return null;
  const n = Number(v);
  if (Number.isFinite(n) && n >= 0) return Math.ceil(n);
  const at = Date.parse(v);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

function asApiError(body: unknown): ApiError | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { error?: unknown; issues?: unknown };
  const error = typeof b.error === "string" ? b.error : "";
  const issues = Array.isArray(b.issues)
    ? b.issues
        .filter((i): i is Issue => !!i && typeof i === "object" && typeof (i as Issue).message === "string")
        .map((i) => ({ path: String(i.path ?? ""), message: i.message }))
    : undefined;
  return issues ? { error, issues } : { error };
}

/** Map an HTTP error response to an AdminApiError (pure; exported for tests). */
export function errorFromResponse(
  status: number,
  body: unknown,
  ctx: { route: string; retryAfter?: string | null },
): AdminApiError {
  const api = asApiError(body);
  const detail = api?.error ?? (typeof body === "string" ? body.slice(0, 200) : "");
  const issues = api?.issues ?? [];
  const init = { status, detail, issues };
  const isLogin = ctx.route === "/auth/login";

  switch (status) {
    case 400:
      return new AdminApiError(
        "invalid",
        issues.length ? `ข้อมูลไม่ผ่านการตรวจสอบ ${issues.length} จุด` : "ข้อมูลที่ส่งไปไม่ถูกต้อง",
        init,
      );
    case 401:
      return isLogin
        ? new AdminApiError("wrong-password", "รหัสผ่านไม่ถูกต้อง", init)
        : new AdminApiError("unauthorized", "เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง", init);
    case 403:
      return new AdminApiError("forbidden", "ไม่มีสิทธิ์ทำรายการนี้", init);
    case 404:
      return new AdminApiError("not-found", "ไม่พบข้อมูลที่ขอ (อาจถูกลบไปแล้ว)", init);
    case 409:
      return new AdminApiError(
        "conflict",
        "มีการบันทึกเวอร์ชันใหม่กว่าจากที่อื่นแล้ว (แท็บหรืออุปกรณ์อื่น)",
        init,
      );
    case 413:
      return new AdminApiError(
        "too-large",
        `ไฟล์ใหญ่เกินไป — สูงสุด ${formatBytes(MAX_UPLOAD_BYTES)}`,
        init,
      );
    case 415:
      return new AdminApiError(
        "unsupported",
        "ไม่รองรับไฟล์ชนิดนี้ — ใช้ได้เฉพาะ JPG, PNG, WebP, GIF, AVIF หรือ PDF",
        init,
      );
    case 429: {
      const retryAfter = parseRetryAfter(ctx.retryAfter);
      const wait = retryAfter ? ` รออีกประมาณ ${retryAfter} วินาที` : " รอสักครู่";
      return new AdminApiError(
        "rate-limited",
        (isLogin ? "ลองรหัสผ่านผิดหลายครั้งเกินไป" : "ส่งคำขอถี่เกินไป") + wait + "แล้วลองใหม่",
        { ...init, retryAfter },
      );
    }
    case 503:
      return new AdminApiError(
        "not-configured",
        "เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า (เช่น ADMIN_PASSWORD หรือ bucket) หรือปิดปรับปรุงอยู่",
        init,
      );
    default:
      if (status >= 500) {
        return new AdminApiError("server", `เซิร์ฟเวอร์มีปัญหา (HTTP ${status}) ลองใหม่อีกครั้ง`, init);
      }
      return new AdminApiError("server", `คำขอไม่สำเร็จ (HTTP ${status})`, init);
  }
}

/** Map a thrown fetch/XHR failure (offline, DNS, CORS, abort). */
export function networkError(err: unknown): AdminApiError {
  if (err instanceof AdminApiError) return err;
  if (err && typeof err === "object" && (err as { name?: string }).name === "AbortError") {
    return new AdminApiError("aborted", "ยกเลิกคำขอแล้ว");
  }
  return new AdminApiError(
    "network",
    "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจสอบอินเทอร์เน็ต หรือว่า API ทำงานอยู่",
    { detail: err instanceof Error ? err.message : String(err ?? "") },
  );
}

function parseBody(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Pick<Response, "ok" | "status" | "headers" | "text">>;

export type AdminApiOptions = {
  /** API origin, e.g. "https://admin-api.run.app" — empty for same origin. */
  baseUrl: string;
  getToken: () => string | null;
  /** Called when an authenticated request gets 401 (token expired or revoked). */
  onUnauthorized?: () => void;
  fetch?: FetchLike;
};

export type UploadOptions = {
  folder?: string;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
};

const FOLDER_RE = /^[a-z0-9-]{1,40}$/;

export function createAdminApi(opts: AdminApiOptions) {
  const base = opts.baseUrl.replace(/\/+$/, "");
  const url = (route: string) => `${base}/api${route}`;
  const doFetch: FetchLike = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));

  function unauthorized(route: string): AdminApiError {
    opts.onUnauthorized?.();
    return errorFromResponse(401, { error: "no session" }, { route });
  }

  async function request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    route: string,
    init: { body?: unknown; auth?: boolean; signal?: AbortSignal } = {},
  ): Promise<T> {
    const auth = init.auth ?? true;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (auth) {
      const token = opts.getToken();
      if (!token) throw unauthorized(route);
      headers.Authorization = `Bearer ${token}`;
    }
    let body: BodyInit | undefined;
    if (typeof FormData !== "undefined" && init.body instanceof FormData) body = init.body;
    else if (init.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(init.body);
    }
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await doFetch(url(route), { method, headers, body, signal: init.signal, cache: "no-store" });
    } catch (err) {
      throw networkError(err);
    }
    let text = "";
    try {
      text = await res.text();
    } catch (err) {
      throw networkError(err);
    }
    const data = parseBody(text);
    if (!res.ok) {
      const err = errorFromResponse(res.status, data, { route, retryAfter: res.headers.get("Retry-After") });
      if (err.kind === "unauthorized" && auth) opts.onUnauthorized?.();
      throw err;
    }
    if (data === undefined || typeof data === "string") {
      throw new AdminApiError("bad-response", "เซิร์ฟเวอร์ตอบกลับในรูปแบบที่อ่านไม่ได้", {
        status: res.status,
        detail: typeof data === "string" ? data.slice(0, 200) : "empty body",
      });
    }
    return data as T;
  }

  function uploadWithProgress(form: FormData, o: UploadOptions): Promise<MediaItem> {
    const route = "/media";
    const token = opts.getToken();
    if (!token) return Promise.reject(unauthorized(route));
    return new Promise<MediaItem>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url(route));
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.setRequestHeader("Accept", "application/json");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) o.onProgress?.(e.loaded / e.total);
      };
      xhr.onload = () => {
        const data = parseBody(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && data && typeof data === "object") {
          o.onProgress?.(1);
          resolve(data as MediaItem);
          return;
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          reject(new AdminApiError("bad-response", "เซิร์ฟเวอร์ตอบกลับในรูปแบบที่อ่านไม่ได้", { status: xhr.status }));
          return;
        }
        const err = errorFromResponse(xhr.status, data, { route, retryAfter: xhr.getResponseHeader("Retry-After") });
        if (err.kind === "unauthorized") opts.onUnauthorized?.();
        reject(err);
      };
      xhr.onerror = () => reject(networkError(new Error("XHR network error")));
      xhr.onabort = () => reject(new AdminApiError("aborted", "ยกเลิกการอัปโหลดแล้ว"));
      if (o.signal) {
        if (o.signal.aborted) {
          reject(new AdminApiError("aborted", "ยกเลิกการอัปโหลดแล้ว"));
          return;
        }
        o.signal.addEventListener("abort", () => xhr.abort(), { once: true });
      }
      xhr.send(form);
    });
  }

  return {
    health: (signal?: AbortSignal) => request<HealthResponse>("GET", "/health", { auth: false, signal }),
    login: (password: string) =>
      request<LoginResponse>("POST", "/auth/login", { auth: false, body: { password } }),
    me: () => request<MeResponse>("GET", "/auth/me"),
    getContent: () => request<ContentResponse>("GET", "/content"),
    saveContent: (req: SaveContentRequest) => request<SaveContentResponse>("PUT", "/content", { body: req }),
    history: () => request<HistoryResponse>("GET", "/content/history"),
    historyItem: (path: string) =>
      request<{ content: Content }>("GET", `/content/history/item?path=${encodeURIComponent(path)}`),
    listMedia: () => request<MediaListResponse>("GET", "/media"),
    deleteMedia: (path: string) =>
      request<{ ok: true }>("DELETE", `/media?path=${encodeURIComponent(path)}`),
    uploadMedia(file: Blob, filename: string, o: UploadOptions = {}): Promise<MediaItem> {
      const form = new FormData();
      form.append("file", file, filename);
      if (o.folder && FOLDER_RE.test(o.folder)) form.append("folder", o.folder);
      if (o.onProgress && typeof XMLHttpRequest !== "undefined") return uploadWithProgress(form, o);
      return request<MediaItem>("POST", "/media", { body: form, signal: o.signal });
    },
  };
}

export type AdminApi = ReturnType<typeof createAdminApi>;
