import type { SaveContentResponse } from "@pho0m/content";

/**
 * Ask GitHub to rebuild the static site after the content changes.
 *
 * The site's SEO files (the static snapshot and JSON-LD in index.html, sitemap.xml, llms.txt,
 * llms-full.txt) are baked at build time, so a save in /admin only reaches crawlers after the
 * next deploy. When GITHUB_DISPATCH_TOKEN is set, a successful save sends a
 * `repository_dispatch` event ("content-updated"); .github/workflows/deploy.yml and readme.yml
 * listen for it.
 *
 * Part of the save request: the PUT handler awaits notify(), which gives up after
 * DISPATCH_TIMEOUT_MS (4 s). Nothing runs after the response, because Cloud Run throttles the
 * CPU of an instance that is not serving a request (a call left running in the background can
 * stall until its timeout and be dropped).
 *
 * Rate limit: at most one call per DISPATCH_INTERVAL_MS (2 minutes). A save inside the window is
 * answered "queued" and goes out with the next save after the window (no timers). A failed call
 * is queued the same way. On SIGTERM, flush() sends a queued call. Anything still missed is
 * caught by the daily scheduled deploy.
 * notify() never throws or rejects, and failures are only logged (without the token).
 */

export const DISPATCH_EVENT = "content-updated";
export const DISPATCH_INTERVAL_MS = 2 * 60 * 1000;
export const DISPATCH_TIMEOUT_MS = 4_000;
export const DEFAULT_GITHUB_REPOSITORY = "pho0m/pho0m";
const GITHUB_API = "https://api.github.com";

export type RedeployLogger = Pick<Console, "warn" | "error"> & { info?: (...args: unknown[]) => void };

/** What a save reports; "off" (no token) is decided by the app, not the trigger. */
export type RedeployStatus = Exclude<NonNullable<SaveContentResponse["redeploy"]>, "off">;

export type RedeployOptions = {
  token: string;
  /** "owner/repo" */
  repository: string;
  fetch?: typeof fetch;
  /** Milliseconds clock (tests). */
  now?: () => number;
  logger?: RedeployLogger;
  intervalMs?: number;
  timeoutMs?: number;
};

/**
 * What the app needs: called after a successful save and awaited before the response.
 * Must resolve within a few seconds and never reject.
 */
export type Redeployer = { notify(): Promise<RedeployStatus> };

export type DispatchResult = { ok: true } | { ok: false; reason: string };

export class RedeployTrigger implements Redeployer {
  private readonly token: string;
  readonly repository: string;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly log: RedeployLogger;
  private readonly intervalMs: number;
  private readonly timeoutMs: number;

  private lastSentAt: number | null = null;
  private queued = false;

  constructor(opts: RedeployOptions) {
    this.token = opts.token;
    this.repository = opts.repository;
    this.fetchFn = opts.fetch ?? ((...args) => fetch(...args));
    this.now = opts.now ?? Date.now;
    this.log = opts.logger ?? console;
    this.intervalMs = opts.intervalMs ?? DISPATCH_INTERVAL_MS;
    this.timeoutMs = opts.timeoutMs ?? DISPATCH_TIMEOUT_MS;
  }

  /**
   * A save happened. Outside the rate-limit window: send now and wait (at most timeoutMs) →
   * "sent" or "failed". Inside it: remember it for the next save → "queued". Never rejects.
   */
  async notify(): Promise<RedeployStatus> {
    try {
      const at = this.now();
      if (this.lastSentAt !== null && at - this.lastSentAt < this.intervalMs) {
        this.queued = true;
        return "queued";
      }
      return await this.send(at);
    } catch (err) {
      this.log.error("[redeploy] could not request the rebuild:", err instanceof Error ? err.message : String(err));
      return "failed";
    }
  }

  /** True while a call waits for the next save (or for flush()). */
  get pending(): boolean {
    return this.queued;
  }

  /**
   * Send a queued call right away, ignoring the window (process shutdown: Cloud Run sends
   * SIGTERM before it stops an instance, which would otherwise drop it).
   */
  async flush(): Promise<void> {
    if (this.queued) await this.send(this.now());
  }

  private async send(at: number): Promise<RedeployStatus> {
    // Set before awaiting, so a save arriving meanwhile is queued instead of sending twice.
    this.lastSentAt = at;
    this.queued = false;
    const result = await this.dispatch();
    if (result.ok) return "sent";
    // Try again with the next save after the window (or on shutdown).
    this.queued = true;
    return "failed";
  }

  /** One POST /repos/{repo}/dispatches with a timeout. Resolves with the outcome; never rejects. */
  async dispatch(): Promise<DispatchResult> {
    const url = `${GITHUB_API}/repos/${this.repository}/dispatches`;
    let reason: string;
    try {
      const res = await this.fetchFn(url, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
          "User-Agent": "pho0m-admin-api",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({ event_type: DISPATCH_EVENT }),
        // Started here, right before the request, while the save request still holds the CPU.
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (res.ok) {
        this.log.info?.(`[redeploy] asked GitHub to rebuild the site (${this.repository}, ${DISPATCH_EVENT})`);
        return { ok: true };
      }
      reason = `HTTP ${res.status}${await githubMessage(res)}${hint(res.status)}`;
    } catch (err) {
      reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    }
    // The token never appears here: the reason comes from the status, GitHub's message or the error.
    this.log.warn(`[redeploy] dispatch to ${this.repository} failed (the save itself succeeded): ${reason}`);
    return { ok: false, reason };
  }
}

async function githubMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: unknown };
    return typeof body.message === "string" ? ` ${body.message.slice(0, 200)}` : "";
  } catch {
    return "";
  }
}

function hint(status: number): string {
  if (status === 401) return " (GITHUB_DISPATCH_TOKEN is invalid or expired)";
  if (status === 403 || status === 404) {
    return " (the token needs access to this repository with Contents: read and write; check GITHUB_REPOSITORY)";
  }
  return "";
}

const REPO_RE = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;

/** "owner/repo" check for GITHUB_REPOSITORY. */
export function isRepository(value: string): boolean {
  return REPO_RE.test(value) && !value.endsWith("/.") && !value.endsWith("/..");
}
