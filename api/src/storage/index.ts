import type { Config } from "../config.ts";
import { createGcsStore } from "./gcs.ts";
import { createLocalStore } from "./local.ts";
import { createStorage } from "./storage.ts";
import type { Storage } from "./types.ts";

export { createStorage } from "./storage.ts";
export type * from "./types.ts";

/** Pick the driver from config: GCS when a bucket is set, otherwise local disk. */
export function storageFromConfig(config: Config): Storage {
  const d = config.driver;
  if (d.kind === "gcs") return createStorage(createGcsStore({ bucket: d.bucket, credentials: d.credentials }));
  return createStorage(createLocalStore({ dataDir: d.dataDir, publicBaseUrl: config.publicBaseUrl }));
}
