import { fileURLToPath } from "node:url";
import { CONTENT_OBJECT } from "@pho0m/content";
import { runSetup, type BucketOps, type IamPolicy, type StepResult } from "./bucket-setup.ts";
import { ConfigError, loadConfig } from "./config.ts";
import { gcsClient, gcsPublicUrl } from "./storage/gcs.ts";

/**
 * npm run setup:bucket [-- --dry-run]
 * Prepares SERVICE_ACCOUNT_BUCKET_NAME for the site: public-read CORS, uniform bucket-level
 * access, and allUsers objectViewer. Safe to run again; it only changes what differs.
 */

const dryRun = process.argv.includes("--dry-run");

function main(): Promise<number> | number {
  let config;
  try {
    config = loadConfig(process.env, { defaultDataDir: fileURLToPath(new URL("../.data", import.meta.url)) });
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`Configuration error: ${err.message}`);
      return 1;
    }
    throw err;
  }
  if (config.driver.kind !== "gcs") {
    console.error(
      "SERVICE_ACCOUNT_BUCKET_NAME is not set, so there is no bucket to prepare.\n" +
        "Set it (and SERVICE_ACCOUNT_KEY, or use `gcloud auth application-default login`) and run again.",
    );
    return 1;
  }
  const { bucket: name, credentials } = config.driver;
  const bucket = gcsClient(credentials).bucket(name);

  const ops: BucketOps = {
    name,
    exists: async () => (await bucket.exists())[0],
    getMetadata: async () => (await bucket.getMetadata())[0],
    setCors: async (rules) => {
      await bucket.setCorsConfiguration(rules);
    },
    enableUniformAccess: async () => {
      await bucket.setMetadata({ iamConfiguration: { uniformBucketLevelAccess: { enabled: true } } });
    },
    getPolicy: async () => (await bucket.iam.getPolicy({ requestedPolicyVersion: 3 }))[0] as IamPolicy,
    setPolicy: async (policy) => {
      await bucket.iam.setPolicy({ ...policy, version: Math.max(policy.version ?? 1, 1) });
    },
  };

  console.log(`Preparing gs://${name}${dryRun ? " (dry run, nothing will change)" : ""}`);
  console.log(`Credentials: ${credentials ? `service account ${credentials.client_email}` : "Application Default Credentials"}\n`);

  return runSetup(ops, { dryRun }).then((results) => report(results, name, credentials?.client_email ?? null));
}

const ICON: Record<StepResult["status"], string> = {
  ok: "[ok]     ",
  changed: "[changed]",
  "would-change": "[todo]   ",
  failed: "[FAILED] ",
  skipped: "[skip]   ",
};

function report(results: StepResult[], bucket: string, serviceAccount: string | null): number {
  for (const r of results) {
    console.log(`${ICON[r.status]} ${r.step}: ${r.detail}`);
    if (r.manual) console.log(`           do it by hand:\n             ${r.manual}`);
  }
  const failed = results.filter((r) => r.status === "failed");
  console.log("");
  if (failed.length) {
    console.log(
      "Some steps need more permission than these credentials have (roles/storage.admin on the bucket),\n" +
        "or are blocked by an organization policy. Run the commands above as a project owner.",
    );
  } else {
    console.log("Bucket is ready.");
  }
  console.log(`\nThe site reads:  ${gcsPublicUrl(bucket, CONTENT_OBJECT)}`);
  console.log(`  → set VITE_CONTENT_URL to that URL when building web/.`);
  const member = serviceAccount ? `serviceAccount:${serviceAccount}` : "serviceAccount:<cloud-run-service-account>";
  console.log(
    `The API's service account needs object read/write on the bucket:\n` +
      `  gcloud storage buckets add-iam-policy-binding gs://${bucket} --member=${member} --role=roles/storage.objectAdmin`,
  );
  return failed.length ? 2 : 0;
}

Promise.resolve()
  .then(main)
  .then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error("Unexpected error:", err instanceof Error ? err.message : err);
      process.exit(1);
    },
  );
