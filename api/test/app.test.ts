import { describe, expect, it } from "vitest";
import { CONTENT_OBJECT, MAX_UPLOAD_BYTES, type Content, type HistoryItem, type MediaItem } from "@pho0m/content";
import { seed } from "@pho0m/content/seed";
import { sign } from "hono/jwt";
import { DECRYPT_WARNING } from "../src/app.ts";
import { deriveContentKey, open, seal } from "../src/content-crypto.ts";
import type { RedeployStatus } from "../src/redeploy.ts";
import { PRIVATE_CONTENT_OBJECT } from "../src/storage/storage.ts";
import {
  PASSWORD,
  PDF_BYTES,
  PNG_BYTES,
  SESSION_SECRET,
  authed,
  json,
  login,
  makeHarness,
  putJson,
  uploadForm,
  type Harness,
} from "./helpers.ts";

type Body = Record<string, unknown>;

/** Like Cloud Run: the client's own (spoofable) X-Forwarded-For first, the address Google saw last. */
function loginReq(password: string, ip = "198.51.100.1", spoofed = "10.0.0.1"): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": `${spoofed}, ${ip}` },
    body: JSON.stringify({ password }),
  };
}

async function save(h: Harness, token: string, content: unknown, generation: string | null) {
  const res = await h.app.request("/api/content", putJson(token, { content, generation }));
  return { res, body: await json(res) };
}

const dec = new TextDecoder();
const enc = new TextEncoder();
const text = (bytes: Uint8Array) => dec.decode(bytes);
const PRIVATE_PHONE = "+66 81-PRIVATE";
const DRAFT_TITLE = "Unannounced acquisition (draft)";

/** Seed plus a hidden phone, a draft frame, a hidden project and a document without a URL. */
function withSecrets(base: Content = seed): Content {
  const frame = base.timeline[0]!;
  const project = base.projects[0]!;
  return {
    ...base,
    profile: { ...base.profile, phone: { value: PRIVATE_PHONE, visible: false } },
    timeline: [...base.timeline, { ...frame, id: "secret-draft", published: false, title: { th: DRAFT_TITLE, en: DRAFT_TITLE } }],
    projects: [...base.projects, { ...project, id: "secret-project", published: false }],
  };
}

/** The decrypted private copy as stored. */
function privateCopy(h: Harness): Content {
  const stored = h.store.peek(PRIVATE_CONTENT_OBJECT);
  if (!stored) throw new Error("no private copy");
  return JSON.parse(open(deriveContentKey(SESSION_SECRET), text(stored.bytes))) as Content;
}

function publicCopy(h: Harness): Content {
  const stored = h.store.peek(CONTENT_OBJECT);
  if (!stored) throw new Error("no public copy");
  return JSON.parse(text(stored.bytes)) as Content;
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
    const headers = { "Content-Type": "application/json" };
    const bad = await h.app.request("/api/auth/login", { method: "POST", headers, body: "password=x" });
    expect(bad.status).toBe(400);
    const missing = await h.app.request("/api/auth/login", { method: "POST", headers, body: "{}" });
    expect(missing.status).toBe(400);
  });

  it("requires Content-Type: application/json (415), so a cross-origin simple POST is not processed", async () => {
    const h = makeHarness();
    const body = JSON.stringify({ password: PASSWORD });
    for (const type of [undefined, "text/plain;charset=UTF-8", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"]) {
      const res = await h.app.request("/api/auth/login", {
        method: "POST",
        headers: { "X-Forwarded-For": "198.51.100.3", ...(type ? { "Content-Type": type } : {}) },
        body,
      });
      expect(res.status, String(type)).toBe(415);
      expect(String((await json(res)).error)).toContain("application/json");
    }
    // Parameters and case are fine.
    const ok = await h.app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "Application/JSON; charset=utf-8" },
      body,
    });
    expect(ok.status).toBe(200);
  });

  it("refuses a foreign Origin with 403 and accepts allowed origins or no Origin", async () => {
    const h = makeHarness();
    const req = (origin?: string) => ({
      ...loginReq(PASSWORD, "198.51.100.4"),
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": "198.51.100.4",
        ...(origin !== undefined ? { Origin: origin } : {}),
      },
    });
    for (const origin of ["https://evil.example", "null", "https://kiattiphoom-pho0m.web.app.evil.example"]) {
      const res = await h.app.request("/api/auth/login", req(origin));
      expect(res.status, origin).toBe(403);
    }
    expect((await h.app.request("/api/auth/login", req("https://kiattiphoom-pho0m.web.app"))).status).toBe(200);
    expect((await h.app.request("/api/auth/login", req("http://localhost:5173"))).status).toBe(200);
    expect((await h.app.request("/api/auth/login", req())).status).toBe(200);
  });

  it("does not count refused cross-origin or non-JSON attempts as failures", async () => {
    const h = makeHarness();
    for (let i = 0; i < 40; i++) {
      const res = await h.app.request("/api/auth/login", {
        method: "POST",
        headers: {
          "X-Forwarded-For": "198.51.100.5",
          ...(i % 2 ? { "Content-Type": "text/plain;charset=UTF-8" } : { "Content-Type": "application/json", Origin: "https://evil.example" }),
        },
        body: JSON.stringify({ password: "guess" }),
      });
      expect(res.status).toBe(i % 2 ? 415 : 403);
    }
    expect((await h.app.request("/api/auth/login", loginReq(PASSWORD, "198.51.100.5"))).status).toBe(200);
    expect((await h.app.request("/api/auth/login", loginReq(PASSWORD, "198.51.100.6"))).status).toBe(200);
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

  it("keys on the right-most X-Forwarded-For entry, so a spoofed header cannot dodge the limit", async () => {
    const h = makeHarness();
    for (let i = 0; i < 5; i++) {
      // A different forged address every time; Google's front end still appends the real one.
      const res = await h.app.request("/api/auth/login", loginReq("wrong", "192.0.2.5", `203.0.113.${i}`));
      expect(res.status).toBe(401);
    }
    const res = await h.app.request("/api/auth/login", {
      ...loginReq(PASSWORD),
      headers: { "Content-Type": "application/json", "X-Forwarded-For": "192.0.2.5" },
    });
    expect(res.status).toBe(429);

    // Forging the real client's address on the left does not lock that client out either.
    const other = await h.app.request("/api/auth/login", loginReq(PASSWORD, "192.0.2.77", "192.0.2.5"));
    expect(other.status).toBe(200);
  });

  it("after 30 failures from many addresses, refuses only addresses with a recent failure", async () => {
    const h = makeHarness();
    // 30 addresses, one failure each: none reaches the per-IP limit of 5.
    for (let i = 0; i < 30; i++) {
      const res = await h.app.request("/api/auth/login", loginReq("guess", `198.51.100.${100 + i}`));
      expect(res.status, `attempt ${i}`).toBe(401);
      h.clock.advance(1000);
    }
    // An address that already failed is refused, even with the right password, and without a
    // precise Retry-After (it would tell an attacker when a slot frees up).
    const blocked = await h.app.request("/api/auth/login", loginReq(PASSWORD, "198.51.100.100"));
    expect(blocked.status).toBe(429);
    expect(String((await json(blocked)).error)).toContain("try again later");
    expect(blocked.headers.get("retry-after")).toBeNull();

    // A clean address (the owner) still gets in.
    expect((await h.app.request("/api/auth/login", loginReq(PASSWORD, "192.0.2.200"))).status).toBe(200);

    // A new address gets one guess; its failure is counted and it is refused from then on.
    expect((await h.app.request("/api/auth/login", loginReq("guess", "192.0.2.201"))).status).toBe(401);
    const second = await h.app.request("/api/auth/login", loginReq(PASSWORD, "192.0.2.201"));
    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toBeNull();

    // Once the failures age out of the window, everyone can log in again.
    h.clock.advance(10 * 60 * 1000);
    expect((await h.app.request("/api/auth/login", loginReq(PASSWORD, "198.51.100.100"))).status).toBe(200);
    expect((await h.app.request("/api/auth/login", loginReq(PASSWORD, "192.0.2.201"))).status).toBe(200);
  });

  it("a successful login clears that address's failures, so it is not refused by the global limit", async () => {
    const h = makeHarness();
    // The owner mistypes once, then logs in.
    expect((await h.app.request("/api/auth/login", loginReq("typo", "192.0.2.50"))).status).toBe(401);
    expect((await h.app.request("/api/auth/login", loginReq(PASSWORD, "192.0.2.50"))).status).toBe(200);
    // Then an attack from many addresses trips the global limit.
    for (let i = 0; i < 30; i++) {
      expect((await h.app.request("/api/auth/login", loginReq("guess", `198.51.100.${i}`))).status).toBe(401);
    }
    expect((await h.app.request("/api/auth/login", loginReq("guess", "198.51.100.0"))).status).toBe(429);
    // The owner's address has no recent failure left.
    expect((await h.app.request("/api/auth/login", loginReq(PASSWORD, "192.0.2.50"))).status).toBe(200);
  });

  it("successful logins do not count towards the global limit", async () => {
    const h = makeHarness();
    for (let i = 0; i < 40; i++) {
      expect((await h.app.request("/api/auth/login", loginReq(PASSWORD, `198.51.100.${i}`))).status).toBe(200);
    }
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
    const token = await sign({ sub: "guest", exp: Math.floor(h.clock.now.getTime() / 1000) + 60 }, SESSION_SECRET, "HS256");
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
      redeploy: "off",
    });
    // The generation the admin gets is the private object's (the conflict check).
    expect(body.generation).toBe(h.store.peek(PRIVATE_CONTENT_OBJECT)!.info.generation);

    const stored = h.store.peek(CONTENT_OBJECT)!;
    expect(stored.cacheControl).toBe("no-cache, max-age=0");
    expect(stored.info.contentType).toBe("application/json");
    const storedJson = publicCopy(h);
    expect(storedJson.updatedAt).toBe("2026-11-04T09:00:00.000Z");
    expect(storedJson.profile.nickname).toBe("Phoom");

    const got = await json<{ content: Content; generation: string }>(await h.app.request("/api/content", authed(token)));
    expect(got.generation).toBe(body.generation);
    expect(got.content.profile.nickname).toBe("Phoom");
    expect(got.content.updatedAt).toBe("2026-11-04T09:00:00.000Z");
  });

  it("keeps drafts, hidden items and hidden contact details out of the public object", async () => {
    const h = makeHarness();
    const token = await login(h);
    const full = withSecrets();
    const first = await save(h, token, full, null);
    expect(first.res.status).toBe(200);

    // Public: no hidden phone, no draft frame, no hidden project, anywhere in the bytes.
    const publicText = text(h.store.peek(CONTENT_OBJECT)!.bytes);
    expect(publicText).not.toContain(PRIVATE_PHONE);
    expect(publicText).not.toContain(DRAFT_TITLE);
    expect(publicText).not.toContain("secret-draft");
    expect(publicText).not.toContain("secret-project");
    const pub = publicCopy(h);
    expect(pub.profile.phone).toEqual({ value: "", visible: false });
    expect(pub.timeline.every((f) => f.published)).toBe(true);
    expect(pub.timeline).toHaveLength(seed.timeline.length);

    // Admin: everything comes back.
    const got = await json<{ content: Content }>(await h.app.request("/api/content", authed(token)));
    expect(got.content.profile.phone).toEqual({ value: PRIVATE_PHONE, visible: false });
    expect(got.content.timeline.find((f) => f.id === "secret-draft")?.published).toBe(false);
    expect(got.content.projects.find((p) => p.id === "secret-project")?.published).toBe(false);

    // Removing them later: no readable trace left in any stored object (history is encrypted).
    h.clock.advance(60_000);
    const second = await save(h, token, seed, first.body.generation as string);
    expect(second.res.status).toBe(200);
    for (const path of h.store.paths()) {
      const bytes = text(h.store.peek(path)!.bytes);
      expect(bytes, path).not.toContain(PRIVATE_PHONE);
      expect(bytes, path).not.toContain("secret-draft");
    }
    expect(h.store.paths()).toEqual([CONTENT_OBJECT, "private/content.enc", "private/history/2026-11-04T09-01-00-000Z.enc"]);
  });

  it("stores the full content only as an AES-256-GCM envelope with a fresh IV per write", async () => {
    const h = makeHarness();
    const token = await login(h);
    const first = await save(h, token, withSecrets(), null);
    const stored = h.store.peek(PRIVATE_CONTENT_OBJECT)!;
    expect(stored.cacheControl).toBe("private, no-store");
    const envelope = JSON.parse(text(stored.bytes)) as Record<string, string | number>;
    expect(Object.keys(envelope).sort()).toEqual(["data", "iv", "tag", "v"]);
    expect(envelope.v).toBe(1);
    expect(Buffer.from(String(envelope.iv), "base64")).toHaveLength(12);
    expect(Buffer.from(String(envelope.tag), "base64")).toHaveLength(16);
    expect(privateCopy(h).profile.phone.value).toBe(PRIVATE_PHONE);
    // Another key cannot open it.
    expect(() => open(deriveContentKey("another-secret-of-at-least-32-chars"), text(stored.bytes))).toThrow();

    await save(h, token, withSecrets(), first.body.generation as string);
    const again = JSON.parse(text(h.store.peek(PRIVATE_CONTENT_OBJECT)!.bytes)) as Record<string, string>;
    expect(again.iv).not.toBe(envelope.iv);
  });

  it("migrates: reads a legacy full content/site.json, and the first save moves it into private/", async () => {
    const h = makeHarness();
    const token = await login(h);
    // Saved before encryption existed: the full document, drafts included, in the public object.
    const legacyText = JSON.stringify({ ...withSecrets(), updatedAt: "2026-11-01T00:00:00.000Z" });
    await h.store.put(CONTENT_OBJECT, enc.encode(legacyText), { contentType: "application/json", cacheControl: "" });
    await h.store.put("content/history/2026-10-31T00-00-00-000Z.json", enc.encode(JSON.stringify({ ...withSecrets(), updatedAt: "2026-10-30T00:00:00.000Z" })), {
      contentType: "application/json",
      cacheControl: "",
    });

    const got = await json<{ content: Content; generation: string | null }>(await h.app.request("/api/content", authed(token)));
    expect(got.generation).toBeNull();
    expect(got.content.profile.phone.value).toBe(PRIVATE_PHONE);
    expect(got.content.timeline.some((f) => f.id === "secret-draft")).toBe(true);

    h.clock.advance(60_000);
    const saved = await save(h, token, got.content, null);
    expect(saved.res.status).toBe(200);
    expect(text(h.store.peek(CONTENT_OBJECT)!.bytes)).not.toContain(PRIVATE_PHONE);
    expect(privateCopy(h).timeline.some((f) => f.id === "secret-draft")).toBe(true);

    // The legacy copy became the newest history entry and the plaintext history was moved.
    const list = await json<{ items: HistoryItem[] }>(await h.app.request("/api/content/history", authed(token)));
    expect(list.items.map((i) => i.path)).toEqual([
      "private/history/2026-11-04T09-01-00-000Z.enc",
      "private/history/2026-10-31T00-00-00-000Z.enc",
    ]);
    expect(h.store.paths().filter((p) => p.startsWith("content/history/"))).toEqual([]);
    for (const item of list.items) {
      const res = await h.app.request(`/api/content/history/item?path=${encodeURIComponent(item.path)}`, authed(token));
      expect(res.status, item.path).toBe(200);
      expect((await json<{ content: Content }>(res)).content.profile.phone.value).toBe(PRIVATE_PHONE);
    }
    expect(h.logs.map((l) => String(l[0]))).toContain("[api] moved 1 plaintext history file(s) to private/history/ (encrypted)");
  });

  it("when the secret changed, shows the published version with a warning and the next save replaces the drafts", async () => {
    const h = makeHarness();
    const token = await login(h);
    const first = await save(h, token, withSecrets({ ...seed, profile: { ...seed.profile, nickname: "published" } }), null);
    // Simulate a rotated secret: re-encrypt the private copy with a key the server does not have.
    const otherKey = deriveContentKey("rotated-away-secret-0123456789abcdef");
    const lost = seal(otherKey, JSON.stringify(withSecrets()));
    const rotated = await h.store.put(PRIVATE_CONTENT_OBJECT, enc.encode(lost), { contentType: "application/json", cacheControl: "" });
    expect(rotated.generation).not.toBe(first.body.generation);

    const res = await h.app.request("/api/content", authed(token));
    expect(res.status).toBe(200);
    const got = await json<{ content: Content; generation: string; warning?: string }>(res);
    expect(got.warning).toBe(DECRYPT_WARNING);
    expect(got.warning).toBe("drafts could not be decrypted; showing the published version");
    expect(got.generation).toBe(rotated.generation);
    expect(got.content.profile.nickname).toBe("published");
    expect(got.content.timeline.some((f) => f.id === "secret-draft")).toBe(false);
    expect(got.content.profile.phone.value).toBe("");

    // The next save (with that generation) overwrites the unreadable copy with the current key.
    const next = await save(h, token, got.content, got.generation);
    expect(next.res.status).toBe(200);
    const after = await json<{ content: Content; warning?: string }>(await h.app.request("/api/content", authed(token)));
    expect(after.warning).toBeUndefined();
    expect(after.content.profile.nickname).toBe("published");
    // The unreadable version is kept in history as it was; reading it says why it fails.
    const list = await json<{ items: HistoryItem[] }>(await h.app.request("/api/content/history", authed(token)));
    const old = await h.app.request(`/api/content/history/item?path=${encodeURIComponent(list.items[0]!.path)}`, authed(token));
    expect(old.status).toBe(500);
    expect(String((await json(old)).error)).toContain("could not be decrypted");
    expect(open(otherKey, text(h.store.peek(list.items[0]!.path)!.bytes))).toContain(DRAFT_TITLE);
  });

  it("falls back to the seed with the warning when nothing published can be read either", async () => {
    const h = makeHarness();
    const token = await login(h);
    await h.store.put(PRIVATE_CONTENT_OBJECT, enc.encode("{\"v\":1,\"iv\":\"\",\"tag\":\"\",\"data\":\"\"}"), {
      contentType: "application/json",
      cacheControl: "",
    });
    const got = await json<{ content: Content; generation: string; warning?: string }>(await h.app.request("/api/content", authed(token)));
    expect(got.warning).toBe(DECRYPT_WARNING);
    expect(got.content).toEqual(seed);
    expect(got.generation).toBe(h.store.peek(PRIVATE_CONTENT_OBJECT)!.info.generation);
  });

  it("answers 500 with the new generation when the public copy cannot be written", async () => {
    const h = makeHarness();
    const token = await login(h);
    const put = h.store.put.bind(h.store);
    h.store.put = async (path, bytes, o) => {
      if (path === CONTENT_OBJECT) throw new Error("bucket hiccup");
      return put(path, bytes, o);
    };
    const { res, body } = await save(h, token, seed, null);
    expect(res.status).toBe(500);
    expect(String(body.error)).toContain("save again");
    expect(body.generation).toBe(h.store.peek(PRIVATE_CONTENT_OBJECT)!.info.generation);
    h.store.put = put;
    const retry = await save(h, token, seed, body.generation as string);
    expect(retry.res.status).toBe(200);
    expect(publicCopy(h).profile.nickname).toBe(seed.profile.nickname);
  });

  it("still saves when writing history fails, and logs it", async () => {
    const h = makeHarness();
    const token = await login(h);
    const first = await save(h, token, seed, null);
    const put = h.store.put.bind(h.store);
    h.store.put = async (path, bytes, o) => {
      if (path.startsWith("private/history/")) throw new Error("history hiccup");
      return put(path, bytes, o);
    };
    const second = await save(h, token, { ...seed, profile: { ...seed.profile, nickname: "kept" } }, first.body.generation as string);
    expect(second.res.status).toBe(200);
    expect(privateCopy(h).profile.nickname).toBe("kept");
    expect(h.logs.map((l) => String(l[0]))).toContain("[api] could not update history:");
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

  it("returns 500 with issues when a legacy content/site.json is broken, and a save replaces it", async () => {
    const h = makeHarness();
    const token = await login(h);
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
    // Nothing private exists yet, so the owner can overwrite it with generation null.
    expect(body.generation).toBeNull();
    const fixed = await save(h, token, seed, body.generation as null);
    expect(fixed.res.status).toBe(200);
  });

  it("returns 500 with issues when the decrypted private copy is broken, and a save replaces it", async () => {
    const h = makeHarness();
    const token = await login(h);
    const key = deriveContentKey(SESSION_SECRET);
    await h.store.put(PRIVATE_CONTENT_OBJECT, enc.encode(seal(key, "{not json")), { contentType: "application/json", cacheControl: "" });
    let res = await h.app.request("/api/content", authed(token));
    expect(res.status).toBe(500);
    expect(String((await json(res)).error)).toContain("not valid JSON");

    await h.store.put(PRIVATE_CONTENT_OBJECT, enc.encode(seal(key, JSON.stringify({ schemaVersion: 1 }))), {
      contentType: "application/json",
      cacheControl: "",
    });
    res = await h.app.request("/api/content", authed(token));
    expect(res.status).toBe(500);
    const body = await json(res);
    expect(String(body.error)).toContain("schema");
    expect(body.generation).toBe(h.store.peek(PRIVATE_CONTENT_OBJECT)!.info.generation);
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
    expect(item.path).toBe("private/history/2026-11-04T09-01-00-000Z.enc");
    expect(item.size).toBeGreaterThan(1000);
    // Stored encrypted.
    expect(text(h.store.peek(item.path)!.bytes)).not.toContain("nickname");

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

  it("rejects paths outside private/history/", async () => {
    const h = makeHarness();
    const token = await login(h);
    await save(h, token, seed, null);
    for (const path of [
      "private/history/../content.enc",
      "private/content.enc",
      "private/history/a/b.enc",
      "private/history/..%2Fcontent.enc",
      "content/history/2026-11-04T09-01-00-000Z.json",
      "content/site.json",
      "media/2026/11/x.enc",
      "/etc/passwd",
      "",
    ]) {
      const res = await h.app.request(`/api/content/history/item?path=${encodeURIComponent(path)}`, authed(token));
      expect(res.status, path).toBe(400);
    }
    const missing = await h.app.request("/api/content/history/item?path=private/history/nope.enc", authed(token));
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
    const loginHeaders = { ...origin, "Content-Type": "application/json", "X-Forwarded-For": "192.0.2.77" };
    for (let i = 0; i < 6; i++) {
      await h.app.request("/api/auth/login", { ...loginReq("bad", "192.0.2.77"), headers: loginHeaders });
    }
    const limited = await h.app.request("/api/auth/login", { ...loginReq("bad", "192.0.2.77"), headers: loginHeaders });
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

describe("redeploy on save", () => {
  function spy(result: RedeployStatus | Error = "sent") {
    const calls: number[] = [];
    return {
      calls,
      async notify(): Promise<RedeployStatus> {
        calls.push(1);
        if (result instanceof Error) throw result;
        return result;
      },
    };
  }

  it("asks for a rebuild after each successful save only, and reports its status", async () => {
    const redeploy = spy("sent");
    const h = makeHarness(undefined, { redeploy });
    const token = await login(h);

    const first = await save(h, token, seed, null);
    expect(first.res.status).toBe(200);
    expect(first.body.redeploy).toBe("sent");
    expect(redeploy.calls).toHaveLength(1);

    // Rejected saves (stale generation, invalid content) do not trigger anything.
    expect((await save(h, token, seed, null)).res.status).toBe(409);
    expect((await save(h, token, { ...seed, schemaVersion: 2 }, first.body.generation as string)).res.status).toBe(400);
    expect(redeploy.calls).toHaveLength(1);

    expect((await save(h, token, seed, first.body.generation as string)).res.status).toBe(200);
    expect(redeploy.calls).toHaveLength(2);
  });

  it.each(["sent", "queued", "failed"] as const)("passes %s through", async (status) => {
    const h = makeHarness(undefined, { redeploy: spy(status) });
    const token = await login(h);
    const { res, body } = await save(h, token, seed, null);
    expect(res.status).toBe(200);
    expect(body.redeploy).toBe(status);
  });

  it("reports off without a trigger", async () => {
    const h = makeHarness();
    const token = await login(h);
    expect((await save(h, token, seed, null)).body.redeploy).toBe("off");
  });

  it("waits for the dispatch before answering (no work after the response)", async () => {
    let release!: (s: RedeployStatus) => void;
    const h = makeHarness(undefined, {
      redeploy: { notify: () => new Promise<RedeployStatus>((resolve) => (release = resolve)) },
    });
    const token = await login(h);
    let answered = false;
    const pending = Promise.resolve(h.app.request("/api/content", putJson(token, { content: seed, generation: null }))).then((r) => {
      answered = true;
      return r;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(answered).toBe(false);
    expect(h.store.peek(CONTENT_OBJECT)).toBeDefined(); // already saved
    release("sent");
    const res = await pending;
    expect(res.status).toBe(200);
    expect((await json(res)).redeploy).toBe("sent");
  });

  it("still saves when the trigger throws, reports failed and logs it", async () => {
    const h = makeHarness(undefined, { redeploy: spy(new Error("dispatch exploded")) });
    const token = await login(h);
    const { res, body } = await save(h, token, seed, null);
    expect(res.status).toBe(200);
    expect(body.generation).toMatch(/^\d+$/);
    expect(body.redeploy).toBe("failed");
    expect(h.store.peek(CONTENT_OBJECT)).toBeDefined();
    expect(h.logs.map((l) => String(l[0]))).toContain("[api] could not request a site rebuild:");
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
