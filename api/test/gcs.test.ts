import { Storage as GcsClient } from "@google-cloud/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CONTENT_OBJECT, type Content, type MediaItem } from "@pho0m/content";
import { seed } from "@pho0m/content/seed";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { createGcsStore, gcsPublicUrl } from "../src/storage/gcs.ts";
import { createStorage } from "../src/storage/storage.ts";
import { PreconditionFailedError } from "../src/storage/types.ts";
import { startFakeGcs, type FakeGcs } from "./fake-gcs.ts";
import { PASSWORD, PNG_BYTES, authed, json, putJson, uploadForm } from "./helpers.ts";

const BUCKET = "pho0m-content";
let fake: FakeGcs;
let client: GcsClient;

beforeAll(async () => {
  fake = await startFakeGcs(BUCKET);
  client = new GcsClient({ apiEndpoint: fake.url, projectId: "test-project" });
});
afterAll(async () => {
  await fake.close();
});

describe("gcs driver (real SDK against a fake JSON API)", () => {
  it("builds public URLs", () => {
    expect(gcsPublicUrl(BUCKET, "media/2026/11/a b.png")).toBe(
      "https://storage.googleapis.com/pho0m-content/media/2026/11/a%20b.png",
    );
  });

  it("puts with ifGenerationMatch, reads the exact generation, lists and deletes", async () => {
    const store = createGcsStore({ bucket: BUCKET, credentials: null, client });
    const enc = new TextEncoder();
    const a = await store.put("content/test.json", enc.encode('{"v":1}'), {
      contentType: "application/json",
      cacheControl: "no-cache, max-age=0",
      ifGenerationMatch: "0",
    });
    expect(a.generation).toMatch(/^\d+$/);
    expect(a.size).toBe(7);
    expect(fake.requests.at(-1)).toContain("ifGenerationMatch=0");
    expect(fake.objects.get("content/test.json")?.cacheControl).toBe("no-cache, max-age=0");

    await expect(
      store.put("content/test.json", enc.encode("{}"), { contentType: "application/json", cacheControl: "", ifGenerationMatch: "0" }),
    ).rejects.toBeInstanceOf(PreconditionFailedError);

    const got = await store.get("content/test.json");
    expect(got?.generation).toBe(a.generation);
    expect(new TextDecoder().decode(got!.bytes)).toBe('{"v":1}');
    expect(await store.get("content/missing.json")).toBeNull();

    const listed = await store.list("content/");
    expect(listed.map((o) => o.path)).toContain("content/test.json");

    expect(await store.delete("content/test.json")).toBe(true);
    expect(await store.delete("content/test.json")).toBe(false);
  });

  it("runs the whole app on top of it", async () => {
    const config = loadConfig(
      { ADMIN_PASSWORD: PASSWORD, SERVICE_ACCOUNT_BUCKET_NAME: BUCKET },
      { defaultDataDir: "/unused" },
    );
    const storage = createStorage(createGcsStore({ bucket: BUCKET, credentials: null, client }));
    const app = createApp({ config, storage });

    const health = await json(await app.request("/api/health"));
    expect(health).toEqual({
      ok: true,
      driver: "gcs",
      bucket: BUCKET,
      contentUrl: `https://storage.googleapis.com/${BUCKET}/${CONTENT_OBJECT}`,
      authConfigured: true,
    });
    // No local file serving in gcs mode.
    expect((await app.request(`/files/${CONTENT_OBJECT}`)).status).toBe(404);

    const { token } = await json<{ token: string }>(
      await app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: PASSWORD }),
      }),
    );

    const s1 = await app.request("/api/content", putJson(token, { content: seed, generation: null }));
    expect(s1.status).toBe(200);
    const g1 = (await json<{ generation: string }>(s1)).generation;
    const s2 = await app.request(
      "/api/content",
      putJson(token, { content: { ...seed, profile: { ...seed.profile, nickname: "gcs" } }, generation: g1 }),
    );
    expect(s2.status).toBe(200);
    expect((await app.request("/api/content", putJson(token, { content: seed, generation: g1 }))).status).toBe(409);

    const live = await json<{ content: Content; generation: string }>(await app.request("/api/content", authed(token)));
    expect(live.content.profile.nickname).toBe("gcs");
    expect(fake.objects.get(CONTENT_OBJECT)?.cacheControl).toBe("no-cache, max-age=0");
    expect([...fake.objects.keys()].filter((k) => k.startsWith("private/history/"))).toHaveLength(1);
    expect([...fake.objects.keys()].filter((k) => k.startsWith("content/history/"))).toHaveLength(0);
    expect(fake.objects.get("private/content.enc")?.cacheControl).toBe("private, no-store");
    expect(live.generation).toBe(String(fake.objects.get("private/content.enc")?.generation));

    const up = await app.request("/api/media", authed(token, { method: "POST", body: uploadForm(PNG_BYTES, "dot.png", "image/png") }));
    expect(up.status).toBe(201);
    const item = await json<MediaItem>(up);
    expect(item.url).toBe(`https://storage.googleapis.com/${BUCKET}/${item.path}`);
    expect(fake.objects.get(item.path)?.cacheControl).toBe("public, max-age=31536000, immutable");
    expect(fake.objects.get(item.path)?.contentType).toBe("image/png");

    const del = await app.request(`/api/media?path=${encodeURIComponent(item.path)}`, authed(token, { method: "DELETE" }));
    expect(del.status).toBe(200);
    expect(fake.objects.has(item.path)).toBe(false);
  });
});
