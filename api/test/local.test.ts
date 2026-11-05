import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONTENT_OBJECT, type Content, type HistoryItem, type MediaItem } from "@pho0m/content";
import { seed } from "@pho0m/content/seed";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { deriveContentKey, open } from "../src/content-crypto.ts";
import { storageFromConfig } from "../src/storage/index.ts";
import { createLocalStore, isSafeObjectPath } from "../src/storage/local.ts";
import { PreconditionFailedError } from "../src/storage/types.ts";
import { PASSWORD, PDF_BYTES, PNG_BYTES, authed, json, putJson, uploadForm } from "./helpers.ts";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "pho0m-api-"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function makeLocalApp() {
  const config = loadConfig(
    { ADMIN_PASSWORD: PASSWORD, DATA_DIR: dir, PORT: "8799" },
    { defaultDataDir: "/unused" },
  );
  const storage = storageFromConfig(config);
  return { app: createApp({ config, storage, logger: { error() {}, warn() {} } }), storage, config };
}

describe("local driver end to end", () => {
  it("saves content, keeps history, uploads, serves and deletes files on disk", async () => {
    const { app, config } = makeLocalApp();
    const key = deriveContentKey(config.sessionSecret);
    const health = await json(await app.request("/api/health"));
    expect(health).toMatchObject({ driver: "local", bucket: null, contentUrl: `http://localhost:8799/files/${CONTENT_OBJECT}` });

    const login = await json<{ token: string }>(
      await app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: PASSWORD }),
      }),
    );
    const token = login.token;

    // Empty → seed.
    const empty = await json<{ generation: string | null }>(await app.request("/api/content", authed(token)));
    expect(empty.generation).toBeNull();

    // First save creates private/content.enc (encrypted, with the hidden phone and a draft frame)
    // and content/site.json (public projection, without them).
    const withSecrets: Content = {
      ...seed,
      profile: { ...seed.profile, phone: { value: "+66 81-PRIVATE", visible: false } },
      timeline: [...seed.timeline, { ...seed.timeline[0]!, id: "secret-draft", published: false }],
    };
    const s1 = await app.request("/api/content", putJson(token, { content: withSecrets, generation: null }));
    expect(s1.status).toBe(200);
    const g1 = (await json<{ generation: string }>(s1)).generation;
    const onDisk = JSON.parse(await fs.readFile(path.join(dir, "content/site.json"), "utf8")) as Content;
    expect(onDisk.schemaVersion).toBe(1);
    expect(onDisk.updatedAt).not.toBe("");
    expect(onDisk.profile.phone.value).toBe("");
    expect(onDisk.timeline.some((f) => f.id === "secret-draft")).toBe(false);
    const privateOnDisk = await fs.readFile(path.join(dir, "private/content.enc"), "utf8");
    expect(privateOnDisk).not.toContain("+66 81-PRIVATE");
    const decrypted = JSON.parse(open(key, privateOnDisk)) as Content;
    expect(decrypted.profile.phone.value).toBe("+66 81-PRIVATE");
    expect(decrypted.timeline.some((f) => f.id === "secret-draft")).toBe(true);
    const back = await json<{ content: Content; generation: string }>(await app.request("/api/content", authed(token)));
    expect(back.generation).toBe(g1);
    expect(back.content.profile.phone.value).toBe("+66 81-PRIVATE");

    // Second save → history copy of the first.
    const edited = { ...seed, profile: { ...seed.profile, nickname: "local" } };
    const s2 = await app.request("/api/content", putJson(token, { content: edited, generation: g1 }));
    expect(s2.status).toBe(200);
    const g2 = (await json<{ generation: string }>(s2)).generation;
    expect(BigInt(g2) > BigInt(g1)).toBe(true);

    // Stale generation → 409.
    const stale = await app.request("/api/content", putJson(token, { content: seed, generation: g1 }));
    expect(stale.status).toBe(409);

    const history = await json<{ items: HistoryItem[] }>(await app.request("/api/content/history", authed(token)));
    expect(history.items).toHaveLength(1);
    expect(history.items[0]!.path).toMatch(/^private\/history\/[0-9TZ-]+\.enc$/);
    const histFile = path.join(dir, history.items[0]!.path);
    const histText = await fs.readFile(histFile, "utf8");
    expect(histText).not.toContain("+66 81-PRIVATE");
    expect((JSON.parse(open(key, histText)) as Content).profile.phone.value).toBe("+66 81-PRIVATE");

    // Live content is served publicly at /files/content/site.json with no-cache.
    const pub = await app.request(`/files/${CONTENT_OBJECT}`);
    expect(pub.status).toBe(200);
    expect(pub.headers.get("cache-control")).toBe("no-cache, max-age=0");
    expect(pub.headers.get("content-type")).toBe("application/json");
    expect(((await pub.json()) as Content).profile.nickname).toBe("local");

    // Upload a PNG and a PDF.
    const up = await app.request("/api/media", authed(token, { method: "POST", body: uploadForm(PNG_BYTES, "pixel.png", "image/png", "frames") }));
    expect(up.status).toBe(201);
    const png = await json<MediaItem>(up);
    expect(png.url).toBe(`http://localhost:8799/files/${png.path}`);
    expect(await fs.readFile(path.join(dir, png.path))).toEqual(Buffer.from(PNG_BYTES));
    const pdf = await json<MediaItem>(
      await app.request("/api/media", authed(token, { method: "POST", body: uploadForm(PDF_BYTES, "cv.pdf", "application/pdf") })),
    );

    const list = await json<{ items: MediaItem[] }>(await app.request("/api/media", authed(token)));
    expect(list.items.map((i) => i.path).sort()).toEqual([png.path, pdf.path].sort());
    expect(list.items.find((i) => i.path === png.path)?.contentType).toBe("image/png");

    const served = await app.request(`/files/${png.path}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(PNG_BYTES);

    const del = await app.request(`/api/media?path=${encodeURIComponent(png.path)}`, authed(token, { method: "DELETE" }));
    expect(del.status).toBe(200);
    await expect(fs.stat(path.join(dir, png.path))).rejects.toThrow();
    expect((await app.request(`/files/${png.path}`)).status).toBe(404);

    // The private copy and its history are never served.
    expect((await app.request("/files/private/content.enc")).status).toBe(404);
    expect((await app.request(`/files/${history.items[0]!.path}`)).status).toBe(404);

    // Sidecar metadata is never served or listed.
    expect((await app.request(`/files/.meta/${CONTENT_OBJECT}.json`)).status).toBe(404);
    const after = await json<{ items: MediaItem[] }>(await app.request("/api/media", authed(token)));
    expect(after.items.map((i) => i.path)).toEqual([pdf.path]);
  });

  it("keeps generations strictly increasing and enforces preconditions", async () => {
    const store = createLocalStore({ dataDir: dir, publicBaseUrl: "http://x" });
    const enc = new TextEncoder();
    const a = await store.put("content/site.json", enc.encode("1"), { contentType: "application/json", cacheControl: "", ifGenerationMatch: "0" });
    await expect(
      store.put("content/site.json", enc.encode("2"), { contentType: "application/json", cacheControl: "", ifGenerationMatch: "0" }),
    ).rejects.toBeInstanceOf(PreconditionFailedError);
    const writes = await Promise.allSettled(
      [1, 2, 3].map((n) =>
        store.put("content/site.json", enc.encode(String(n)), {
          contentType: "application/json",
          cacheControl: "",
          ifGenerationMatch: a.generation,
        }),
      ),
    );
    // Concurrent writers based on the same generation: exactly one wins.
    expect(writes.filter((w) => w.status === "fulfilled")).toHaveLength(1);
    const got = await store.get("content/site.json");
    expect(BigInt(got!.generation) > BigInt(a.generation)).toBe(true);
  });

  it("refuses paths that escape the data dir", async () => {
    const store = createLocalStore({ dataDir: dir, publicBaseUrl: "http://x" });
    for (const bad of ["../outside.json", "media/../../x", "/etc/passwd", ".meta/content/site.json.json", "a//b", "a\\b"]) {
      expect(isSafeObjectPath(bad), bad).toBe(false);
      await expect(store.get(bad)).rejects.toThrow();
    }
    expect(isSafeObjectPath("media/2026/11/a-1234abcd.png")).toBe(true);
  });
});
