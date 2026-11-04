import { describe, expect, it, vi } from "vitest";
import { AdminApiError, createAdminApi, errorFromResponse, networkError } from "./api.ts";

type MockRes = { ok: boolean; status: number; headers: { get: (k: string) => string | null }; text: () => Promise<string> };

function res(status: number, body: unknown, headers: Record<string, string> = {}): MockRes {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers[k] ?? headers[k.toLowerCase()] ?? null },
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

function setup(responder: (url: string, init?: RequestInit) => MockRes | Promise<MockRes>, token: string | null = "tok") {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => responder(url, init));
  const onUnauthorized = vi.fn();
  const api = createAdminApi({ baseUrl: "https://api.example.com/", getToken: () => token, onUnauthorized, fetch: fetch as never });
  return { api, fetch, onUnauthorized };
}

async function caught(p: Promise<unknown>): Promise<AdminApiError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AdminApiError);
    return e as AdminApiError;
  }
  throw new Error("expected the call to fail");
}

describe("errorFromResponse", () => {
  it("maps login 401 to wrong password and other 401s to an expired session", () => {
    expect(errorFromResponse(401, { error: "bad" }, { route: "/auth/login" }).kind).toBe("wrong-password");
    expect(errorFromResponse(401, { error: "bad" }, { route: "/content" }).kind).toBe("unauthorized");
  });
  it("keeps issues and server detail for 400", () => {
    const e = errorFromResponse(400, { error: "invalid content", issues: [{ path: "timeline.0.date", message: "use YYYY or YYYY-MM" }] }, { route: "/content" });
    expect(e.kind).toBe("invalid");
    expect(e.detail).toBe("invalid content");
    expect(e.issues).toEqual([{ path: "timeline.0.date", message: "use YYYY or YYYY-MM" }]);
    expect(e.message).toContain("1 จุด");
  });
  it("reads Retry-After for 429", () => {
    const e = errorFromResponse(429, { error: "slow down" }, { route: "/auth/login", retryAfter: "30" });
    expect(e.kind).toBe("rate-limited");
    expect(e.retryAfter).toBe(30);
    expect(e.message).toContain("30 วินาที");
  });
  it("maps the remaining statuses", () => {
    expect(errorFromResponse(409, {}, { route: "/content" }).kind).toBe("conflict");
    expect(errorFromResponse(413, {}, { route: "/media" }).kind).toBe("too-large");
    expect(errorFromResponse(415, {}, { route: "/media" }).kind).toBe("unsupported");
    expect(errorFromResponse(503, {}, { route: "/auth/login" }).kind).toBe("not-configured");
    expect(errorFromResponse(502, "<html>Bad gateway</html>", { route: "/content" }).kind).toBe("server");
    expect(errorFromResponse(404, null, { route: "/content/history/item" }).kind).toBe("not-found");
  });
  it("explains login 415 and 403 instead of upload or permission messages", () => {
    const unsupported = errorFromResponse(415, { error: "login needs Content-Type: application/json" }, { route: "/auth/login" });
    expect(unsupported.kind).toBe("unsupported");
    expect(unsupported.message).toBe("เซิร์ฟเวอร์ไม่รับคำขอเข้าสู่ระบบรูปแบบนี้ — โหลดหน้านี้ใหม่แล้วลองอีกครั้ง");
    expect(unsupported.detail).toBe("login needs Content-Type: application/json");
    const forbidden = errorFromResponse(403, { error: "login is not allowed from this origin" }, { route: "/auth/login" });
    expect(forbidden.kind).toBe("forbidden");
    expect(forbidden.message).toContain("ALLOWED_ORIGINS");
    // other routes keep their own wording
    expect(errorFromResponse(415, {}, { route: "/media" }).message).toContain("ไม่รองรับไฟล์ชนิดนี้");
    expect(errorFromResponse(403, {}, { route: "/content" }).message).toBe("ไม่มีสิทธิ์ทำรายการนี้");
  });
  it("maps thrown network errors and aborts", () => {
    expect(networkError(new TypeError("Failed to fetch")).kind).toBe("network");
    expect(networkError(new TypeError("Failed to fetch")).message).toContain("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้");
    expect(networkError(Object.assign(new Error("x"), { name: "AbortError" })).kind).toBe("aborted");
  });
});

describe("createAdminApi", () => {
  it("sends the bearer token to the /api route on the base URL", async () => {
    const { api, fetch } = setup(() => res(200, { items: [] }));
    await expect(api.history()).resolves.toEqual({ items: [] });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://api.example.com/api/content/history");
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("does not send a token to public routes", async () => {
    const { api, fetch } = setup(() => res(200, { ok: true, driver: "local", bucket: null, contentUrl: null, authConfigured: true }), null);
    await api.health();
    expect((fetch.mock.calls[0]![1]!.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("PUTs JSON and returns the parsed body", async () => {
    const { api, fetch } = setup(() => res(200, { generation: "2", updatedAt: "2026-11-04T00:00:00Z", url: null }));
    const out = await api.saveContent({ content: { a: 1 }, generation: "1" });
    expect(out.generation).toBe("2");
    const init = fetch.mock.calls[0]![1]!;
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ content: { a: 1 }, generation: "1" });
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("logs in with a JSON body, the JSON content type and no token", async () => {
    const { api, fetch } = setup(() => res(200, { token: "t", expiresAt: "2026-11-04T12:00:00Z" }), "old");
    await expect(api.login("hunter2")).resolves.toEqual({ token: "t", expiresAt: "2026-11-04T12:00:00Z" });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://api.example.com/api/auth/login");
    expect(init!.method).toBe("POST");
    const headers = init!.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Authorization).toBeUndefined();
    expect(JSON.parse(init!.body as string)).toEqual({ password: "hunter2" });
  });

  it("turns a login 415 / 403 into a Thai message without logging out", async () => {
    const { api, onUnauthorized } = setup(() => res(415, { error: "login needs Content-Type: application/json" }), null);
    expect((await caught(api.login("x"))).message).toContain("โหลดหน้านี้ใหม่");
    const second = setup(() => res(403, { error: "login is not allowed from this origin" }), null);
    const e = await caught(second.api.login("x"));
    expect(e.kind).toBe("forbidden");
    expect(e.message).toContain("ALLOWED_ORIGINS");
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(second.onUnauthorized).not.toHaveBeenCalled();
  });

  it("passes the content warning and the redeploy status through", async () => {
    const warning = "drafts could not be decrypted; showing the published version";
    const { api } = setup((url, init) =>
      init?.method === "PUT"
        ? res(200, { generation: "3", updatedAt: "2026-11-04T00:00:00Z", url: null, redeploy: "queued" })
        : res(200, { content: {}, generation: "2", url: null, warning }),
    );
    expect((await api.getContent()).warning).toBe(warning);
    expect((await api.saveContent({ content: {}, generation: "2" })).redeploy).toBe("queued");
  });

  it("calls onUnauthorized on 401 from an authenticated route", async () => {
    const { api, onUnauthorized } = setup(() => res(401, { error: "expired" }));
    const e = await caught(api.getContent());
    expect(e.kind).toBe("unauthorized");
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("does not log out on a wrong password", async () => {
    const { api, onUnauthorized } = setup(() => res(401, { error: "wrong password" }), null);
    const e = await caught(api.login("nope"));
    expect(e.kind).toBe("wrong-password");
    expect(e.message).toBe("รหัสผ่านไม่ถูกต้อง");
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("fails fast without a token", async () => {
    const { api, fetch, onUnauthorized } = setup(() => res(200, {}), null);
    const e = await caught(api.listMedia());
    expect(e.kind).toBe("unauthorized");
    expect(fetch).not.toHaveBeenCalled();
    expect(onUnauthorized).toHaveBeenCalled();
  });

  it("surfaces issues from a 400 save", async () => {
    const { api } = setup(() => res(400, { error: "invalid", issues: [{ path: "profile.name.en", message: "Required" }] }));
    const e = await caught(api.saveContent({ content: {}, generation: null }));
    expect(e.issues).toEqual([{ path: "profile.name.en", message: "Required" }]);
  });

  it("turns a rejected fetch into a readable network error", async () => {
    const { api } = setup(() => {
      throw new TypeError("Failed to fetch");
    });
    const e = await caught(api.getContent());
    expect(e.kind).toBe("network");
    expect(e.detail).toBe("Failed to fetch");
  });

  it("rejects non-JSON success bodies", async () => {
    const { api } = setup(() => res(200, "<!doctype html><p>index</p>"));
    const e = await caught(api.getContent());
    expect(e.kind).toBe("bad-response");
  });

  it("encodes query parameters for history items and media deletes", async () => {
    const { api, fetch } = setup(() => res(200, { ok: true }));
    await api.deleteMedia("media/2026/11/a b.webp");
    expect(fetch.mock.calls[0]![0]).toBe("https://api.example.com/api/media?path=media%2F2026%2F11%2Fa%20b.webp");
    expect(fetch.mock.calls[0]![1]!.method).toBe("DELETE");
  });

  it("uploads multipart form data with a valid folder only", async () => {
    const { api, fetch } = setup(() => res(201, { path: "media/x.webp", url: "/x.webp", size: 3, contentType: "image/webp", updated: "" }));
    await api.uploadMedia(new Blob(["abc"], { type: "image/webp" }), "x.webp", { folder: "timeline" });
    const body = fetch.mock.calls[0]![1]!.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("folder")).toBe("timeline");
    await api.uploadMedia(new Blob(["abc"]), "x.webp", { folder: "Bad Folder!" });
    expect((fetch.mock.calls[1]![1]!.body as FormData).get("folder")).toBeNull();
  });
});

describe("partial save failure keeps the new generation", () => {
  it("errorFromResponse reads generation from a 500 body", async () => {
    const { errorFromResponse } = await import("./api.ts");
    const e = errorFromResponse(500, { error: "the draft was saved but the public site was not updated; save again", generation: "42" }, { route: "/content" });
    expect(e.generation).toBe("42");
    expect(errorFromResponse(500, { error: "boom" }, { route: "/content" }).generation).toBeNull();
  });
});
