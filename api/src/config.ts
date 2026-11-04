import { createHmac, randomBytes } from "node:crypto";
import path from "node:path";
import { DEFAULT_GITHUB_REPOSITORY, isRepository } from "./redeploy.ts";

/**
 * Environment → Config. Pure (no I/O besides what the caller passes in) so it is easy to test.
 * Never put the service-account key or the admin password in an error message or a log line.
 */

export type ServiceAccountKey = {
  client_email: string;
  private_key: string;
  project_id?: string;
};

export type DriverConfig =
  | { kind: "gcs"; bucket: string; credentials: ServiceAccountKey | null }
  | { kind: "local"; dataDir: string };

export type Config = {
  port: number;
  /** Base URL used to build public file URLs for the local driver. */
  publicBaseUrl: string;
  driver: DriverConfig;
  /** null → login is disabled (503). */
  adminPassword: string | null;
  /** HS256 signing secret for session tokens. */
  sessionSecret: string;
  /** Where the session secret came from (safe to log). */
  sessionSecretSource: "SESSION_SECRET" | "service-account-key" | "ADMIN_PASSWORD" | "random";
  allowedOrigins: string[];
  tokenTtlSeconds: number;
  /**
   * GitHub repository_dispatch after each save (GITHUB_DISPATCH_TOKEN + GITHUB_REPOSITORY),
   * so the site's baked SEO files follow the content. null → off.
   */
  dispatch: { token: string; repository: string } | null;
};

export type Env = Record<string, string | undefined>;

export const DEFAULT_PORT = 8787;
export const TOKEN_TTL_SECONDS = 12 * 60 * 60;
export const DEFAULT_ALLOWED_ORIGINS = [
  "https://kiattiphoom-pho0m.web.app",
  "https://kiattiphoom-pho0m.firebaseapp.com",
  "http://localhost:5173",
  "http://localhost:4173",
] as const;

export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

function clean(v: string | undefined): string {
  return (v ?? "").trim();
}

/**
 * SERVICE_ACCOUNT_KEY may be the raw JSON key file or base64 of it.
 * Throws ConfigError (without echoing the value) when it is neither.
 */
export function parseServiceAccountKey(raw: string): ServiceAccountKey {
  const value = raw.trim();
  let text = value;
  if (!value.startsWith("{")) {
    const compact = value.replace(/\s+/g, "");
    if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(compact)) {
      throw new ConfigError("SERVICE_ACCOUNT_KEY is neither JSON nor base64-encoded JSON.");
    }
    text = Buffer.from(compact.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8").trim();
    if (!text.startsWith("{")) {
      throw new ConfigError("SERVICE_ACCOUNT_KEY is base64 but does not decode to a JSON object.");
    }
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ConfigError("SERVICE_ACCOUNT_KEY is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new ConfigError("SERVICE_ACCOUNT_KEY must be a JSON object.");
  }
  const o = parsed as Record<string, unknown>;
  const clientEmail = typeof o.client_email === "string" ? o.client_email.trim() : "";
  const privateKey = typeof o.private_key === "string" ? o.private_key : "";
  if (!clientEmail || !privateKey) {
    throw new ConfigError("SERVICE_ACCOUNT_KEY is missing client_email or private_key.");
  }
  const key: ServiceAccountKey = {
    client_email: clientEmail,
    // Keys pasted through some UIs end up with literal "\n" sequences.
    private_key: privateKey.includes("\\n") ? privateKey.replace(/\\n/g, "\n") : privateKey,
  };
  if (typeof o.project_id === "string" && o.project_id.trim()) key.project_id = o.project_id.trim();
  return key;
}

/** Derive a stable signing secret so no extra env var is needed. */
export function deriveSecret(material: string, purpose = "pho0m-admin-session-v1"): string {
  return createHmac("sha256", material).update(purpose).digest("hex");
}

export function parseOrigins(raw: string | undefined): string[] {
  const value = clean(raw);
  if (!value) return [...DEFAULT_ALLOWED_ORIGINS];
  const list = value
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return [...new Set(list)];
}

function parsePort(raw: string | undefined): number {
  const value = clean(raw);
  if (!value) return DEFAULT_PORT;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new ConfigError(`PORT must be 1-65535 (got "${value}").`);
  return n;
}

export type LoadConfigOptions = {
  /** Default folder for the local driver when DATA_DIR is unset (server.ts passes api/.data). */
  defaultDataDir: string;
  /** Used only when no secret material exists at all; injectable for tests. */
  randomSecret?: () => string;
};

export function loadConfig(env: Env, opts: LoadConfigOptions): Config {
  const port = parsePort(env.PORT);
  const publicBaseUrl = (clean(env.PUBLIC_BASE_URL) || `http://localhost:${port}`).replace(/\/+$/, "");

  const rawKey = clean(env.SERVICE_ACCOUNT_KEY);
  const bucket = clean(env.SERVICE_ACCOUNT_BUCKET_NAME);
  const key = rawKey ? parseServiceAccountKey(rawKey) : null;

  let driver: DriverConfig;
  if (bucket) {
    driver = { kind: "gcs", bucket, credentials: key };
  } else {
    if (key) {
      throw new ConfigError(
        "SERVICE_ACCOUNT_KEY is set but SERVICE_ACCOUNT_BUCKET_NAME is empty. Set the bucket name too.",
      );
    }
    const dataDir = clean(env.DATA_DIR);
    driver = { kind: "local", dataDir: path.resolve(dataDir || opts.defaultDataDir) };
  }

  const adminPassword = env.ADMIN_PASSWORD && env.ADMIN_PASSWORD.length > 0 ? env.ADMIN_PASSWORD : null;

  let sessionSecret: string;
  let sessionSecretSource: Config["sessionSecretSource"];
  const explicitSecret = clean(env.SESSION_SECRET);
  if (explicitSecret) {
    sessionSecret = explicitSecret;
    sessionSecretSource = "SESSION_SECRET";
  } else if (key) {
    sessionSecret = deriveSecret(key.private_key);
    sessionSecretSource = "service-account-key";
  } else if (adminPassword) {
    sessionSecret = deriveSecret(adminPassword);
    sessionSecretSource = "ADMIN_PASSWORD";
  } else {
    sessionSecret = (opts.randomSecret ?? (() => randomBytes(32).toString("hex")))();
    sessionSecretSource = "random";
  }

  return {
    port,
    publicBaseUrl,
    driver,
    adminPassword,
    sessionSecret,
    sessionSecretSource,
    allowedOrigins: parseOrigins(env.ALLOWED_ORIGINS),
    tokenTtlSeconds: TOKEN_TTL_SECONDS,
    dispatch: parseDispatch(env),
  };
}

/** GITHUB_DISPATCH_TOKEN (optional) + GITHUB_REPOSITORY (default pho0m/pho0m). Never echoes the token. */
export function parseDispatch(env: Env): Config["dispatch"] {
  const token = clean(env.GITHUB_DISPATCH_TOKEN);
  if (!token) return null;
  if (/\s/.test(token)) throw new ConfigError("GITHUB_DISPATCH_TOKEN contains whitespace; paste the token only.");
  const repository = clean(env.GITHUB_REPOSITORY) || DEFAULT_GITHUB_REPOSITORY;
  if (!isRepository(repository)) {
    throw new ConfigError(`GITHUB_REPOSITORY must look like owner/repo (got "${repository.slice(0, 120)}").`);
  }
  return { token, repository };
}

/** One-line, secret-free description for startup logs. */
export function describeConfig(config: Config): string {
  const d = config.driver;
  const storage =
    d.kind === "gcs"
      ? `gcs bucket=${d.bucket} credentials=${d.credentials ? `key(${d.credentials.client_email})` : "ADC"}`
      : `local dir=${d.dataDir}`;
  return [
    `storage: ${storage}`,
    `login: ${config.adminPassword ? "enabled" : "DISABLED (ADMIN_PASSWORD not set)"}`,
    `session secret: ${config.sessionSecretSource}`,
    `origins: ${config.allowedOrigins.join(", ")}`,
    `redeploy on save: ${config.dispatch ? `on (${config.dispatch.repository})` : "off (GITHUB_DISPATCH_TOKEN not set)"}`,
  ].join(" | ");
}
