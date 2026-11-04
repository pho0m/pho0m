import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { ConfigError, describeConfig, loadConfig, type Config } from "./config.ts";
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
const app = createApp({ config, storage });

const server = serve({ fetch: app.fetch, port: config.port, hostname: "0.0.0.0" }, (info) => {
  console.log(`[api] listening on http://localhost:${info.port}`);
  console.log(`[api] ${describeConfig(config)}`);
  if (config.driver.kind === "local") {
    console.log(`[api] local files served at ${config.publicBaseUrl}/files/…`);
  }
  if (config.sessionSecretSource === "random") {
    console.warn("[api] no secret material configured; sessions will not survive a restart.");
  }
});

function shutdown(signal: string): void {
  console.log(`[api] ${signal} received, closing…`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
