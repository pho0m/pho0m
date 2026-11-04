import { parseContent, CONTENT_OBJECT, type Content } from "@pho0m/content";
import { seed } from "@pho0m/content/seed";
import type { GithubStats } from "./model.ts";

type Env = Record<string, string | undefined>;
type Fetch = typeof fetch;
type Warn = (message: string) => void;

export type ContentSource = { content: Content; source: string };

/** Where the live content lives: CONTENT_URL, else the public object in the bucket, else nothing (seed). */
export function contentUrl(env: Env): string | null {
  if (env.CONTENT_URL?.trim()) return env.CONTENT_URL.trim();
  const bucket = env.SERVICE_ACCOUNT_BUCKET_NAME?.trim();
  if (bucket) return `https://storage.googleapis.com/${encodeURIComponent(bucket)}/${CONTENT_OBJECT}`;
  return null;
}

/**
 * Thrown in strict mode (README_REQUIRE_LIVE_CONTENT=1) when the live content is configured but
 * cannot be used. The CLI exits 1 and writes nothing, so CI never commits a README built from
 * the seed while the live content exists but is unreadable.
 */
export class LiveContentError extends Error {
  override name = "LiveContentError";
}

/** README_REQUIRE_LIVE_CONTENT=1: only a missing object (HTTP 404) or no configured source may use the seed. */
export function requireLiveContent(env: Env): boolean {
  return env.README_REQUIRE_LIVE_CONTENT?.trim() === "1";
}

/**
 * Load and validate the live content. No source configured, or HTTP 404 (nothing saved from
 * /admin yet) → the committed seed, which then is the live content. Any other failure (other
 * HTTP status, network error, timeout, bad JSON, schema mismatch) falls back to the seed with a
 * warning, or throws LiveContentError when README_REQUIRE_LIVE_CONTENT=1.
 */
export async function loadContent(env: Env, doFetch: Fetch = fetch, warn: Warn = console.warn): Promise<ContentSource> {
  const url = contentUrl(env);
  if (!url) return { content: seed, source: "seed" };
  let problem: string;
  try {
    const res = await doFetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    if (res.status === 404) {
      warn(`[readme] ${url} does not exist yet (HTTP 404: nothing saved from /admin). Using the seed.`);
      return { content: seed, source: "seed" };
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = parseContent(await res.json());
    if (!parsed.ok) {
      const first = parsed.issues.slice(0, 5).map((i) => `${i.path || "(root)"}: ${i.message}`);
      throw new Error(`content is invalid (${first.join("; ")})`);
    }
    return { content: parsed.content, source: url };
  } catch (err) {
    problem = `could not use ${url}: ${(err as Error).message}`;
  }
  if (requireLiveContent(env)) {
    throw new LiveContentError(`${problem}. README_REQUIRE_LIVE_CONTENT=1, so the seed is not used and nothing is written.`);
  }
  warn(`[readme] ${problem}. Falling back to the seed.`);
  return { content: seed, source: "seed" };
}

type GhUser = { login: string; public_repos: number; followers: number };
type GhRepo = { name: string; fork: boolean; stargazers_count: number; owner?: { login: string } };

/**
 * Public GitHub numbers for the profile. Needs GITHUB_TOKEN (CI provides one); without it,
 * or on any error, returns null and the cards only show counts derived from the content.
 */
export async function loadGithubStats(
  env: Env,
  handle: string,
  doFetch: Fetch = fetch,
  warn: Warn = console.warn,
): Promise<GithubStats | null> {
  const token = env.GITHUB_TOKEN?.trim();
  const user = (env.GITHUB_USER?.trim() || handle).trim();
  if (!token || !user) return null;
  const api = (env.GITHUB_API_URL?.trim() || "https://api.github.com").replace(/\/+$/, "");
  const headers = {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "user-agent": "pho0m-readme-generator",
    "x-github-api-version": "2022-11-28",
  };
  const get = async <T>(path: string): Promise<T> => {
    const res = await doFetch(`${api}${path}`, { headers, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`);
    return (await res.json()) as T;
  };
  try {
    const u = await get<GhUser>(`/users/${encodeURIComponent(user)}`);
    const repoStars: Record<string, number> = {};
    let stars = 0;
    for (let page = 1; page <= 10; page++) {
      const repos = await get<GhRepo[]>(`/users/${encodeURIComponent(user)}/repos?type=owner&per_page=100&page=${page}`);
      for (const r of repos) {
        if (r.fork) continue;
        repoStars[r.name.toLowerCase()] = r.stargazers_count;
        stars += r.stargazers_count;
      }
      if (repos.length < 100) break;
    }
    return { login: u.login, publicRepos: u.public_repos, followers: u.followers, stars, repoStars };
  } catch (err) {
    warn(`[readme] GitHub stats unavailable: ${(err as Error).message}. Showing content counts only.`);
    return null;
  }
}
