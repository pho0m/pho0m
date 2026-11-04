import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ConfigError,
  DEFAULT_ALLOWED_ORIGINS,
  MIN_SESSION_SECRET_LENGTH,
  deriveSecret,
  describeConfig,
  loadConfig,
  parseServiceAccountKey,
  type Env,
} from "../src/config.ts";

const PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----\n";
const KEY = {
  type: "service_account",
  project_id: "kiattiphoom-pho0m",
  private_key_id: "abc123",
  private_key: PRIVATE_KEY,
  client_email: "admin-api@kiattiphoom-pho0m.iam.gserviceaccount.com",
};
const RAW = JSON.stringify(KEY, null, 2);
const B64 = Buffer.from(RAW).toString("base64");

const load = (env: Env) => loadConfig(env, { defaultDataDir: "/srv/api/.data", randomSecret: () => "rnd" });

describe("loadConfig defaults", () => {
  it("falls back to the local driver, port 8787 and the default origins", () => {
    const c = load({});
    expect(c.port).toBe(8787);
    expect(c.publicBaseUrl).toBe("http://localhost:8787");
    expect(c.driver).toEqual({ kind: "local", dataDir: path.resolve("/srv/api/.data") });
    expect(c.adminPassword).toBeNull();
    expect(c.allowedOrigins).toEqual([...DEFAULT_ALLOWED_ORIGINS]);
    expect(c.allowedOrigins).toEqual([
      "https://kiattiphoom-pho0m.web.app",
      "https://kiattiphoom-pho0m.firebaseapp.com",
      "http://localhost:5173",
      "http://localhost:4173",
    ]);
    expect(c.tokenTtlSeconds).toBe(12 * 3600);
    expect(c.sessionSecret).toBe("rnd");
    expect(c.sessionSecretSource).toBe("random");
  });

  it("reads PORT, PUBLIC_BASE_URL, DATA_DIR and ALLOWED_ORIGINS", () => {
    const c = load({
      PORT: "8080",
      DATA_DIR: "/var/data",
      ALLOWED_ORIGINS: " https://a.example/ , http://localhost:3000,https://a.example ",
    });
    expect(c.port).toBe(8080);
    expect(c.publicBaseUrl).toBe("http://localhost:8080");
    expect(c.driver).toEqual({ kind: "local", dataDir: "/var/data" });
    expect(c.allowedOrigins).toEqual(["https://a.example", "http://localhost:3000"]);
    expect(load({ PUBLIC_BASE_URL: "https://api.example.com/" }).publicBaseUrl).toBe("https://api.example.com");
  });

  it("rejects a bad PORT", () => {
    expect(() => load({ PORT: "eighty" })).toThrow(ConfigError);
    expect(() => load({ PORT: "70000" })).toThrow(ConfigError);
  });
});

describe("service account key", () => {
  it("accepts raw JSON", () => {
    const c = load({ SERVICE_ACCOUNT_KEY: RAW, SERVICE_ACCOUNT_BUCKET_NAME: "pho0m-content" });
    expect(c.driver).toEqual({
      kind: "gcs",
      bucket: "pho0m-content",
      credentials: { client_email: KEY.client_email, private_key: PRIVATE_KEY, project_id: "kiattiphoom-pho0m" },
    });
  });

  it("accepts base64 (also wrapped over several lines) and gives the same result", () => {
    const fromRaw = parseServiceAccountKey(RAW);
    expect(parseServiceAccountKey(B64)).toEqual(fromRaw);
    expect(parseServiceAccountKey(B64.replace(/(.{60})/g, "$1\n"))).toEqual(fromRaw);
  });

  it("turns literal \\n sequences in the private key into newlines", () => {
    const doubleEscaped = JSON.stringify({ ...KEY, private_key: PRIVATE_KEY.replace(/\n/g, "\\n") });
    expect(parseServiceAccountKey(doubleEscaped).private_key).toBe(PRIVATE_KEY);
  });

  it("rejects junk without echoing it", () => {
    for (const bad of ["not a key at all!", "{\"client_email\": 1}", Buffer.from("hello").toString("base64"), "{oops"]) {
      let err: unknown;
      try {
        parseServiceAccountKey(bad);
      } catch (e) {
        err = e;
      }
      expect(err, bad).toBeInstanceOf(ConfigError);
      expect((err as Error).message).not.toContain(bad);
    }
  });

  it("uses Application Default Credentials when only the bucket is set", () => {
    const c = load({ SERVICE_ACCOUNT_BUCKET_NAME: "pho0m-content", ADMIN_PASSWORD: "pw" });
    expect(c.driver).toEqual({ kind: "gcs", bucket: "pho0m-content", credentials: null });
    expect(c.sessionSecretSource).toBe("random");
  });

  it("refuses a key without a bucket", () => {
    expect(() => load({ SERVICE_ACCOUNT_KEY: RAW })).toThrow(/SERVICE_ACCOUNT_BUCKET_NAME/);
  });
});

describe("session secret", () => {
  const SECRET = "0123456789abcdef0123456789abcdef-long-enough";

  it("prefers SESSION_SECRET", () => {
    const c = load({ SESSION_SECRET: SECRET, SERVICE_ACCOUNT_KEY: RAW, SERVICE_ACCOUNT_BUCKET_NAME: "b", ADMIN_PASSWORD: "pw" });
    expect(c.sessionSecret).toBe(SECRET);
    expect(c.sessionSecretSource).toBe("SESSION_SECRET");
  });

  it("rejects a SESSION_SECRET shorter than 32 characters without echoing it", () => {
    expect(MIN_SESSION_SECRET_LENGTH).toBe(32);
    const short = "x".repeat(31);
    let err: unknown;
    try {
      load({ SESSION_SECRET: short, ADMIN_PASSWORD: "pw" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConfigError);
    expect((err as Error).message).toContain("at least 32 characters");
    expect((err as Error).message).toContain("openssl rand -hex 32");
    expect((err as Error).message).not.toContain(short);
    expect(load({ SESSION_SECRET: "x".repeat(32) }).sessionSecretSource).toBe("SESSION_SECRET");
  });

  it("derives a stable secret from the private key, never the key itself", () => {
    const a = load({ SERVICE_ACCOUNT_KEY: RAW, SERVICE_ACCOUNT_BUCKET_NAME: "b", ADMIN_PASSWORD: "pw" });
    const b = load({ SERVICE_ACCOUNT_KEY: B64, SERVICE_ACCOUNT_BUCKET_NAME: "b", ADMIN_PASSWORD: "other" });
    expect(a.sessionSecretSource).toBe("service-account-key");
    expect(a.sessionSecret).toBe(b.sessionSecret);
    expect(a.sessionSecret).toBe(deriveSecret(PRIVATE_KEY));
    expect(a.sessionSecret).toMatch(/^[0-9a-f]{64}$/);
    expect(a.sessionSecret).not.toContain("PRIVATE KEY");
  });

  it("never derives the secret from ADMIN_PASSWORD: without a secret or key it is random per process", () => {
    const c = load({ ADMIN_PASSWORD: "pw" });
    expect(c.adminPassword).toBe("pw");
    expect(c.sessionSecretSource).toBe("random");
    expect(c.sessionSecret).toBe("rnd");
    expect(c.sessionSecret).not.toBe(deriveSecret("pw"));
    // The real generator: 64 hex characters, different every time.
    const real = (env: Env) => loadConfig(env, { defaultDataDir: "/srv/api/.data" }).sessionSecret;
    const one = real({ ADMIN_PASSWORD: "pw" });
    expect(one).toMatch(/^[0-9a-f]{64}$/);
    expect(real({ ADMIN_PASSWORD: "pw" })).not.toBe(one);
    expect(one).not.toBe(deriveSecret("pw"));
    expect(describeConfig(c)).toContain("session secret: random");
  });
});

describe("redeploy dispatch", () => {
  const TOKEN = "github_pat_11ABCDEFG0123456789_secretpart";

  it("is off without GITHUB_DISPATCH_TOKEN", () => {
    expect(load({}).dispatch).toBeNull();
    expect(load({ GITHUB_REPOSITORY: "pho0m/pho0m", GITHUB_DISPATCH_TOKEN: "  " }).dispatch).toBeNull();
    expect(describeConfig(load({}))).toContain("redeploy on save: off");
  });

  it("reads the token and repository (default pho0m/pho0m)", () => {
    expect(load({ GITHUB_DISPATCH_TOKEN: ` ${TOKEN}\n` }).dispatch).toEqual({ token: TOKEN, repository: "pho0m/pho0m" });
    expect(load({ GITHUB_DISPATCH_TOKEN: TOKEN, GITHUB_REPOSITORY: "someone/site" }).dispatch).toEqual({
      token: TOKEN,
      repository: "someone/site",
    });
  });

  it("rejects a malformed repository or token without echoing the token", () => {
    for (const env of [
      { GITHUB_DISPATCH_TOKEN: TOKEN, GITHUB_REPOSITORY: "https://github.com/pho0m/pho0m" },
      { GITHUB_DISPATCH_TOKEN: `${TOKEN} extra` },
    ]) {
      let err: unknown;
      try {
        load(env);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as Error).message).not.toContain(TOKEN);
    }
  });
});

describe("describeConfig", () => {
  it("never prints secrets", () => {
    const c = load({
      SERVICE_ACCOUNT_KEY: RAW,
      SERVICE_ACCOUNT_BUCKET_NAME: "pho0m-content",
      ADMIN_PASSWORD: "hunter2-pw",
      GITHUB_DISPATCH_TOKEN: "github_pat_never_print_me",
      GITHUB_REPOSITORY: "pho0m/pho0m",
    });
    const line = describeConfig(c);
    expect(line).toContain("pho0m-content");
    expect(line).toContain(KEY.client_email);
    expect(line).toContain("redeploy on save: on (pho0m/pho0m)");
    expect(line).not.toContain("PRIVATE KEY");
    expect(line).not.toContain("hunter2-pw");
    expect(line).not.toContain("github_pat_never_print_me");
    expect(line).not.toContain(c.sessionSecret);
  });
});
