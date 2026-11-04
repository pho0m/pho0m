import { loadConfig, type Config, type Env } from "../src/config.ts";
import { createApp } from "../src/app.ts";
import { createStorage } from "../src/storage/storage.ts";
import { createMemoryStore, type MemoryStore } from "../src/storage/memory.ts";
import type { Storage } from "../src/storage/types.ts";

export const PASSWORD = "film-gate-35mm";

/** A real 1x1 PNG. */
export const PNG_BYTES = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  ),
);

/** A minimal but well-formed one-page PDF. */
export const PDF_BYTES = new TextEncoder().encode(
  [
    "%PDF-1.4",
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] >> endobj",
    "trailer << /Root 1 0 R >>",
    "%%EOF",
  ].join("\n"),
);

export type Harness = {
  app: ReturnType<typeof createApp>;
  storage: Storage;
  store: MemoryStore;
  config: Config;
  clock: { now: Date; advance(ms: number): void };
  logs: unknown[][];
};

export function makeHarness(env: Env = { ADMIN_PASSWORD: PASSWORD, SESSION_SECRET: "test-secret" }): Harness {
  const clock = {
    now: new Date("2026-11-04T09:00:00.000Z"),
    advance(ms: number) {
      this.now = new Date(this.now.getTime() + ms);
    },
  };
  const now = () => clock.now;
  const config = loadConfig(env, { defaultDataDir: "/tmp/unused", randomSecret: () => "random-secret" });
  const store = createMemoryStore({ now });
  const storage = createStorage(store);
  const logs: unknown[][] = [];
  const logger = { error: (...a: unknown[]) => logs.push(a), warn: (...a: unknown[]) => logs.push(a) };
  const app = createApp({ config, storage, now, logger });
  return { app, storage, store, config, clock, logs };
}

export async function json<T = Record<string, unknown>>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`expected JSON, got ${res.status}: ${text.slice(0, 200)}`);
  }
}

export async function login(h: Harness, ip = "203.0.113.7"): Promise<string> {
  const res = await h.app.request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
    body: JSON.stringify({ password: PASSWORD }),
  });
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
  return (await json<{ token: string }>(res)).token;
}

export function authed(token: string, init: RequestInit = {}): RequestInit {
  return { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` } };
}

export function putJson(token: string, body: unknown): RequestInit {
  return authed(token, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function uploadForm(bytes: Uint8Array, filename: string, type: string, folder?: string): FormData {
  const form = new FormData();
  form.append("file", new File([bytes], filename, { type }));
  if (folder !== undefined) form.append("folder", folder);
  return form;
}
