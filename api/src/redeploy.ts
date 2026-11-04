/**
 * Ask GitHub to rebuild the static site after the content changes.
 *
 * The site's SEO files (the static snapshot and JSON-LD in index.html, sitemap.xml, llms.txt,
 * llms-full.txt) are baked at build time, so a save in /admin only reaches crawlers after the
 * next deploy. When GITHUB_DISPATCH_TOKEN is set, every successful save sends a
 * `repository_dispatch` event ("content-updated"); .github/workflows/deploy.yml and readme.yml
 * listen for it.
 *
 * Throttled: at most one call per window (5 minutes). Saves inside the window are folded into
 * one trailing call when the window ends, so a burst of edits costs two workflow runs at most.
 * Fire-and-forget: notify() never throws, never waits, and failures are only logged
 * (without the token).
 */

export const DISPATCH_EVENT = "content-updated";
export const DISPATCH_INTERVAL_MS = 5 * 60 * 1000;
export const DISPATCH_TIMEOUT_MS = 10_000;
export const DEFAULT_GITHUB_REPOSITORY = "pho0m/pho0m";
const GITHUB_API = "https://api.github.com";

export type RedeployLogger = Pick<Console, "warn" | "error"> & { info?: (...args: unknown[]) => void };

export type TimerHandle = { cancel(): void };

export type RedeployOptions = {
  token: string;
  /** "owner/repo" */
  repository: string;
  fetch?: typeof fetch;
  /** Milliseconds clock (tests). */
  now?: () => number;
  /** Schedule fn after ms (tests). The default timer is unref'd so it never keeps the process alive. */
  setTimer?: (fn: () => void, ms: number) => TimerHandle;
  logger?: RedeployLogger;
  intervalMs?: number;
  timeoutMs?: number;
};

/** What the app needs: a call that never throws or blocks. */
export type Redeployer = { notify(): void };

export type DispatchResult = { ok: true } | { ok: false; reason: string };

const defaultTimer = (fn: () => void, ms: number): TimerHandle => {
  const handle = setTimeout(fn, ms);
  handle.unref?.();
  return { cancel: () => clearTimeout(handle) };
};

export class RedeployTrigger implements Redeployer {
  private readonly token: string;
  readonly repository: string;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => TimerHandle;
  private readonly log: RedeployLogger;
  private readonly intervalMs: number;
  private readonly timeoutMs: number;

  private lastSentAt: number | null = null;
  private trailing: TimerHandle | null = null;
  private readonly inflight = new Set<Promise<DispatchResult>>();

  constructor(opts: RedeployOptions) {
    this.token = opts.token;
    this.repository = opts.repository;
    this.fetchFn = opts.fetch ?? ((...args) => fetch(...args));
    this.now = opts.now ?? Date.now;
    this.setTimer = opts.setTimer ?? defaultTimer;
    this.log = opts.logger ?? console;
    this.intervalMs = opts.intervalMs ?? DISPATCH_INTERVAL_MS;
    this.timeoutMs = opts.timeoutMs ?? DISPATCH_TIMEOUT_MS;
  }

  /** A save happened: dispatch now, or once when the current window ends. Never throws. */
  notify(): void {
    try {
      if (this.trailing) return; // a trailing call is already queued for the end of the window
      const at = this.now();
      if (this.lastSentAt === null || at - this.lastSentAt >= this.intervalMs) {
        this.send(at);
        return;
      }
      const wait = Math.max(0, this.lastSentAt + this.intervalMs - at);
      this.trailing = this.setTimer(() => {
        this.trailing = null;
        this.send(this.now());
      }, wait);
    } catch (err) {
      this.log.error("[redeploy] could not schedule the dispatch:", err instanceof Error ? err.message : String(err));
    }
  }

  /** True while a trailing call waits for the window to end. */
  get pending(): boolean {
    return this.trailing !== null;
  }

  /**
   * Send a queued trailing call right away and wait for in-flight calls (process shutdown:
   * Cloud Run sends SIGTERM before it stops an instance, which would otherwise drop it).
   */
  async flush(): Promise<void> {
    if (this.trailing) {
      this.trailing.cancel();
      this.trailing = null;
      this.send(this.now());
    }
    await this.idle();
  }

  /** Wait until every dispatch already started has finished (tests, shutdown). */
  async idle(): Promise<void> {
    while (this.inflight.size) await Promise.all([...this.inflight]);
  }

  private send(at: number): void {
    this.lastSentAt = at;
    const p: Promise<DispatchResult> = this.dispatch().finally(() => this.inflight.delete(p));
    this.inflight.add(p);
  }

  /** One POST /repos/{repo}/dispatches. Resolves with the outcome; never rejects. */
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
