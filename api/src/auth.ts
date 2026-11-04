import { createHash, timingSafeEqual } from "node:crypto";
import { sign, verify } from "hono/jwt";

/** Session tokens (HS256 JWT, sub "admin") and login throttling. */

/** Per client IP: 5 failed logins per 10 minutes. */
export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_WINDOW_MS = 10 * 60 * 1000;
/**
 * Across all IPs: 30 failed logins per 10 minutes. Backstop for attackers that rotate
 * addresses: while it is hit, every address with a failed login in the last 10 minutes is
 * refused (429). Clean addresses (normally the owner) can still log in, and each new address
 * gets one guess before it is refused too.
 */
export const GLOBAL_LOGIN_MAX_FAILURES = 30;
const MAX_TRACKED_IPS = 10_000;
/** Longest client key kept (an IPv6 address with zone fits easily). */
const MAX_KEY_LENGTH = 64;

/** Constant-time compare: hash both sides so lengths never leak through timing. */
export function passwordMatches(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

export async function issueToken(
  secret: string,
  now: Date,
  ttlSeconds: number,
): Promise<{ token: string; expiresAt: string }> {
  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + ttlSeconds;
  const token = await sign({ sub: "admin", iat, exp }, secret, "HS256");
  return { token, expiresAt: new Date(exp * 1000).toISOString() };
}

/**
 * Verify signature and claims against the injected clock. Returns the expiry (seconds) or null.
 * hono's own exp/nbf/iat checks use the real clock, so they are off and done here instead.
 */
export async function verifyToken(token: string, secret: string, now: Date): Promise<{ exp: number } | null> {
  let payload: Record<string, unknown>;
  try {
    payload = (await verify(token, secret, { alg: "HS256", exp: false, nbf: false, iat: false })) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
  if (payload.sub !== "admin") return null;
  const exp = payload.exp;
  if (typeof exp !== "number" || !Number.isFinite(exp)) return null;
  if (exp * 1000 <= now.getTime()) return null;
  return { exp };
}

/** Bearer token from an Authorization header, or null. */
export function bearer(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+([A-Za-z0-9._~+/=-]+)\s*$/i.exec(header);
  return m?.[1] ?? null;
}

/**
 * Client address for rate limiting. Google's front end (Cloud Run) APPENDS the address it saw to
 * X-Forwarded-For, so only the right-most entry is trustworthy; anything to its left was sent by
 * the client and can be spoofed. Without the header (local dev) the socket address is used.
 */
export function clientKey(xff: string | undefined, remoteAddress: string | undefined): string {
  const last = xff
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .pop();
  return (last || remoteAddress || "unknown").slice(0, MAX_KEY_LENGTH);
}

/** In-memory sliding window of failed logins per key (client IP, or one shared key), per instance. */
export class LoginLimiter {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly max = LOGIN_MAX_FAILURES,
    private readonly windowMs = LOGIN_WINDOW_MS,
  ) {}

  private recent(ip: string, nowMs: number): number[] {
    const list = (this.failures.get(ip) ?? []).filter((t) => nowMs - t < this.windowMs);
    if (list.length) this.failures.set(ip, list);
    else this.failures.delete(ip);
    return list;
  }

  /** Seconds until the next attempt is allowed, or 0 when allowed now. */
  retryAfter(ip: string, nowMs: number): number {
    const list = this.recent(ip, nowMs);
    if (list.length < this.max) return 0;
    const oldest = list[list.length - this.max] ?? nowMs;
    return Math.max(1, Math.ceil((oldest + this.windowMs - nowMs) / 1000));
  }

  /** True when this key has at least one failure inside the window. */
  hasRecent(ip: string, nowMs: number): boolean {
    return this.recent(ip, nowMs).length > 0;
  }

  fail(ip: string, nowMs: number): void {
    const list = this.recent(ip, nowMs);
    list.push(nowMs);
    // Only the newest `max` failures matter for retryAfter(); keep memory bounded.
    if (list.length > this.max) list.splice(0, list.length - this.max);
    this.failures.set(ip, list);
    if (this.failures.size > MAX_TRACKED_IPS) this.sweep(nowMs);
  }

  reset(ip: string): void {
    this.failures.delete(ip);
  }

  private sweep(nowMs: number): void {
    for (const ip of [...this.failures.keys()]) this.recent(ip, nowMs);
    // Still too many (an attack from many IPs): drop the oldest entries first.
    const overflow = this.failures.size - MAX_TRACKED_IPS;
    if (overflow > 0) {
      let i = 0;
      for (const ip of this.failures.keys()) {
        if (i++ >= overflow) break;
        this.failures.delete(ip);
      }
    }
  }
}
