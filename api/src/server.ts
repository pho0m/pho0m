import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { ConfigError, describeConfig, loadConfig, type Config } from "./config.ts";
import { RedeployTrigger } from "./redeploy.ts";
import { storageFromConfig } from "./storage/index.ts";

/** Entry point: env → config → storage → app → HTTP server. */

// src/server.ts (tsx) and dist/server.js (bundle) both sit one level below api/.
const defaultDataDir = fileURLToPath(new URL("../.data", import.meta.url));

let config: Config;
try {
  config = loadConfig(process.env, { defaultDataDir });
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(`[api] configuration error: ${err.message}`);
    process.exit(1);
  }
  throw err;
}

const storage = storageFromConfig(config);
const redeploy = config.dispatch ? new RedeployTrigger({ ...config.dispatch, logger: console }) : null;
const app = createApp({ config, storage, redeploy });

const server = serve({ fetch: app.fetch, port: config.port, hostname: "0.0.0.0" }, (info) => {
  console.log(`[api] listening on http://localhost:${info.port}`);
  console.log(`[api] ${describeConfig(config)}`);
  if (config.driver.kind === "local") {
    console.log(`[api] local files served at ${config.publicBaseUrl}/files/…`);
  }
  if (config.sessionSecretSource === "random") {
    console.warn(
      "[api] WARNING: SESSION_SECRET is not set (and there is no SERVICE_ACCOUNT_KEY), so this process uses a " +
        "random secret. Sessions and the encrypted drafts (private/content.enc) will not survive a restart: " +
        "after one, everyone must log in again and the admin shows only the published version (unpublished " +
        "drafts and hidden items saved before are lost). Set SESSION_SECRET (openssl rand -hex 32).",
    );
  }
});

function shutdown(signal: string): void {
  console.log(`[api] ${signal} received, closing…`);
  // Cloud Run allows ~10 s after SIGTERM: send a rebuild request still queued by the rate limit.
  const flushed = redeploy?.flush() ?? Promise.resolve();
  server.close(() => {
    void flushed.finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
