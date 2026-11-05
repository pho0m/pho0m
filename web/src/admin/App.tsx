import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API_URL } from "../lib/content.ts";
import { createAdminApi, errorMessage, isApiError } from "./api.ts";
import { ApiProvider, ToastProvider } from "./context.tsx";
import { Editor } from "./Editor.tsx";
import { Login, type HealthState } from "./Login.tsx";
import { Splash } from "./Splash.tsx";
import { clearSession, loadSession, saveSession, type Session } from "./storage.ts";

const API_LABEL = API_URL ? `${API_URL}/api` : `${window.location.origin}/api`;
/** setTimeout cannot wait longer than ~24.8 days. */
const MAX_TIMER = 2_147_000_000;

export function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [checking, setChecking] = useState(() => session !== null);
  const [inEditor, setInEditor] = useState(false);
  const [authVersion, setAuthVersion] = useState(0);
  const [health, setHealth] = useState<HealthState>({ status: "loading" });

  const expire = useCallback(() => {
    clearSession();
    sessionRef.current = null;
    setSession(null);
  }, []);

  const api = useMemo(
    () =>
      createAdminApi({
        baseUrl: API_URL,
        getToken: () => sessionRef.current?.token ?? null,
        onUnauthorized: expire,
      }),
    [expire],
  );

  const checkHealth = useCallback(() => {
    setHealth({ status: "loading" });
    api.health().then(
      (data) => setHealth({ status: "ok", data }),
      (e) => setHealth({ status: "error", message: errorMessage(e) }),
    );
  }, [api]);

  useEffect(checkHealth, [checkHealth]);

  // validate a session restored from sessionStorage
  useEffect(() => {
    if (!checking) return;
    let alive = true;
    api.me().then(
      (me) => {
        if (!alive) return;
        setSession((s) => {
          if (!s) return s;
          const next = { ...s, expiresAt: me.expiresAt };
          saveSession(next);
          return next;
        });
        setInEditor(true);
        setChecking(false);
      },
      (e) => {
        if (!alive) return;
        // a network error should not throw the owner out: the editor shows its own retry
        if (!(isApiError(e) && e.kind === "unauthorized")) setInEditor(true);
        setChecking(false);
      },
    );
    return () => {
      alive = false;
    };
  }, [api, checking]);

  // log out locally when the token expires
  useEffect(() => {
    if (!session) return;
    const ms = Date.parse(session.expiresAt) - Date.now();
    if (Number.isNaN(ms)) return;
    const t = window.setTimeout(expire, Math.max(0, Math.min(ms, MAX_TIMER)));
    return () => window.clearTimeout(t);
  }, [session, expire]);

  const onLoggedIn = (s: Session) => {
    saveSession(s);
    sessionRef.current = s;
    setSession(s);
    setInEditor(true);
    setAuthVersion((v) => v + 1);
  };

  const logout = () => {
    expire();
    setInEditor(false);
  };

  const loginProps = { health, onRetryHealth: checkHealth, apiLabel: API_LABEL, onLoggedIn };

  return (
    <ApiProvider value={api}>
      <ToastProvider>
        {checking ? (
          <Splash>กำลังตรวจสอบเซสชัน…</Splash>
        ) : inEditor ? (
          <>
            <Editor authVersion={authVersion} expiresAt={session?.expiresAt ?? null} onLogout={logout} />
            {!session ? <Login {...loginProps} modal /> : null}
          </>
        ) : (
          <Login {...loginProps} />
        )}
      </ToastProvider>
    </ApiProvider>
  );
}
