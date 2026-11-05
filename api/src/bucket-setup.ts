/**
 * Bucket preparation logic used by `npm run setup:bucket` (src/setup-bucket.ts).
 * Kept free of the GCS SDK so it can be tested with a fake bucket.
 */

export type CorsRule = { origin?: string[]; method?: string[]; responseHeader?: string[]; maxAgeSeconds?: number };
export type PolicyBinding = {
  role: string;
  members: string[];
  condition?: { expression: string; title?: string; description?: string };
};
export type IamPolicy = { bindings: PolicyBinding[]; version?: number; etag?: string };
export type BucketMeta = {
  cors?: CorsRule[];
  iamConfiguration?: {
    publicAccessPrevention?: string;
    uniformBucketLevelAccess?: { enabled?: boolean };
  };
};

/** The few bucket operations the setup needs (adapted from the real SDK in setup-bucket.ts). */
export interface BucketOps {
  readonly name: string;
  exists(): Promise<boolean>;
  getMetadata(): Promise<BucketMeta>;
  setCors(rules: CorsRule[]): Promise<void>;
  enableUniformAccess(): Promise<void>;
  getPolicy(): Promise<IamPolicy>;
  setPolicy(policy: IamPolicy): Promise<void>;
}

export const PUBLIC_READ_ROLE = "roles/storage.objectViewer";
export const PUBLIC_MEMBER = "allUsers";
export const DESIRED_CORS: CorsRule[] = [
  { origin: ["*"], method: ["GET", "HEAD"], responseHeader: ["Content-Type"], maxAgeSeconds: 3600 },
];

const sorted = (a: string[] | undefined) => [...(a ?? [])].sort();
const sameList = (a: string[] | undefined, b: string[] | undefined) =>
  JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

/** True when the bucket already has exactly the CORS rule we want. */
export function corsIsCurrent(current: CorsRule[] | undefined): boolean {
  if (!current || current.length !== DESIRED_CORS.length) return false;
  return DESIRED_CORS.every((want, i) => {
    const have = current[i];
    return (
      !!have &&
      sameList(have.origin, want.origin) &&
      sameList(have.method, want.method) &&
      sameList(
        have.responseHeader?.map((h) => h.toLowerCase()),
        want.responseHeader?.map((h) => h.toLowerCase()),
      ) &&
      have.maxAgeSeconds === want.maxAgeSeconds
    );
  });
}

export function hasPublicRead(policy: IamPolicy): boolean {
  return policy.bindings.some(
    (b) => b.role === PUBLIC_READ_ROLE && !b.condition && b.members.includes(PUBLIC_MEMBER),
  );
}

/** Policy with allUsers added to an unconditional objectViewer binding (input is not mutated). */
export function withPublicRead(policy: IamPolicy): IamPolicy {
  if (hasPublicRead(policy)) return policy;
  const bindings = policy.bindings.map((b) => ({ ...b, members: [...b.members] }));
  const target = bindings.find((b) => b.role === PUBLIC_READ_ROLE && !b.condition);
  if (target) target.members.push(PUBLIC_MEMBER);
  else bindings.push({ role: PUBLIC_READ_ROLE, members: [PUBLIC_MEMBER] });
  return { ...policy, bindings };
}

export function manualCommands(bucket: string): Record<"cors" | "uniform" | "publicRead" | "pap", string> {
  const gs = `gs://${bucket}`;
  return {
    cors:
      `echo '${JSON.stringify(DESIRED_CORS)}' > cors.json && ` + `gcloud storage buckets update ${gs} --cors-file=cors.json`,
    uniform: `gcloud storage buckets update ${gs} --uniform-bucket-level-access`,
    publicRead: `gcloud storage buckets add-iam-policy-binding ${gs} --member=${PUBLIC_MEMBER} --role=${PUBLIC_READ_ROLE}`,
    pap: `gcloud storage buckets update ${gs} --no-public-access-prevention`,
  };
}

function code(err: unknown): number | null {
  const c = err && typeof err === "object" ? (err as { code?: unknown }).code : undefined;
  return typeof c === "number" ? c : typeof c === "string" && /^\d+$/.test(c) ? Number(c) : null;
}

function reason(err: unknown): string {
  const c = code(err);
  const msg = err instanceof Error ? err.message : String(err);
  if (c === 403) return `permission denied (403): ${msg}`;
  return c ? `${c}: ${msg}` : msg;
}

export type StepStatus = "ok" | "changed" | "would-change" | "failed" | "skipped";
export type StepResult = { step: "bucket" | "cors" | "uniform" | "publicRead"; status: StepStatus; detail: string; manual?: string };

/**
 * Idempotent: each step checks first and only changes what differs.
 * Never throws for permission problems; the result says what to run by hand instead.
 */
export async function runSetup(bucket: BucketOps, opts: { dryRun?: boolean } = {}): Promise<StepResult[]> {
  const out: StepResult[] = [];
  const manual = manualCommands(bucket.name);

  let exists: boolean;
  try {
    exists = await bucket.exists();
  } catch (err) {
    out.push({ step: "bucket", status: "failed", detail: `could not check the bucket: ${reason(err)}` });
    return out;
  }
  if (!exists) {
    out.push({
      step: "bucket",
      status: "failed",
      detail: `bucket ${bucket.name} does not exist (or is not visible to these credentials)`,
      manual: `gcloud storage buckets create gs://${bucket.name} --location=asia-southeast1 --uniform-bucket-level-access`,
    });
    return out;
  }

  let meta: BucketMeta = {};
  try {
    meta = await bucket.getMetadata();
    out.push({ step: "bucket", status: "ok", detail: `bucket ${bucket.name} found` });
  } catch (err) {
    out.push({ step: "bucket", status: "failed", detail: `could not read bucket settings: ${reason(err)}` });
  }

  // 1) CORS: public GET/HEAD from any origin so the site (and canvas dithering) can fetch objects.
  if (corsIsCurrent(meta.cors)) {
    out.push({ step: "cors", status: "ok", detail: "CORS already allows GET/HEAD from any origin" });
  } else if (opts.dryRun) {
    out.push({ step: "cors", status: "would-change", detail: `would set CORS to ${JSON.stringify(DESIRED_CORS)}` });
  } else {
    try {
      await bucket.setCors(DESIRED_CORS);
      out.push({ step: "cors", status: "changed", detail: `set CORS to ${JSON.stringify(DESIRED_CORS)}` });
    } catch (err) {
      out.push({ step: "cors", status: "failed", detail: `could not set CORS: ${reason(err)}`, manual: manual.cors });
    }
  }

  // 2) Uniform bucket-level access (IAM only, no per-object ACLs).
  if (meta.iamConfiguration?.uniformBucketLevelAccess?.enabled) {
    out.push({ step: "uniform", status: "ok", detail: "uniform bucket-level access already on" });
  } else if (opts.dryRun) {
    out.push({ step: "uniform", status: "would-change", detail: "would enable uniform bucket-level access" });
  } else {
    try {
      await bucket.enableUniformAccess();
      out.push({ step: "uniform", status: "changed", detail: "enabled uniform bucket-level access" });
    } catch (err) {
      out.push({
        step: "uniform",
        status: "failed",
        detail: `could not enable uniform bucket-level access: ${reason(err)}`,
        manual: manual.uniform,
      });
    }
  }

  // 3) Public read for everyone (the site reads content/site.json and media/ directly).
  if (meta.iamConfiguration?.publicAccessPrevention === "enforced") {
    out.push({
      step: "publicRead",
      status: "failed",
      detail:
        "public access prevention is enforced on this bucket, so allUsers cannot be granted read access. " +
        "Turn it off (an organization policy may also block it), then run this again.",
      manual: `${manual.pap} && ${manual.publicRead}`,
    });
    return out;
  }
  try {
    const policy = await bucket.getPolicy();
    if (hasPublicRead(policy)) {
      out.push({ step: "publicRead", status: "ok", detail: `${PUBLIC_MEMBER} already has ${PUBLIC_READ_ROLE}` });
    } else if (opts.dryRun) {
      out.push({ step: "publicRead", status: "would-change", detail: `would grant ${PUBLIC_MEMBER} ${PUBLIC_READ_ROLE}` });
    } else {
      await bucket.setPolicy(withPublicRead(policy));
      out.push({ step: "publicRead", status: "changed", detail: `granted ${PUBLIC_MEMBER} ${PUBLIC_READ_ROLE}` });
    }
  } catch (err) {
    out.push({
      step: "publicRead",
      status: "failed",
      detail: `could not grant public read: ${reason(err)}`,
      manual: manual.publicRead,
    });
  }
  return out;
}
