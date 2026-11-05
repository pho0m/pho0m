import { createHmac, hkdfSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { LoginLimiter } from "../src/auth.ts";
import { CONTENT_KEY_INFO, DecryptError, deriveContentKey, open, seal } from "../src/content-crypto.ts";
import { createMemoryStore } from "../src/storage/memory.ts";
import { createStorage, PRIVATE_CONTENT_OBJECT } from "../src/storage/storage.ts";
import { ConflictError } from "../src/storage/types.ts";

const SECRET = "test-session-secret-0123456789abcdef";
const enc = new TextEncoder();
const dec = new TextDecoder();

describe("content encryption", () => {
  const key = deriveContentKey(SECRET);

  it("derives a 32-byte key with HKDF-SHA256 (info pho0m-content-v1), separate from the token secret", () => {
    expect(CONTENT_KEY_INFO).toBe("pho0m-content-v1");
    expect(key).toHaveLength(32);
    expect(key.equals(Buffer.from(hkdfSync("sha256", SECRET, Buffer.alloc(0), "pho0m-content-v1", 32)))).toBe(true);
    expect(key.equals(deriveContentKey(SECRET))).toBe(true);
    expect(key.equals(deriveContentKey(`${SECRET}x`))).toBe(false);
    // Not the HS256 secret itself, nor a plain HMAC of it.
    expect(key.toString("hex")).not.toBe(SECRET);
    expect(key.equals(createHmac("sha256", SECRET).update(CONTENT_KEY_INFO).digest())).toBe(false);
  });

  it("round-trips UTF-8 (Thai) text in a v1 envelope", () => {
    const plain = JSON.stringify({ th: "เกียรติภูมิ พูลเขตร์กิจ", phone: "+66 81-PRIVATE" });
    const sealed = seal(key, plain);
    expect(sealed).not.toContain("PRIVATE");
    expect(sealed).not.toContain("เกียรติภูมิ");
    const env = JSON.parse(sealed) as Record<string, unknown>;
    expect(env.v).toBe(1);
    expect(open(key, sealed)).toBe(plain);
  });

  it("uses a fresh random IV each time", () => {
    const ivs = new Set(Array.from({ length: 20 }, () => (JSON.parse(seal(key, "same")) as { iv: string }).iv));
    expect(ivs.size).toBe(20);
  });

  it("refuses a wrong key, tampering and anything that is not a v1 envelope", () => {
    const sealed = seal(key, "hello world");
    expect(() => open(deriveContentKey("another-secret-of-at-least-32-chars"), sealed)).toThrow(DecryptError);

    const env = JSON.parse(sealed) as { v: number; iv: string; tag: string; data: string };
    const flip = (b64: string) => {
      const b = Buffer.from(b64, "base64");
      b[0] = b[0]! ^ 1;
      return b.toString("base64");
    };
    for (const bad of [
      { ...env, data: flip(env.data) },
      { ...env, tag: flip(env.tag) },
      { ...env, iv: flip(env.iv) },
      { ...env, v: 2 },
      { ...env, iv: Buffer.alloc(8).toString("base64") },
      { ...env, tag: "not base64!" },
      { v: 1 },
    ]) {
      expect(() => open(key, JSON.stringify(bad)), JSON.stringify(bad).slice(0, 60)).toThrow(DecryptError);
    }
    for (const junk of ["", "{not json", "[]", "null", JSON.stringify({ schemaVersion: 1 })]) {
      expect(() => open(key, junk), junk).toThrow(DecryptError);
    }
  });
});

describe("storage: private objects and legacy history", () => {
  const put = (store: ReturnType<typeof createMemoryStore>, path: string, text: string) =>
    store.put(path, enc.encode(text), { contentType: "application/json", cacheControl: "" });

  it("writePrivate checks the generation of private/content.enc", async () => {
    const store = createMemoryStore();
    const storage = createStorage(store);
    const a = await storage.writePrivate("one", null);
    await expect(storage.writePrivate("two", null)).rejects.toBeInstanceOf(ConflictError);
    const b = await storage.writePrivate("two", a.generation);
    await expect(storage.writePrivate("three", a.generation)).rejects.toMatchObject({ actual: b.generation });
    expect(await storage.readPrivate()).toEqual({ generation: b.generation, text: "two" });
    expect(store.peek(PRIVATE_CONTENT_OBJECT)?.cacheControl).toBe("private, no-store");
  });

  it("moves legacy plaintext history once, idempotently, and leaves foreign names alone", async () => {
    const store = createMemoryStore();
    const storage = createStorage(store);
    await put(store, "content/history/2026-10-01T00-00-00-000Z.json", "old-1");
    await put(store, "content/history/2026-10-02T00-00-00-000Z.json", "old-2");
    await put(store, "content/history/notes.txt", "not ours");
    await put(store, "content/history/has space.json", "not ours either");
    // An earlier run already wrote this one but stopped before deleting the plaintext.
    await put(store, "private/history/2026-10-02T00-00-00-000Z.enc", "sealed:old-2");

    const sealText = (t: string) => `sealed:${t}`;
    expect(await storage.migrateLegacyHistory(sealText)).toBe(2);
    expect(store.paths()).toEqual([
      "content/history/has space.json",
      "content/history/notes.txt",
      "private/history/2026-10-01T00-00-00-000Z.enc",
      "private/history/2026-10-02T00-00-00-000Z.enc",
    ]);
    expect(dec.decode(store.peek("private/history/2026-10-01T00-00-00-000Z.enc")!.bytes)).toBe("sealed:old-1");
    expect(await storage.migrateLegacyHistory(sealText)).toBe(0);
    expect((await storage.listHistory()).map((h) => h.path)).toEqual([
      "private/history/2026-10-02T00-00-00-000Z.enc",
      "private/history/2026-10-01T00-00-00-000Z.enc",
    ]);
  });

  it("history lives under private/history/ and is pruned there", async () => {
    const store = createMemoryStore();
    const storage = createStorage(store);
    const at = new Date("2026-11-04T09:00:00.000Z");
    expect(await storage.writeHistory("a", at)).toBe("private/history/2026-11-04T09-00-00-000Z.enc");
    expect(await storage.writeHistory("b", at)).toBe("private/history/2026-11-04T09-00-00-000Z-1.enc");
    for (let i = 1; i <= 3; i++) await storage.writeHistory(String(i), new Date(at.getTime() + i * 1000));
    expect(await storage.pruneHistory(2)).toBe(3);
    expect((await storage.listHistory()).map((h) => h.path)).toEqual([
      "private/history/2026-11-04T09-00-03-000Z.enc",
      "private/history/2026-11-04T09-00-02-000Z.enc",
    ]);
  });
});

describe("LoginLimiter.hasRecent", () => {
  it("is true only while a failure is inside the window, and false after reset", () => {
    const l = new LoginLimiter(5, 1000);
    expect(l.hasRecent("a", 0)).toBe(false);
    l.fail("a", 0);
    expect(l.hasRecent("a", 999)).toBe(true);
    expect(l.hasRecent("b", 999)).toBe(false);
    expect(l.hasRecent("a", 1000)).toBe(false);
    l.fail("a", 2000);
    l.reset("a");
    expect(l.hasRecent("a", 2001)).toBe(false);
  });
});
