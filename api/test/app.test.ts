import { describe, expect, it } from "vitest";
import { CONTENT_OBJECT, MAX_UPLOAD_BYTES, seed, type Content, type HistoryItem, type MediaItem } from "@pho0m/content";
import { sign } from "hono/jwt";
import {
  PASSWORD,
  PDF_BYTES,
  PNG_BYTES,
  authed,
  json,
  login,
  makeHarness,
  putJson,
  uploadForm,
  type Harness,
} from "./helpers.ts";

type Body = Record<string, unknown>;

function loginReq(password: string, ip = "198.51.100.1"): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": `${ip}, 10.0.0.1` },
    body: JSON.stringify({ password }),
  };
}

async function save(h: Harness, token: string, content: unknown, generation: string | null) {
  const res = await h.app.request("/api/content", putJson(token, { content, generation }));
  return { res, body: await json(res) };
}

describe("health and basics", () => {
  it("GET /api/health is public and describes the setup", async () => {
    const h = makeHarness();
    const res = await h.app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({
      ok: true,
      driver: "local",
      bucket: null,
      contentUrl: `https://storage.test/bucket/${CONTENT_OBJECT}`,
      authConfigured: true,
    });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("unknown routes are JSON 404s", async () => {
    const h = makeHarness();
    for (const path of ["/nope", "/api/nope", "/files/media/x.png"]) {
      const res = await h.app.request(path);
      expect(res.status, path).toBe(404);
      expect(typeof (await json(res)).error).toBe("string");
    }
  });
});

describe("login", () => {
  it("issues a 12h token for the right password and /me reports it", async () => {
    const h = makeHarness();
    const res = await h.app.request("/api/auth/login", loginReq(PASSWORD));
    expect(res.status).toBe(200);
    const body = await json<{ token: string; expiresAt: string }>(res);
    expect(body.token.split(".")).toHaveLength(3);
    expect(body.expiresAt).toBe("2026-11-04T21:00:00.000Z");

    const me = await h.app.request("/api/auth/me", authed(body.token));
    expect(me.status).toBe(200);
    expect(await json(me)).toEqual({ ok: true, expiresAt: "2026-11-04T21:00:00.000Z" });
  });

  it("rejects a wrong password with 401", async () => {
    const h = makeHarness();
    const res = await h.app.request("/api/auth/login", loginReq("nope"));
    expect(res.status).toBe(401);
    expect((await json(res)).error).toBe("wrong password");
  });

  it("rejects a malformed body with 400", async () => {
    const h = makeHarness();
    const bad = await h.app.request("/api/auth/login", { method: "POST", body: "password=x" });
    expect(bad.status).toBe(400);
    const missing = await h.app.request("/api/auth/login", { method: "POST", body: "{}" });
    expect(missing.status).toBe(400);
  });

  it("returns 503 when ADMIN_PASSWORD is not configured", async () => {
    const h = makeHarness({});
    const res = await h.app.request("/api/auth/login", loginReq("anything"));
    expect(res.status).toBe(503);
    expect(String((await json(res)).error)).toContain("ADMIN_PASSWORD");
    const health = await json(await h.app.request("/api/health"));
    expect(health.authConfigured).toBe(false);
  });

  it("locks an IP out after 5 failures in 10 minutes", async () => {
    const h = makeHarness();
    for (let i = 0; i < 5; i++) {
      const res = await h.app.request("/api/auth/login", loginReq("wrong", "198.51.100.9"));
      expect(res.status).toBe(401);
      h.clock.advance(1000);
    }
    const blocked = await h.app.request("/api/auth/login", loginReq(PASSWORD, "198.51.100.9"));
    expect(blocked.status).toBe(429);
    const retry = Number(blocked.headers.get("retry-after"));
    expect(retry).toBeGreaterThan(0);
    expect(retry).toBeLessThanOrEqual(600);

    // Other IPs are not affected.
    expect((await h.app.request("/api/auth/login", loginReq(PASSWORD, "198.51.100.10"))).status).toBe(200);

    // After the window the oldest failure expires and the right password works again.
    h.clock.advance(retry * 1000);
    expect((await h.app.request("/api/auth/login", loginReq(PASSWORD, "198.51.100.9"))).status).toBe(200);
  });

  it("uses the first X-Forwarded-For entry as the client IP", async () => {
    const h = makeHarness();
    for (let i = 0; i < 5; i++) {
      await h.app.request("/api/auth/login", loginReq("wrong", "192.0.2.5"));
    }
    const res = await h.app.request("/api/auth/login", {
      ...loginReq(PASSWORD),
      headers: { "Content-Type": "application/json", "X-Forwarded-For": "192.0.2.5" },
    });
    expect(res.status).toBe(429);
  });
});

describe("authentication on protected routes", () => {
  const routes: [string, string][] = [
    ["GET", "/api/auth/me"],
    ["GET", "/api/content"],
    ["PUT", "/api/content"],
    ["GET", "/api/content/history"],
    ["GET", "/api/content/history/item?path=content/history/x.json"],
    ["GET", "/api/media"],
    ["POST", "/api/media"],
    ["DELETE", "/api/media?path=media/2026/11/x.png"],
  ];

  it.each(routes)("%s %s → 401 without a token", async (method, path) => {
    const h = makeHarness();
    const res = await h.app.request(path, { method });
    expect(res.status).toBe(401);
    expect(typeof (await json(res)).error).toBe("string");
  });

  it.each(routes)("%s %s → 401 with a bad token", async (method, path) => {
    const h = makeHarness();
    const forged = await sign({ sub: "admin", exp: Math.floor(Date.now() / 1000) + 3600 }, "other-secret", "HS256");
    for (const token of [forged, "not.a.token", "abc"]) {
      const res = await h.app.request(path, authed(token, { method }));
      expect(res.status, token).toBe(401);
    }
  });

  it("rejects unsigned (alg none) tokens", async () => {
    const h = makeHarness();
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const exp = Math.floor(h.clock.now.getTime() / 1000) + 3600;
    const none = `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: "admin", exp })}.`;
    expect((await h.app.request("/api/content", authed(none))).status).toBe(401);
  });

  it("rejects an expired token", async () => {
    const h = makeHarness();
    const token = await login(h);
    h.clock.advance(12 * 60 * 60 * 1000 + 1000);
    expect((await h.app.request("/api/auth/me", authed(token))).status).toBe(401);
  });

  it("rejects a token signed for another subject", async () => {
    const h = makeHarness();
    const token = await sign({ sub: "guest", exp: Math.floor(h.clock.now.getTime() / 1000) + 60 }, "test-secret", "HS256");
    expect((await h.app.request("/api/content", authed(token))).status).toBe(401);
  });
});

describe("content", () => {
  it("returns the seed with generation null when nothing is stored", async () => {
    const h = makeHarness();
    const token = await login(h);
    const res = await h.app.request("/api/content", authed(token));
    expect(res.status).toBe(200);
    const body = await json<{ content: Content; generation: string | null; url: string }>(res);
    expect(body.generation).toBeNull();
    expect(body.content).toEqual(seed);
    expect(body.url).toBe(`https://storage.test/bucket/${CONTENT_OBJECT}`);
  });

  it("rejects invalid content with 400 and issues", async () => {
    const h = makeHarness();
    const token = await login(h);
    const broken = { ...seed, schemaVersion: 2, timeline: [{ id: "Bad Id", date: "May 2023" }] };
    const { res, body } = await save(h, token, broken, null);
    expect(res.status).toBe(400);
    const issues = body.issues as { path: string; message: string }[];
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.map((i) => i.path)).toEqual(expect.arrayContaining(["schemaVersion", "timeline.0.id", "timeline.0.date"]));
    expect(h.store.paths()).toEqual([]);
  });

  it("rejects a malformed save request with 400", async () => {
    const h = makeHarness();
    const token = await login(h);
    const notJson = await h.app.request("/api/content", authed(token, { method: "PUT", body: "{oops" }));
    expect(notJson.status).toBe(400);
    const noGeneration = await h.app.request("/api/content", putJson(token, { content: seed }));
    expect(noGeneration.status).toBe(400);
    const badGeneration = await h.app.request("/api/content", putJson(token, { content: seed, generation: "abc" }));
    expect(badGeneration.status).toBe(400);
  });

  it("saves, stamps updatedAt and returns the new generation", async () => {
    const h = makeHarness();
    const token = await login(h);
    const edited = { ...seed, profile: { ...seed.profile, nickname: "Phoom" } };
    const { res, body } = await save(h, token, edited, null);
    expect(res.status).toBe(200);
    expect(body).toEqual({
      generation: expect.stringMatching(/^\d+$/),
      updatedAt: "2026-11-04T09:00:00.000Z",
      url: `https://storage.test/bucket/${CONTENT_OBJECT}`,
    });

    const stored = h.store.peek(CONTENT_OBJECT)!;
    expect(stored.cacheControl).toBe("no-cache, max-age=0");
    expect(stored.info.contentType).toBe("application/json");
    const storedJson = JSON.parse(new TextDecoder().decode(stored.bytes)) as Content;
    expect(storedJson.updatedAt).toBe("2026-11-04T09:00:00.000Z");
    expect(storedJson.profile.nickname).toBe("Phoom");

    const got = await json<{ content: Content; generation: string }>(await h.app.request("/api/content", authed(token)));
    expect(got.generation).toBe(body.generation);
    expect(got.content.profile.nickname).toBe("Phoom");
    expect(got.content.updatedAt).toBe("2026-11-04T09:00:00.000Z");
  });

  it("returns 409 for a stale generation and leaves the live copy alone", async () => {
    const h = makeHarness();
    const token = await login(h);
    const first = await save(h, token, seed, null);
    const gen1 = first.body.generation as string;
    const second = await save(h, token, { ...seed, profile: { ...seed.profile, nickname: "A" } }, gen1);
    expect(second.res.status).toBe(200);

    const stale = await save(h, token, { ...seed, profile: { ...seed.profile, nickname: "B" } }, gen1);
    expect(stale.res.status).toBe(409);
    expect(stale.body.error).toBe("conflict");
    expect(stale.body.generation).toBe(second.body.generation);

    const createAgain = await save(h, token, seed, null);
    expect(createAgain.res.status).toBe(409);

    const live = await json<{ content: Content }>(await h.app.request("/api/content", authed(token)));
    expect(live.content.profile.nickname).toBe("A");
  });

  it("returns 500 with issues when the stored object is broken", async () => {
    const h = makeHarness();
    const token = await login(h);
    const enc = new TextEncoder();
    await h.store.put(CONTENT_OBJECT, enc.encode("{not json"), { contentType: "application/json", cacheControl: "" });
    let res = await h.app.request("/api/content", authed(token));
    expect(res.status).toBe(500);
    expect(((await json(res)).issues as unknown[]).length).toBe(1);

    await h.store.put(CONTENT_OBJECT, enc.encode(JSON.stringify({ schemaVersion: 1 })), {
      contentType: "application/json",
      cacheControl: "",
    });
    res = await h.app.request("/api/content", authed(token));
    expect(res.status).toBe(500);
    const body = await json(res);
    expect(String(body.error)).toContain("schema");
    expect((body.issues as unknown[]).length).toBeGreaterThan(0);
    // The owner can still overwrite it using the generation from the error.
    const fixed = await save(h, token, seed, body.generation as string);
    expect(fixed.res.status).toBe(200);
  });

  it("rejects JSON bodies over 2 MB with 413", async () => {
    const h = makeHarness();
    const token = await login(h);
    const huge = { content: { ...seed, padding: "x".repeat(2 * 1024 * 1024) }, generation: null };
    const res = await h.app.request("/api/content", putJson(token, huge));
    expect(res.status).toBe(413);
    expect(typeof (await json(res)).error).toBe("string");
  });
});

describe("history", () => {
  it("keeps the previous version on every save and serves it back", async () => {
    const h = makeHarness();
    const token = await login(h);
    const v1 = { ...seed, profile: { ...seed.profile, nickname: "v1" } };
    const first = await save(h, token, v1, null);
    let list = await json<{ items: HistoryItem[] }>(await h.app.request("/api/content/history", authed(token)));
    expect(list.items).toEqual([]);

    h.clock.advance(60_000);
    await save(h, token, { ...seed, profile: { ...seed.profile, nickname: "v2" } }, first.body.generation as string);
    list = await json(await h.app.request("/api/content/history", authed(token)));
    expect(list.items).toHaveLength(1);
    const item = list.items[0]!;
    expect(item.path).toBe("content/history/2026-11-04T09-01-00-000Z.json");
    expect(item.size).toBeGreaterThan(1000);

    const res = await h.app.request(`/api/content/history/item?path=${encodeURIComponent(item.path)}`, authed(token));
    expect(res.status).toBe(200);
    const old = await json<{ content: Content }>(res);
    expect(old.content.profile.nickname).toBe("v1");
    expect(old.content.updatedAt).toBe("2026-11-04T09:00:00.000Z");
  });

  it("lists newest first (max 30) and prunes storage to 50", async () => {
    const h = makeHarness();
    const token = await login(h);
    let gen: string | null = null;
    for (let i = 0; i < 53; i++) {
      const r = await save(h, token, { ...seed, profile: { ...seed.profile, nickname: `n${i}` } }, gen);
      expect(r.res.status).toBe(200);
      gen = r.body.generation as string;
      h.clock.advance(1000);
    }
    expect((await h.storage.listHistory()).length).toBe(50);
    const list = await json<{ items: HistoryItem[] }>(await h.app.request("/api/content/history", authed(token)));
    expect(list.items).toHaveLength(30);
    const paths = list.items.map((i) => i.path);
    expect([...paths].sort().reverse()).toEqual(paths);
    const newest = await json<{ content: Content }>(
      await h.app.request(`/api/content/history/item?path=${encodeURIComponent(paths[0]!)}`, authed(token)),
    );
    expect(newest.content.profile.nickname).toBe("n51");
  });

  it("rejects paths outside content/history/", async () => {
    const h = makeHarness();
    const token = await login(h);
    await save(h, token, seed, null);
    for (const path of [
      "content/history/../site.json",
      "content/site.json",
      "content/history/a/b.json",
      "content/history/..%2Fsite.json",
      "media/2026/11/x.json",
      "/etc/passwd",
      "",
    ]) {
      const res = await h.app.request(`/api/content/history/item?path=${encodeURIComponent(path)}`, authed(token));
      expect(res.status, path).toBe(400);
    }
    const missing = await h.app.request("/api/content/history/item?path=content/history/nope.json", authed(token));
    expect(missing.status).toBe(404);
  });
});

describe("media", () => {
  async function upload(h: Harness, token: string, form: FormData) {
    const res = await h.app.request("/api/media", authed(token, { method: "POST", body: form }));
    return { res, body: await json(res) };
  }

  it("accepts a real PNG and stores it under media/<yyyy>/<mm>/<folder>/", async () => {
    const h = makeHarness();
    const token = await login(h);
    const { res, body } = await upload(h, token, uploadForm(PNG_BYTES, "My Logo (Final).PNG", "image/png", "logos"));
    expect(res.status).toBe(201);
    const item = body as unknown as MediaItem;
    expect(item.path).toMatch(/^media\/2026\/11\/logos\/my-logo-final-[0-9a-f]{8}\.png$/);
    expect(item.contentType).toBe("image/png");
    expect(item.size).toBe(PNG_BYTES.byteLength);
    expect(item.url).toBe(`https://storage.test/bucket/${item.path}`);
    expect(item.updated).toBe("2026-11-04T09:00:00.000Z");
    const stored = h.store.peek(item.path)!;
    expect(stored.cacheControl).toBe("public, max-age=31536000, immutable");
    expect(Buffer.from(stored.bytes).equals(Buffer.from(PNG_BYTES))).toBe(true);
  });

  it("accepts a PDF even when the browser sends a generic type", async () => {
    const h = makeHarness();
    const token = await login(h);
    const { res, body } = await upload(h, token, uploadForm(PDF_BYTES, "resume.pdf", "application/octet-stream"));
    expect(res.status).toBe(201);
    expect(body.contentType).toBe("application/pdf");
    expect(body.path).toMatch(/^media\/2026\/11\/resume-[0-9a-f]{8}\.pdf$/);
  });

  it("uses the sniffed type, not the declared one or the extension", async () => {
    const h = makeHarness();
    const token = await login(h);
    const { res, body } = await upload(h, token, uploadForm(PNG_BYTES, "photo.jpg", "image/jpeg"));
    expect(res.status).toBe(201);
    expect(body.contentType).toBe("image/png");
    expect(String(body.path)).toMatch(/photo-[0-9a-f]{8}\.png$/);
  });

  it("rejects text disguised as image/png with 415", async () => {
    const h = makeHarness();
    const token = await login(h);
    const fake = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>");
    const { res, body } = await upload(h, token, uploadForm(fake, "cat.png", "image/png"));
    expect(res.status).toBe(415);
    expect(String(body.error)).toContain("image/png");
    expect(h.store.paths()).toEqual([]);
  });

  it("rejects files over the size limit with 413", async () => {
    const h = makeHarness();
    const token = await login(h);
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    big.set(PNG_BYTES);
    const { res } = await upload(h, token, uploadForm(big, "big.png", "image/png"));
    expect(res.status).toBe(413);
    const huger = new Uint8Array(MAX_UPLOAD_BYTES + 2 * 1024 * 1024);
    const second = await upload(h, token, uploadForm(huger, "huge.png", "image/png"));
    expect(second.res.status).toBe(413);
    expect(h.store.paths()).toEqual([]);
  });

  it("validates the form fields", async () => {
    const h = makeHarness();
    const token = await login(h);
    expect((await upload(h, token, uploadForm(PNG_BYTES, "a.png", "image/png", "Bad Folder!"))).res.status).toBe(400);
    expect((await upload(h, token, uploadForm(PNG_BYTES, "a.png", "image/png", "../x"))).res.status).toBe(400);
    expect((await upload(h, token, new FormData())).res.status).toBe(400);
    expect((await upload(h, token, uploadForm(new Uint8Array(0), "a.png", "image/png"))).res.status).toBe(400);
  });

  it("lists newest first and deletes", async () => {
    const h = makeHarness();
    const token = await login(h);
    const a = (await upload(h, token, uploadForm(PNG_BYTES, "a.png", "image/png"))).body as unknown as MediaItem;
    h.clock.advance(5000);
    const b = (await upload(h, token, uploadForm(PDF_BYTES, "b.pdf", "application/pdf"))).body as unknown as MediaItem;

    const list = await json<{ items: MediaItem[] }>(await h.app.request("/api/media", authed(token)));
    expect(list.items.map((i) => i.path)).toEqual([b.path, a.path]);
    expect(list.items[0]).toEqual(b);

    const del = await h.app.request(`/api/media?path=${encodeURIComponent(a.path)}`, authed(token, { method: "DELETE" }));
    expect(del.status).toBe(200);
    expect(await json(del)).toEqual({ ok: true });
    const again = await h.app.request(`/api/media?path=${encodeURIComponent(a.path)}`, authed(token, { method: "DELETE" }));
    expect(again.status).toBe(404);
    const after = await json<{ items: MediaItem[] }>(await h.app.request("/api/media", authed(token)));
    expect(after.items.map((i) => i.path)).toEqual([b.path]);
  });

  it("refuses to delete anything outside media/ or with ..", async () => {
    const h = makeHarness();
    const token = await login(h);
    await save(h, token, seed, null);
    for (const path of [
      "content/site.json",
      "media/../content/site.json",
      "media/2026/../../content/site.json",
      "../media/x.png",
      "/media/x.png",
      "media/",
      "media//x.png",
      "media/X.PNG",
      "",
    ]) {
      const res = await h.app.request(`/api/media?path=${encodeURIComponent(path)}`, authed(token, { method: "DELETE" }));
      expect(res.status, path).toBe(400);
    }
    expect(h.store.peek(CONTENT_OBJECT)).toBeDefined();
  });

  it("serves stored files at /files/* in local mode with open CORS", async () => {
    const h = makeHarness();
    const token = await login(h);
    const item = (await upload(h, token, uploadForm(PNG_BYTES, "dot.png", "image/png"))).body as unknown as MediaItem;
    const res = await h.app.request(`/files/${item.path}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG_BYTES);
    expect((await h.app.request("/files/media/..%2F..%2Fsecret")).status).toBe(404);
  });
});

describe("CORS", () => {
  it("echoes allowed origins only", async () => {
    const h = makeHarness();
    const ok = await h.app.request("/api/health", { headers: { Origin: "http://localhost:5173" } });
    expect(ok.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(ok.headers.get("access-control-expose-headers")).toContain("Retry-After");
    expect(ok.headers.get("vary")).toContain("Origin");

    const prod = await h.app.request("/api/health", { headers: { Origin: "https://kiattiphoom-pho0m.web.app" } });
    expect(prod.headers.get("access-control-allow-origin")).toBe("https://kiattiphoom-pho0m.web.app");

    const evil = await h.app.request("/api/health", { headers: { Origin: "https://evil.example" } });
    expect(evil.status).toBe(200);
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("answers preflight for allowed origins with the Authorization header allowed", async () => {
    const h = makeHarness();
    const res = await h.app.request("/api/content", {
      method: "OPTIONS",
      headers: {
        Origin: "https://kiattiphoom-pho0m.firebaseapp.com",
        "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://kiattiphoom-pho0m.firebaseapp.com");
    expect(res.headers.get("access-control-allow-methods")).toContain("PUT");
    expect(res.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("authorization");
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();

    const evil = await h.app.request("/api/content", {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "PUT" },
    });
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("keeps CORS headers on error responses so the admin can read them", async () => {
    const h = makeHarness();
    const origin = { Origin: "http://localhost:5173" };
    const unauth = await h.app.request("/api/content", { headers: origin });
    expect(unauth.status).toBe(401);
    expect(unauth.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    const missing = await h.app.request("/api/nope", { headers: origin });
    expect(missing.status).toBe(404);
    expect(missing.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    for (let i = 0; i < 6; i++) {
      await h.app.request("/api/auth/login", { ...loginReq("bad", "192.0.2.77"), headers: { ...origin, "X-Forwarded-For": "192.0.2.77" } });
    }
    const limited = await h.app.request("/api/auth/login", { ...loginReq("bad", "192.0.2.77"), headers: { ...origin, "X-Forwarded-For": "192.0.2.77" } });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(limited.headers.get("access-control-expose-headers")).toContain("Retry-After");
    expect(limited.headers.get("retry-after")).toMatch(/^\d+$/);

    const token = await login(h);
    h.store.list = async () => {
      throw new Error("boom");
    };
    const crash = await h.app.request("/api/media", authed(token, { headers: origin }));
    expect(crash.status).toBe(500);
    expect(crash.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(crash.headers.get("cache-control")).toBe("no-store");
  });

  it("respects ALLOWED_ORIGINS", async () => {
    const h = makeHarness({ ADMIN_PASSWORD: PASSWORD, ALLOWED_ORIGINS: "https://admin.example.com/" });
    const ok = await h.app.request("/api/health", { headers: { Origin: "https://admin.example.com" } });
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://admin.example.com");
    const old = await h.app.request("/api/health", { headers: { Origin: "http://localhost:5173" } });
    expect(old.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("errors", () => {
  it("turns storage failures into a JSON 500 without leaking details", async () => {
    const h = makeHarness();
    const token = await login(h);
    h.store.list = async () => {
      throw new Error("boom: secret-ish internals");
    };
    const res = await h.app.request("/api/media", authed(token));
    expect(res.status).toBe(500);
    const body: Body = await json(res);
    expect(body).toEqual({ error: "internal server error" });
    expect(h.logs.length).toBe(1);
  });
});
