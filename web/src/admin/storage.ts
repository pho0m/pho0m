import type { Content } from "@pho0m/content";

/**
 * Browser storage for the admin. Every access is wrapped in try/catch: storage can be
 * blocked (private mode, strict settings) and the admin must still work without it.
 */

const SESSION_KEY = "pho0m.admin.session";
const DRAFT_KEY = "pho0m.admin.draft.v1";

export type Session = { token: string; expiresAt: string };

export function loadSession(now = Date.now()): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<Session>;
    if (typeof s.token !== "string" || !s.token || typeof s.expiresAt !== "string") return null;
    const exp = Date.parse(s.expiresAt);
    if (!Number.isNaN(exp) && exp <= now) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    return { token: s.token, expiresAt: s.expiresAt };
  } catch {
    return null;
  }
}

export function saveSession(s: Session): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    /* blocked: the session lives in memory only */
  }
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export type StoredDraft = { content: Content; generation: string | null; savedAt: string };

function looksLikeContent(v: unknown): v is Content {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  return (
    c.schemaVersion === 1 &&
    Array.isArray(c.timeline) &&
    !!c.site &&
    !!c.profile &&
    !!c.company &&
    !!c.diary &&
    Array.isArray(c.projects) &&
    Array.isArray(c.skills) &&
    Array.isArray(c.documents)
  );
}

export function loadDraft(): StoredDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<StoredDraft>;
    if (!looksLikeContent(d.content)) return null;
    return {
      content: d.content,
      generation: typeof d.generation === "string" ? d.generation : null,
      savedAt: typeof d.savedAt === "string" ? d.savedAt : "",
    };
  } catch {
    return null;
  }
}

export function storeDraft(d: StoredDraft): boolean {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}
