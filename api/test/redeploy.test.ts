import { describe, expect, it } from "vitest";
import {
  DISPATCH_EVENT,
  DISPATCH_INTERVAL_MS,
  RedeployTrigger,
  isRepository,
  type TimerHandle,
} from "../src/redeploy.ts";

const TOKEN = "github_pat_11TESTTOKEN0000000000_supersecretvalue";
const MIN = 60 * 1000;

type Call = { url: string; init: RequestInit };

/** Manual clock + timers + fetch, so the throttle can be driven step by step. */
function rig(respond: (n: number) => Response | Promise<Response> = () => new Response(null, { status: 204 })) {
  let now = Date.parse("2026-11-04T09:00:00Z");
  const timers: { at: number; fn: () => void; cancelled: boolean }[] = [];
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
    setTimer: (fn, ms): TimerHandle => {
      const t = { at: now + ms, fn, cancelled: false };
      timers.push(t);
      return { cancel: () => void (t.cancelled = true) };
    },
    fetch: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return respond(calls.length);
    },
    logger,
  });
  /** Move the clock forward, firing timers that come due. */
  async function advance(ms: number) {
    const until = now + ms;
    for (;;) {
      const next = timers.filter((t) => !t.cancelled && t.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      now = next.at;
      next.cancelled = true;
      next.fn();
    }
    now = until;
    await trigger.idle();
  }
  const live = () => timers.filter((t) => !t.cancelled);
  return { trigger, calls, logs, advance, live };
}

describe("RedeployTrigger", () => {
  it("POSTs a content-updated repository_dispatch to GitHub", async () => {
    const r = rig();
    r.trigger.notify();
    await r.trigger.idle();
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
  });

  it("sends at most one call per 5 minutes, plus one trailing call for saves inside the window", async () => {
    const r = rig();
    expect(DISPATCH_INTERVAL_MS).toBe(5 * MIN);

    r.trigger.notify(); // t=0 → immediate
    await r.trigger.idle();
    expect(r.calls).toHaveLength(1);

    await r.advance(1 * MIN);
    r.trigger.notify(); // t=1 → queued for t=5
    await r.advance(1 * MIN);
    r.trigger.notify(); // t=2 → folded into the same trailing call
    r.trigger.notify();
    expect(r.trigger.pending).toBe(true);
    expect(r.live()).toHaveLength(1);
    expect(r.calls).toHaveLength(1);

    await r.advance(3 * MIN - 1);
    expect(r.calls).toHaveLength(1); // t=4:59.999 still waiting
    await r.advance(1);
    expect(r.calls).toHaveLength(2); // t=5 trailing call
    expect(r.trigger.pending).toBe(false);

    // The trailing call opened a new window: a save at t=6 waits until t=10.
    await r.advance(1 * MIN);
    r.trigger.notify();
    await r.trigger.idle();
    expect(r.calls).toHaveLength(2);
    await r.advance(4 * MIN);
    expect(r.calls).toHaveLength(3);

    // Quiet for longer than the window: the next save goes out at once.
    await r.advance(30 * MIN);
    expect(r.calls).toHaveLength(3);
    r.trigger.notify();
    await r.trigger.idle();
    expect(r.calls).toHaveLength(4);
    expect(r.live()).toHaveLength(0);
  });

  it("does not send a trailing call when nothing was saved during the window", async () => {
    const r = rig();
    r.trigger.notify();
    await r.advance(60 * MIN);
    expect(r.calls).toHaveLength(1);
    expect(r.live()).toHaveLength(0);
  });

  it("never throws and never logs the token when GitHub refuses or the network fails", async () => {
    const r = rig((n) => {
      if (n === 1) return new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 });
      if (n === 2) throw new TypeError("fetch failed");
      return new Response("<html>", { status: 502 });
    });
    expect(() => r.trigger.notify()).not.toThrow();
    await r.trigger.idle();
    await r.advance(5 * MIN);
    r.trigger.notify();
    await r.trigger.idle();
    await r.advance(5 * MIN);
    r.trigger.notify();
    await r.trigger.idle();

    expect(r.calls).toHaveLength(3);
    const warns = r.logs.filter((l) => l.level === "warn").map((l) => l.text);
    expect(warns).toHaveLength(3);
    expect(warns[0]).toContain("HTTP 401 Bad credentials");
    expect(warns[0]).toContain("GITHUB_DISPATCH_TOKEN is invalid or expired");
    expect(warns[1]).toContain("TypeError: fetch failed");
    expect(warns[2]).toContain("HTTP 502");
    for (const l of r.logs) expect(l.text).not.toContain(TOKEN);
  });

  it("returns the outcome of a single dispatch", async () => {
    const ok = rig();
    expect(await ok.trigger.dispatch()).toEqual({ ok: true });
    const denied = rig(() => new Response(JSON.stringify({ message: "Not Found" }), { status: 404 }));
    const res = await denied.trigger.dispatch();
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toContain("Contents: read and write");
  });

  it("flush() sends a waiting trailing call right away (shutdown)", async () => {
    const r = rig();
    r.trigger.notify();
    await r.advance(1 * MIN);
    r.trigger.notify();
    expect(r.calls).toHaveLength(1);
    await r.trigger.flush();
    expect(r.calls).toHaveLength(2);
    expect(r.live()).toHaveLength(0);
    // Nothing waiting: flush is a no-op.
    await r.trigger.flush();
    expect(r.calls).toHaveLength(2);
  });

  it("uses an unref'd real timer by default", async () => {
    const calls: string[] = [];
    const t = new RedeployTrigger({
      token: TOKEN,
      repository: "pho0m/pho0m",
      fetch: async (url) => {
        calls.push(String(url));
        return new Response(null, { status: 204 });
      },
      logger: { warn: () => {}, error: () => {} },
      intervalMs: 20,
    });
    t.notify();
    t.notify();
    await t.idle();
    expect(calls).toHaveLength(1);
    expect(t.pending).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 60));
    await t.idle();
    expect(calls).toHaveLength(2);
    expect(t.pending).toBe(false);
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
