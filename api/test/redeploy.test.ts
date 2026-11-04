import { describe, expect, it } from "vitest";
import {
  DISPATCH_EVENT,
  DISPATCH_INTERVAL_MS,
  DISPATCH_TIMEOUT_MS,
  RedeployTrigger,
  isRepository,
} from "../src/redeploy.ts";

const TOKEN = "github_pat_11TESTTOKEN0000000000_supersecretvalue";
const MIN = 60 * 1000;

type Call = { url: string; init: RequestInit };

/** Manual clock + fetch, so the rate limit can be driven step by step. */
function rig(
  respond: (n: number, init: RequestInit) => Response | Promise<Response> = () => new Response(null, { status: 204 }),
  opts: { timeoutMs?: number } = {},
) {
  let now = Date.parse("2026-11-04T09:00:00Z");
  const calls: Call[] = [];
  const logs: { level: string; text: string }[] = [];
  const logger = {
    warn: (...a: unknown[]) => logs.push({ level: "warn", text: a.map(String).join(" ") }),
    error: (...a: unknown[]) => logs.push({ level: "error", text: a.map(String).join(" ") }),
    info: (...a: unknown[]) => logs.push({ level: "info", text: a.map(String).join(" ") }),
  };
  const trigger = new RedeployTrigger({
    token: TOKEN,
    repository: "pho0m/pho0m",
    now: () => now,
    fetch: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return respond(calls.length, init ?? {});
    },
    logger,
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
  });
  const advance = (ms: number) => {
    now += ms;
  };
  return { trigger, calls, logs, advance };
}

/** A fetch that only settles when its AbortSignal fires (a stalled connection). */
function hang(_n: number, init: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  });
}

describe("RedeployTrigger", () => {
  it("POSTs a content-updated repository_dispatch to GitHub and resolves after it (sent)", async () => {
    const r = rig();
    expect(await r.trigger.notify()).toBe("sent");
    expect(r.calls).toHaveLength(1);
    const { url, init } = r.calls[0]!;
    expect(url).toBe("https://api.github.com/repos/pho0m/pho0m/dispatches");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ event_type: DISPATCH_EVENT });
    expect(DISPATCH_EVENT).toBe("content-updated");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers.Accept).toBe("application/vnd.github+json");
    expect(headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(r.logs.some((l) => l.level === "info" && l.text.includes("pho0m/pho0m"))).toBe(true);
    expect(r.trigger.pending).toBe(false);
  });

  it("does not resolve before GitHub answers (the call is part of the save request)", async () => {
    let answer!: () => void;
    const r = rig(() => new Promise<Response>((resolve) => (answer = () => resolve(new Response(null, { status: 204 })))));
    let settled = false;
    const p = r.trigger.notify().then((s) => {
      settled = true;
      return s;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(r.calls).toHaveLength(1);
    expect(settled).toBe(false);
    answer();
    expect(await p).toBe("sent");
  });

  it("sends at most one call per 2 minutes; saves inside the window are queued for the next save after it", async () => {
    const r = rig();
    expect(DISPATCH_INTERVAL_MS).toBe(2 * MIN);

    expect(await r.trigger.notify()).toBe("sent"); // t=0
    r.advance(30_000);
    expect(await r.trigger.notify()).toBe("queued"); // t=0:30
    r.advance(60_000);
    expect(await r.trigger.notify()).toBe("queued"); // t=1:30, folded into the same queued call
    expect(r.calls).toHaveLength(1);
    expect(r.trigger.pending).toBe(true);

    // Nothing is sent by itself when the window ends (no timers)...
    r.advance(10 * MIN);
    expect(r.calls).toHaveLength(1);
    // ...the next save after the window carries it.
    expect(await r.trigger.notify()).toBe("sent");
    expect(r.calls).toHaveLength(2);
    expect(r.trigger.pending).toBe(false);

    // Exactly at the window edge a save goes out again.
    r.advance(2 * MIN - 1);
    expect(await r.trigger.notify()).toBe("queued");
    r.advance(1);
    expect(await r.trigger.notify()).toBe("sent");
    expect(r.calls).toHaveLength(3);
  });

  it("queues a call that arrives while another is in flight instead of sending twice", async () => {
    let answer!: () => void;
    const r = rig(() => new Promise<Response>((resolve) => (answer = () => resolve(new Response(null, { status: 204 })))));
    const first = r.trigger.notify();
    expect(await r.trigger.notify()).toBe("queued");
    answer();
    expect(await first).toBe("sent");
    expect(r.calls).toHaveLength(1);
    // The second save happened after the first call started, so it still needs a call.
    expect(r.trigger.pending).toBe(true);
  });

  it("gives up after the timeout (failed) and retries with the next save after the window", async () => {
    expect(DISPATCH_TIMEOUT_MS).toBe(4000);
    const r = rig((n, init) => (n === 1 ? hang(n, init) : new Response(null, { status: 204 })), { timeoutMs: 30 });
    const started = Date.now();
    expect(await r.trigger.notify()).toBe("failed");
    expect(Date.now() - started).toBeLessThan(2000);
    const warns = r.logs.filter((l) => l.level === "warn").map((l) => l.text);
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatch(/TimeoutError|AbortError|aborted/i);
    expect(r.trigger.pending).toBe(true);

    r.advance(30_000);
    expect(await r.trigger.notify()).toBe("queued"); // still inside the window: no hammering
    r.advance(2 * MIN);
    expect(await r.trigger.notify()).toBe("sent");
    expect(r.calls).toHaveLength(2);
    expect(r.trigger.pending).toBe(false);
  });

  it("never throws and never logs the token when GitHub refuses or the network fails", async () => {
    const r = rig((n) => {
      if (n === 1) return new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 });
      if (n === 2) throw new TypeError("fetch failed");
      return new Response("<html>", { status: 502 });
    });
    expect(await r.trigger.notify()).toBe("failed");
    r.advance(2 * MIN);
    expect(await r.trigger.notify()).toBe("failed");
    r.advance(2 * MIN);
    expect(await r.trigger.notify()).toBe("failed");

    expect(r.calls).toHaveLength(3);
    const warns = r.logs.filter((l) => l.level === "warn").map((l) => l.text);
    expect(warns).toHaveLength(3);
    expect(warns[0]).toContain("HTTP 401 Bad credentials");
    expect(warns[0]).toContain("GITHUB_DISPATCH_TOKEN is invalid or expired");
    expect(warns[1]).toContain("TypeError: fetch failed");
    expect(warns[2]).toContain("HTTP 502");
    for (const l of r.logs) expect(l.text).not.toContain(TOKEN);
  });

  it("returns failed instead of rejecting when something unexpected throws", async () => {
    const t = new RedeployTrigger({
      token: TOKEN,
      repository: "pho0m/pho0m",
      now: () => {
        throw new Error("clock broke");
      },
      logger: { warn: () => {}, error: () => {} },
    });
    await expect(t.notify()).resolves.toBe("failed");
  });

  it("returns the outcome of a single dispatch", async () => {
    const ok = rig();
    expect(await ok.trigger.dispatch()).toEqual({ ok: true });
    const denied = rig(() => new Response(JSON.stringify({ message: "Not Found" }), { status: 404 }));
    const res = await denied.trigger.dispatch();
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toContain("Contents: read and write");
  });

  it("flush() sends a queued call right away (shutdown) and is a no-op otherwise", async () => {
    const r = rig();
    await r.trigger.flush();
    expect(r.calls).toHaveLength(0);
    await r.trigger.notify();
    r.advance(1 * MIN);
    expect(await r.trigger.notify()).toBe("queued");
    expect(r.calls).toHaveLength(1);
    await r.trigger.flush();
    expect(r.calls).toHaveLength(2);
    expect(r.trigger.pending).toBe(false);
    await r.trigger.flush();
    expect(r.calls).toHaveLength(2);
  });
});

describe("isRepository", () => {
  it("accepts owner/repo only", () => {
    for (const ok of ["pho0m/pho0m", "some-org/repo.name_2"]) expect(isRepository(ok), ok).toBe(true);
    for (const bad of ["pho0m", "pho0m/pho0m/x", "../x", "a/..", "a b/c", "https://github.com/pho0m/pho0m", ""]) {
      expect(isRepository(bad), bad).toBe(false);
    }
  });
});
