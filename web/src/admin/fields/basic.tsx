import { useId, useRef, useState, type ReactNode, type KeyboardEvent } from "react";
import type { Localized } from "@pho0m/content";

/* ---------- helpers ---------- */

/** `const f = bind(value, onChange); <TextField {...f("nickname")} />` */
export function bind<T extends object>(value: T, onChange: (v: T) => void) {
  return <K extends keyof T>(key: K) => ({
    value: value[key],
    onChange: (v: T[K]) => onChange({ ...value, [key]: v }),
  });
}

function describedBy(...ids: (string | false | undefined)[]): string | undefined {
  const s = ids.filter(Boolean).join(" ");
  return s || undefined;
}

function Help({ id, hint, error }: { id: string; hint?: ReactNode; error?: string }) {
  return (
    <>
      {hint ? (
        <small id={`${id}-hint`} className="hint">
          {hint}
        </small>
      ) : null}
      {error ? (
        <small id={`${id}-err`} className="field-err" role="alert">
          {error}
        </small>
      ) : null}
    </>
  );
}

/* ---------- Section / group wrappers ---------- */

export function Group({
  title,
  hint,
  children,
  defaultOpen = true,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="group px" open={defaultOpen}>
      <summary>
        <span className="group-title">{title}</span>
        {hint ? <span className="group-hint">{hint}</span> : null}
      </summary>
      <div className="group-body">{children}</div>
    </details>
  );
}

export function Grid({ children, cols = 2 }: { children: ReactNode; cols?: 2 | 3 }) {
  return <div className={`fgrid fgrid-${cols}`}>{children}</div>;
}

/* ---------- Text ---------- */

type TextProps = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: ReactNode;
  error?: string;
  placeholder?: string;
  type?: "text" | "url" | "email" | "tel" | "search";
  multiline?: boolean;
  rows?: number;
  mono?: boolean;
  required?: boolean;
  inputMode?: "text" | "numeric" | "url" | "email" | "tel";
  autoComplete?: string;
};

export function TextField(p: TextProps) {
  const id = useId();
  const common = {
    id,
    value: p.value,
    placeholder: p.placeholder,
    required: p.required,
    "aria-invalid": p.error ? true : undefined,
    "aria-describedby": describedBy(p.hint ? `${id}-hint` : false, p.error ? `${id}-err` : false),
    className: p.mono ? "mono" : undefined,
  };
  return (
    <div className="field">
      <label htmlFor={id}>
        {p.label}
        {p.required ? <span className="req" aria-hidden="true"> *</span> : null}
      </label>
      {p.multiline ? (
        <textarea {...common} rows={p.rows ?? 4} onChange={(e) => p.onChange(e.target.value)} />
      ) : (
        <input
          {...common}
          type={p.type ?? "text"}
          inputMode={p.inputMode}
          autoComplete={p.autoComplete ?? "off"}
          spellCheck={p.mono ? false : undefined}
          onChange={(e) => p.onChange(e.target.value)}
        />
      )}
      <Help id={id} hint={p.hint} error={p.error} />
    </div>
  );
}

export function NumberField(p: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  min?: number;
  max?: number;
  hint?: ReactNode;
  placeholder?: string;
}) {
  const id = useId();
  const out = p.value !== undefined && ((p.min !== undefined && p.value < p.min) || (p.max !== undefined && p.value > p.max));
  const error = out ? `ต้องอยู่ระหว่าง ${p.min ?? "…"}–${p.max ?? "…"}` : undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{p.label}</label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={p.min}
        max={p.max}
        value={p.value ?? ""}
        placeholder={p.placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(p.hint ? `${id}-hint` : false, error ? `${id}-err` : false)}
        onChange={(e) => {
          const raw = e.target.value.trim();
          if (raw === "") return p.onChange(undefined);
          const n = Number(raw);
          if (Number.isFinite(n)) p.onChange(Math.round(n));
        }}
      />
      <Help id={id} hint={p.hint} error={error} />
    </div>
  );
}

export function Toggle({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="field field-toggle">
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="switch"
        checked={value}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(e) => onChange(e.target.checked)}
      />
      <label htmlFor={id}>{label}</label>
      {hint ? (
        <small id={`${id}-hint`} className="hint">
          {hint}
        </small>
      ) : null}
    </div>
  );
}

export function Select<V extends string | number>({
  label,
  value,
  onChange,
  options,
  hint,
}: {
  label: string;
  value: V;
  onChange: (v: V) => void;
  options: readonly { value: V; label: string }[];
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={String(value)}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(e) => {
          const hit = options.find((o) => String(o.value) === e.target.value);
          if (hit) onChange(hit.value);
        }}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
      <Help id={id} hint={hint} />
    </div>
  );
}

/* ---------- Localized (TH + EN side by side) ---------- */

export function LocalizedField({
  label,
  value,
  onChange,
  multiline,
  rows,
  hint,
  required,
}: {
  label: string;
  value: Localized;
  onChange: (v: Localized) => void;
  multiline?: boolean;
  rows?: number;
  hint?: ReactNode;
  required?: boolean;
}) {
  const id = useId();
  const v = value ?? { th: "", en: "" };
  const input = (lang: "th" | "en") => {
    const props = {
      id: `${id}-${lang}`,
      value: v[lang],
      lang,
      "aria-describedby": hint ? `${id}-hint` : undefined,
      onChange: (e: { target: { value: string } }) => onChange({ ...v, [lang]: e.target.value }),
    };
    return multiline ? <textarea {...props} rows={rows ?? 4} /> : <input {...props} type="text" autoComplete="off" />;
  };
  const empty = required && !v.th.trim() && !v.en.trim();
  return (
    <fieldset className={`field loc${empty ? " loc-empty" : ""}`}>
      <legend>
        {label}
        {required ? <span className="req" aria-hidden="true"> *</span> : null}
      </legend>
      <div className="loc-grid">
        <div className="loc-col">
          <label htmlFor={`${id}-th`} className="loc-tag">
            ไทย
          </label>
          {input("th")}
        </div>
        <div className="loc-col">
          <label htmlFor={`${id}-en`} className="loc-tag">
            EN
          </label>
          {input("en")}
        </div>
      </div>
      {hint ? (
        <small id={`${id}-hint`} className="hint">
          {hint}
        </small>
      ) : null}
    </fieldset>
  );
}

/* ---------- Tags ---------- */

export function TagsField({
  label,
  value,
  onChange,
  hint,
  placeholder = "พิมพ์แล้วกด Enter",
}: {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
  hint?: string;
  placeholder?: string;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const commit = (raw: string) => {
    const parts = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s, i, a) => a.indexOf(s) === i && !value.includes(s));
    if (parts.length) onChange([...value, ...parts]);
    setText("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (text.trim()) commit(text);
    } else if (e.key === "Backspace" && !text && value.length) {
      onChange(value.slice(0, -1));
    }
  };
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="tags">
        {value.map((tag, i) => (
          <span key={`${tag}-${i}`} className="tag">
            {tag}
            <button
              type="button"
              aria-label={`ลบแท็ก ${tag}`}
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              ✕
            </button>
          </span>
        ))}
        <input
          id={id}
          value={text}
          placeholder={placeholder}
          autoComplete="off"
          aria-describedby={`${id}-hint`}
          onChange={(e) => {
            const v = e.target.value;
            if (v.includes(",")) commit(v);
            else setText(v);
          }}
          onKeyDown={onKey}
          onBlur={() => text.trim() && commit(text)}
        />
      </div>
      <small id={`${id}-hint`} className="hint">
        {hint ?? "Enter หรือ , เพื่อเพิ่ม · Backspace ลบอันสุดท้าย"}
      </small>
    </div>
  );
}

/* ---------- Id ---------- */

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

export function IdField({
  value,
  onChange,
  auto,
  label = "id (ใช้ในลิงก์)",
}: {
  value: string;
  onChange: (v: string) => void;
  /** What the id becomes when left empty. */
  auto: string;
  label?: string;
}) {
  const error = value && !ID_RE.test(value) ? "ใช้ได้เฉพาะ a-z, 0-9 และ - (ห้ามขึ้นต้นด้วย -)" : undefined;
  return (
    <TextField
      label={label}
      value={value}
      onChange={(v) => onChange(v.toLowerCase().replace(/\s+/g, "-"))}
      placeholder={auto}
      mono
      error={error}
      hint={value ? "a-z, 0-9, -" : `เว้นว่าง = สร้างอัตโนมัติตอนบันทึก (${auto})`}
    />
  );
}

/* ---------- Contact value (text + visible switch) ---------- */

export function ContactField({
  label,
  value,
  onChange,
  type,
}: {
  label: string;
  value: { value: string; visible: boolean };
  onChange: (v: { value: string; visible: boolean }) => void;
  type: "email" | "tel";
}) {
  return (
    <div className="contact-field">
      <TextField label={label} type={type} value={value.value} onChange={(v) => onChange({ ...value, value: v })} />
      <Toggle
        label="แสดงบนเว็บ"
        value={value.visible}
        onChange={(visible) => onChange({ ...value, visible })}
      />
    </div>
  );
}

/* ---------- Inline confirm ---------- */

export function ConfirmButton({
  label,
  confirmLabel = "ยืนยันลบ",
  question = "แน่ใจไหม?",
  onConfirm,
  className = "btn btn-danger btn-sm",
  disabled,
  ariaLabel,
}: {
  label: ReactNode;
  confirmLabel?: string;
  question?: string;
  onConfirm: () => void;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [asking, setAsking] = useState(false);
  const yesRef = useRef<HTMLButtonElement>(null);
  if (!asking) {
    return (
      <button
        type="button"
        className={className}
        disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => {
          setAsking(true);
          requestAnimationFrame(() => yesRef.current?.focus());
        }}
      >
        {label}
      </button>
    );
  }
  return (
    <span className="confirm" role="group" aria-label={question}>
      <span className="confirm-q">{question}</span>
      <button
        ref={yesRef}
        type="button"
        className="btn btn-danger btn-sm"
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAsking(false)}>
        ยกเลิก
      </button>
    </span>
  );
}
