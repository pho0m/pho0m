import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { HealthResponse } from "@pho0m/content";
import { errorMessage, isApiError, type AdminApiError } from "./api.ts";
import { useApi } from "./context.tsx";
import type { Session } from "./storage.ts";
import { Chip } from "./sections/common.tsx";

export type HealthState =
  | { status: "loading" }
  | { status: "ok"; data: HealthResponse }
  | { status: "error"; message: string };

function HealthCard({ health, onRetry, apiLabel }: { health: HealthState; onRetry: () => void; apiLabel: string }) {
  return (
    <section className="health" aria-label="สถานะ API">
      <div className="health-row">
        <span className="lcd">API</span>
        <code className="health-url">{apiLabel}</code>
      </div>
      {health.status === "loading" ? <p className="muted small">กำลังตรวจสอบ API…</p> : null}
      {health.status === "error" ? (
        <div className="health-row">
          <Chip tone="red">ออฟไลน์</Chip>
          <span className="small">{health.message}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>
            ลองใหม่
          </button>
        </div>
      ) : null}
      {health.status === "ok" ? (
        <>
          <div className="health-row">
            <Chip tone="ok">ออนไลน์</Chip>
            <Chip tone={health.data.driver === "gcs" ? "ok" : "warn"}>
              storage: {health.data.driver === "gcs" ? "Google Cloud Storage" : "local (เครื่องนี้)"}
            </Chip>
            <Chip>bucket: {health.data.bucket ?? "—"}</Chip>
          </div>
          {!health.data.authConfigured ? (
            <p className="warn small" role="alert">
              เซิร์ฟเวอร์ยังไม่ได้ตั้งรหัสผ่านแอดมิน (ADMIN_PASSWORD) — เข้าสู่ระบบไม่ได้จนกว่าจะตั้งค่า
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

export function Login({
  health,
  onRetryHealth,
  apiLabel,
  onLoggedIn,
  modal = false,
}: {
  health: HealthState;
  onRetryHealth: () => void;
  apiLabel: string;
  onLoggedIn: (s: Session) => void;
  /** Shown over the editor when the session expired; the draft stays in memory. */
  modal?: boolean;
}) {
  const api = useApi();
  const id = useId();
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; detail?: string } | null>(null);
  const [wait, setWait] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!wait) return;
    const t = window.setTimeout(() => setWait((w) => Math.max(0, w - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [wait]);

  useEffect(() => {
    const d = dialogRef.current;
    if (modal && d && !d.open) {
      if (typeof d.showModal === "function") d.showModal();
      else d.setAttribute("open", "");
    }
    inputRef.current?.focus();
  }, [modal]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password || busy || wait) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.login(password);
      setPassword("");
      onLoggedIn({ token: res.token, expiresAt: res.expiresAt });
    } catch (err) {
      const apiErr: AdminApiError | null = isApiError(err) ? err : null;
      setError({ text: errorMessage(err), detail: apiErr?.detail && apiErr.detail !== apiErr.message ? apiErr.detail : undefined });
      if (apiErr?.kind === "rate-limited") setWait(apiErr.retryAfter ?? 30);
      inputRef.current?.select();
    } finally {
      setBusy(false);
    }
  };

  const disabled = busy || !password || wait > 0;
  const form = (
    <form className="login px" onSubmit={submit} noValidate>
      <h1 className="login-title">
        <span className="lcd">DARKROOM</span> หลังบ้าน pho0m
      </h1>
      {modal ? (
        <p className="warn small" role="alert">
          เซสชันหมดอายุ — เข้าสู่ระบบอีกครั้งเพื่อทำงานต่อ การแก้ไขที่ยังไม่บันทึกยังอยู่ครบ
        </p>
      ) : (
        <p className="muted small">สำหรับเจ้าของเว็บเท่านั้น · Admin sign-in</p>
      )}
      <div className="field">
        <label htmlFor={`${id}-pw`}>รหัสผ่าน (Password)</label>
        <div className="pw">
          <input
            ref={inputRef}
            id={`${id}-pw`}
            type={show ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-err` : undefined}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-pressed={show}
            aria-controls={`${id}-pw`}
            onClick={() => setShow((s) => !s)}
          >
            {show ? "ซ่อน" : "แสดง"}
          </button>
        </div>
      </div>
      {error ? (
        <p id={`${id}-err`} className="err" role="alert">
          {error.text}
          {wait ? ` (${wait} วิ)` : ""}
          {error.detail ? <small className="muted"> · {error.detail}</small> : null}
        </p>
      ) : null}
      <button type="submit" className="btn btn-primary btn-block" disabled={disabled}>
        {busy ? <span className="spinner" aria-hidden="true" /> : null}
        {busy ? "กำลังเข้าสู่ระบบ…" : wait ? `รอ ${wait} วินาที` : "เข้าสู่ระบบ"}
      </button>
      <HealthCard health={health} onRetry={onRetryHealth} apiLabel={apiLabel} />
    </form>
  );

  if (modal) {
    return (
      <dialog ref={dialogRef} className="modal modal-login" aria-label="เข้าสู่ระบบอีกครั้ง" onCancel={(e) => e.preventDefault()}>
        {form}
      </dialog>
    );
  }
  return <div className="login-page">{form}</div>;
}
