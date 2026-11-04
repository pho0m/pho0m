import { describe, expect, it } from "vitest";
import { LoginLimiter, bearer, clientKey, issueToken, passwordMatches, verifyToken } from "../src/auth.ts";
import { baseSlug, isDeletableMediaPath, mediaPath, sniffType } from "../src/media.ts";
import {
  DESIRED_CORS,
  corsIsCurrent,
  hasPublicRead,
  runSetup,
  withPublicRead,
  type BucketMeta,
  type BucketOps,
  type IamPolicy,
} from "../src/bucket-setup.ts";
import { PDF_BYTES, PNG_BYTES } from "./helpers.ts";

const bytes = (...parts: (number[] | string)[]) =>
  Uint8Array.from(parts.flatMap((p) => (typeof p === "string" ? [...p].map((ch) => ch.charCodeAt(0)) : p)));

describe("sniffType", () => {
  it("recognises every allowed type by its magic bytes", () => {
    expect(sniffType(bytes([0xff, 0xd8, 0xff, 0xe0], "JFIF"))).toEqual({ contentType: "image/jpeg", ext: "jpg" });
    expect(sniffType(PNG_BYTES)).toEqual({ contentType: "image/png", ext: "png" });
    expect(sniffType(bytes("GIF89a", [1, 0, 1, 0]))).toEqual({ contentType: "image/gif", ext: "gif" });
    expect(sniffType(bytes("RIFF", [0x24, 0, 0, 0], "WEBPVP8 "))).toEqual({ contentType: "image/webp", ext: "webp" });
    expect(sniffType(bytes([0, 0, 0, 0x1c], "ftypavif", [0, 0, 0, 0]))).toEqual({ contentType: "image/avif", ext: "avif" });
    expect(sniffType(bytes([0, 0, 0, 0x1c], "ftypavis", [0, 0, 0, 0]))).toEqual({ contentType: "image/avif", ext: "avif" });
    expect(sniffType(PDF_BYTES)).toEqual({ contentType: "application/pdf", ext: "pdf" });
  });

  it("rejects everything else", () => {
    for (const b of [
      bytes("<svg xmlns='http://www.w3.org/2000/svg'/>"),
      bytes("<!doctype html><script>"),
      bytes("RIFF", [0, 0, 0, 0], "WAVE"),
      bytes([0, 0, 0, 0x1c], "ftypisom"),
      bytes([0x89, 0x50, 0x4e]),
      bytes([0x50, 0x4b, 0x03, 0x04]),
      new Uint8Array(0),
    ]) {
      expect(sniffType(b)).toBeNull();
    }
  });
});

describe("media names", () => {
  it("builds media/<yyyy>/<mm>/<folder?>/<slug>-<8hex>.<ext>", () => {
    const now = new Date("2026-01-31T23:59:59Z");
    expect(mediaPath({ filename: "Screen Shot 2026.PNG", ext: "png", now, random: () => "0a1b2c3d" })).toBe(
      "media/2026/01/screen-shot-2026-0a1b2c3d.png",
    );
    expect(mediaPath({ filename: "cv.pdf", ext: "pdf", folder: "docs", now, random: () => "deadbeef" })).toBe(
      "media/2026/01/docs/cv-deadbeef.pdf",
    );
    expect(mediaPath({ filename: "x.png", ext: "png", now })).toMatch(/^media\/2026\/01\/x-[0-9a-f]{8}\.png$/);
  });

  it("slugs awkward names safely", () => {
    expect(baseSlug("../../etc/passwd")).toBe("passwd");
    expect(baseSlug("C:\\Users\\me\\photo.final.JPG")).toBe("photo-final");
    expect(baseSlug("รูปโปรไฟล์.png")).toBe("item");
    expect(baseSlug(".png")).toBe("item");
    expect(baseSlug(`${"a".repeat(59)}-b.png`)).toBe("a".repeat(59));
  });

  it("only allows deleting plain media paths", () => {
    expect(isDeletableMediaPath("media/2026/11/logo-0a1b2c3d.png")).toBe(true);
    expect(isDeletableMediaPath("media/2026/11/docs/cv_v2.pdf")).toBe(true);
    for (const p of ["media/../x", "media/a/../../b", "content/site.json", "media/", "media//a", "Media/a.png", "media/a b.png"]) {
      expect(isDeletableMediaPath(p), p).toBe(false);
    }
  });
});

describe("auth helpers", () => {
  it("compares passwords exactly", () => {
    expect(passwordMatches("abc", "abc")).toBe(true);
    expect(passwordMatches("abc", "abd")).toBe(false);
    expect(passwordMatches("", "abc")).toBe(false);
    expect(passwordMatches("abc ", "abc")).toBe(false);
  });

  it("issues tokens that verify until they expire", async () => {
    const t0 = new Date("2026-11-04T00:00:00Z");
    const { token, expiresAt } = await issueToken("k", t0, 60);
    expect(expiresAt).toBe("2026-11-04T00:01:00.000Z");
    expect(await verifyToken(token, "k", new Date("2026-11-04T00:00:59Z"))).toEqual({ exp: t0.getTime() / 1000 + 60 });
    expect(await verifyToken(token, "k", new Date("2026-11-04T00:01:00Z"))).toBeNull();
    expect(await verifyToken(token, "other", t0)).toBeNull();
  });

  it("parses bearer headers", () => {
    expect(bearer("Bearer abc.def.ghi")).toBe("abc.def.ghi");
    expect(bearer("bearer   abc")).toBe("abc");
    expect(bearer("Basic abc")).toBeNull();
    expect(bearer(undefined)).toBeNull();
  });

  it("limits failures per IP in a sliding window", () => {
    const l = new LoginLimiter(3, 1000);
    l.fail("a", 0);
    l.fail("a", 100);
    expect(l.retryAfter("a", 200)).toBe(0);
    l.fail("a", 200);
    expect(l.retryAfter("a", 300)).toBe(1);
    expect(l.retryAfter("b", 300)).toBe(0);
    expect(l.retryAfter("a", 1000)).toBe(0); // the failure at t=0 has expired
    l.reset("a");
    expect(l.retryAfter("a", 1001)).toBe(0);
  });

  it("keeps only the newest failures per key and still times them out correctly", () => {
    const l = new LoginLimiter(3, 1000);
    for (let t = 0; t < 1000; t += 10) l.fail("*", t);
    // 100 failures recorded, but only the last 3 (t=970, 980, 990) are kept and matter.
    const kept = (l as unknown as { failures: Map<string, number[]> }).failures.get("*");
    expect(kept).toEqual([970, 980, 990]);
    expect(l.retryAfter("*", 1000)).toBe(1);
    expect(l.retryAfter("*", 1970)).toBe(0);
  });

  it("takes the right-most X-Forwarded-For entry as the client", () => {
    expect(clientKey("198.51.100.1", undefined)).toBe("198.51.100.1");
    expect(clientKey("6.6.6.6, 198.51.100.1", "10.0.0.2")).toBe("198.51.100.1");
    expect(clientKey("spoof, also-spoof,  2001:db8::1  ", undefined)).toBe("2001:db8::1");
    expect(clientKey("6.6.6.6, ,", "10.0.0.2")).toBe("6.6.6.6");
    expect(clientKey("", "10.0.0.2")).toBe("10.0.0.2");
    expect(clientKey(undefined, "10.0.0.2")).toBe("10.0.0.2");
    expect(clientKey(undefined, undefined)).toBe("unknown");
    expect(clientKey(`a, ${"x".repeat(5000)}`, undefined)).toHaveLength(64);
  });
});

function fakeBucket(init: { exists?: boolean; meta?: BucketMeta; policy?: IamPolicy; deny?: Set<string> } = {}) {
  const state = {
    meta: structuredClone(init.meta ?? {}) as BucketMeta,
    policy: structuredClone(init.policy ?? { bindings: [{ role: "roles/storage.admin", members: ["user:owner@example.com"] }] }),
    calls: [] as string[],
  };
  const deny = (op: string) => {
    if (init.deny?.has(op)) throw Object.assign(new Error("caller lacks permission"), { code: 403 });
  };
  const ops: BucketOps = {
    name: "pho0m-content",
    exists: async () => init.exists ?? true,
    getMetadata: async () => structuredClone(state.meta),
    setCors: async (rules) => {
      deny("cors");
      state.calls.push("setCors");
      state.meta.cors = rules;
    },
    enableUniformAccess: async () => {
      deny("uniform");
      state.calls.push("uniform");
      state.meta.iamConfiguration = { ...state.meta.iamConfiguration, uniformBucketLevelAccess: { enabled: true } };
    },
    getPolicy: async () => structuredClone(state.policy),
    setPolicy: async (p) => {
      deny("policy");
      state.calls.push("setPolicy");
      state.policy = p;
    },
  };
  return { ops, state };
}

describe("bucket setup", () => {
  it("detects the wanted CORS rule and public read binding", () => {
    expect(corsIsCurrent(DESIRED_CORS)).toBe(true);
    expect(corsIsCurrent([{ ...DESIRED_CORS[0], method: ["HEAD", "GET"], responseHeader: ["content-type"] }])).toBe(true);
    expect(corsIsCurrent([{ ...DESIRED_CORS[0], maxAgeSeconds: 60 }])).toBe(false);
    expect(corsIsCurrent(undefined)).toBe(false);
    const p: IamPolicy = { bindings: [{ role: "roles/storage.objectViewer", members: ["user:a@example.com"] }] };
    expect(hasPublicRead(p)).toBe(false);
    const q = withPublicRead(p);
    expect(hasPublicRead(q)).toBe(true);
    expect(q.bindings).toHaveLength(1);
    expect(p.bindings[0]!.members).toEqual(["user:a@example.com"]);
  });

  it("configures a fresh bucket and is a no-op the second time", async () => {
    const { ops, state } = fakeBucket();
    const first = await runSetup(ops);
    expect(first.map((r) => `${r.step}:${r.status}`)).toEqual(["bucket:ok", "cors:changed", "uniform:changed", "publicRead:changed"]);
    expect(state.policy.bindings).toContainEqual({ role: "roles/storage.objectViewer", members: ["allUsers"] });
    expect(state.policy.bindings).toContainEqual({ role: "roles/storage.admin", members: ["user:owner@example.com"] });

    state.calls.length = 0;
    const second = await runSetup(ops);
    expect(second.map((r) => r.status)).toEqual(["ok", "ok", "ok", "ok"]);
    expect(state.calls).toEqual([]);
  });

  it("dry run changes nothing", async () => {
    const { ops, state } = fakeBucket();
    const r = await runSetup(ops, { dryRun: true });
    expect(r.map((x) => x.status)).toEqual(["ok", "would-change", "would-change", "would-change"]);
    expect(state.calls).toEqual([]);
  });

  it("explains how to finish by hand when permission is missing", async () => {
    const { ops } = fakeBucket({ deny: new Set(["cors", "uniform", "policy"]) });
    const r = await runSetup(ops);
    expect(r.slice(1).map((x) => x.status)).toEqual(["failed", "failed", "failed"]);
    expect(r[1]!.manual).toContain("gcloud storage buckets update gs://pho0m-content --cors-file=cors.json");
    expect(r[2]!.manual).toContain("--uniform-bucket-level-access");
    expect(r[3]!.manual).toContain("--member=allUsers --role=roles/storage.objectViewer");
    expect(r[3]!.detail).toContain("403");
  });

  it("reports public access prevention and a missing bucket", async () => {
    const pap = fakeBucket({ meta: { iamConfiguration: { publicAccessPrevention: "enforced" } } });
    const r = await runSetup(pap.ops);
    expect(r.at(-1)).toMatchObject({ step: "publicRead", status: "failed" });
    expect(r.at(-1)!.manual).toContain("--no-public-access-prevention");
    expect(pap.state.calls).not.toContain("setPolicy");

    const missing = await runSetup(fakeBucket({ exists: false }).ops);
    expect(missing).toHaveLength(1);
    expect(missing[0]!.manual).toContain("gcloud storage buckets create gs://pho0m-content");
  });
});
