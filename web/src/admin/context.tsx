import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { MediaItem } from "@pho0m/content";
import { errorMessage, type AdminApi } from "./api.ts";
import { prepareUpload } from "./upload.ts";

/* ---------- API ---------- */

const ApiCtx = createContext<AdminApi | null>(null);
export const ApiProvider = ApiCtx.Provider;
export function useApi(): AdminApi {
  const api = useContext(ApiCtx);
  if (!api) throw new Error("useApi outside ApiProvider");
  return api;
}

/* ---------- Toasts ---------- */

export type Toast = {
  id: number;
  kind: "ok" | "error" | "info";
  text: string;
  detail?: string;
  link?: { href: string; label: string };
};
type ToastApi = { push: (t: Omit<Toast, "id">) => void; dismiss: (id: number) => void };
const ToastCtx = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = nextId.current++;
      // a success makes every earlier message stale; otherwise keep at most 3 on screen
      setToasts((ts) => [...(t.kind === "ok" ? [] : ts.slice(-2)), { ...t, id }]);
      window.setTimeout(() => dismiss(id), t.kind === "error" ? 15000 : t.link ? 9000 : 5000);
    },
    [dismiss],
  );
  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast px toast-${t.kind}`}>
            <div className="toast-body">
              <span>{t.text}</span>
              {t.detail ? <small className="muted">{t.detail}</small> : null}
              {t.link ? (
                <a href={t.link.href} target="_blank" rel="noreferrer">
                  {t.link.label} ↗
                </a>
              ) : null}
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => dismiss(t.id)} aria-label="ปิดข้อความ">
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export function useToast(): ToastApi {
  const t = useContext(ToastCtx);
  if (!t) throw new Error("useToast outside ToastProvider");
  return t;
}

/* ---------- Media library ---------- */

export type UploadResult = { item: MediaItem; width?: number; height?: number; note?: string };
type MediaState = {
  items: MediaItem[];
  status: "idle" | "loading" | "ready" | "error";
  error: string;
  ensureLoaded: () => void;
  refresh: () => Promise<void>;
  upload: (file: File, folder?: string, onProgress?: (f: number) => void) => Promise<UploadResult>;
  remove: (path: string) => Promise<void>;
};
const MediaCtx = createContext<MediaState | null>(null);

export function MediaProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [status, setStatus] = useState<MediaState["status"]>("idle");
  const [error, setError] = useState("");
  const statusRef = useRef(status);
  statusRef.current = status;

  const refresh = useCallback(async () => {
    setStatus("loading");
    setError("");
    try {
      const res = await api.listMedia();
      setItems(res.items);
      setStatus("ready");
    } catch (e) {
      setError(errorMessage(e));
      setStatus("error");
    }
  }, [api]);

  const ensureLoaded = useCallback(() => {
    if (statusRef.current === "idle") void refresh();
  }, [refresh]);

  const upload = useCallback(
    async (file: File, folder?: string, onProgress?: (f: number) => void): Promise<UploadResult> => {
      const prepared = await prepareUpload(file);
      const item = await api.uploadMedia(prepared.file, prepared.file.name, { folder, onProgress });
      setItems((prev) => [item, ...prev.filter((p) => p.path !== item.path)]);
      return { item, width: prepared.width, height: prepared.height, note: prepared.note };
    },
    [api],
  );

  const remove = useCallback(
    async (path: string) => {
      await api.deleteMedia(path);
      setItems((prev) => prev.filter((p) => p.path !== path));
    },
    [api],
  );

  const value = useMemo(
    () => ({ items, status, error, ensureLoaded, refresh, upload, remove }),
    [items, status, error, ensureLoaded, refresh, upload, remove],
  );
  return <MediaCtx.Provider value={value}>{children}</MediaCtx.Provider>;
}
export function useMedia(): MediaState {
  const m = useContext(MediaCtx);
  if (!m) throw new Error("useMedia outside MediaProvider");
  return m;
}

/* ---------- Jump to an issue path ---------- */

/** Set when the owner clicks an issue: lists open the matching item and scroll to it. */
export type Jump = { path: string; n: number } | null;
const JumpCtx = createContext<Jump>(null);
export const JumpProvider = JumpCtx.Provider;
export function useJump(): Jump {
  return useContext(JumpCtx);
}
