import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { MediaItem } from "@pho0m/content";
import { useMedia } from "../context.tsx";
import { fileNameOf, formatBytes } from "../image.ts";
import { UploadButton } from "./UploadButton.tsx";

export type MediaKind = "image" | "pdf" | "any";

export function matchesKind(item: MediaItem, kind: MediaKind): boolean {
  if (kind === "any") return true;
  if (kind === "pdf") return item.contentType === "application/pdf";
  return item.contentType.startsWith("image/");
}

/** Modal picker over GET /api/media. Single mode picks on click; multiple mode confirms a selection. */
export function MediaPicker({
  open,
  onClose,
  onPick,
  kind = "image",
  multiple = false,
  folder,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (items: MediaItem[]) => void;
  kind?: MediaKind;
  multiple?: boolean;
  folder?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const media = useMedia();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open) {
      media.ensureLoaded();
      setSelected([]);
      if (!d.open) {
        if (typeof d.showModal === "function") d.showModal();
        else d.setAttribute("open", "");
      }
    } else if (d.open) d.close();
  }, [open]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return media.items.filter((m) => matchesKind(m, kind) && (!q || m.path.toLowerCase().includes(q)));
  }, [media.items, kind, query]);

  const pick = (item: MediaItem) => {
    if (!multiple) {
      onPick([item]);
      onClose();
      return;
    }
    setSelected((s) => (s.includes(item.path) ? s.filter((p) => p !== item.path) : [...s, item.path]));
  };

  const confirm = () => {
    const chosen = selected
      .map((p) => media.items.find((m) => m.path === p))
      .filter((m): m is MediaItem => !!m);
    if (chosen.length) onPick(chosen);
    onClose();
  };

  return (
    <dialog ref={ref} className="picker px" aria-labelledby={titleId} onClose={onClose} onCancel={onClose}>
      {open ? (
        <div className="picker-inner">
          <header className="picker-head">
            <h2 id={titleId}>
              เลือกจากคลังไฟล์ <small className="muted">{kind === "pdf" ? "PDF" : kind === "image" ? "รูปภาพ" : "ทุกไฟล์"}</small>
            </h2>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="ปิดหน้าต่าง">
              ✕
            </button>
          </header>
          <div className="picker-tools">
            <label className="sr-only" htmlFor={`${titleId}-q`}>
              ค้นหาไฟล์
            </label>
            <input
              id={`${titleId}-q`}
              type="search"
              placeholder="ค้นหาชื่อไฟล์…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <UploadButton
              folder={folder}
              accept={kind === "pdf" ? "application/pdf" : kind === "image" ? "image/*" : undefined}
              multiple
              label="อัปโหลดใหม่"
              onUploaded={(r) => {
                if (!multiple) return;
                setSelected((s) => [...s, r.item.path]);
              }}
            />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void media.refresh()}>
              รีเฟรช
            </button>
          </div>
          <div className="picker-body">
            {media.status === "loading" && !media.items.length ? <p className="muted">กำลังโหลดคลังไฟล์…</p> : null}
            {media.status === "error" ? (
              <p className="err" role="alert">
                {media.error}
              </p>
            ) : null}
            {media.status === "ready" && !items.length ? (
              <p className="empty">ยังไม่มีไฟล์{query ? "ที่ตรงกับคำค้น" : ""} — อัปโหลดได้จากปุ่มด้านบน</p>
            ) : null}
            <ul className="media-grid">
              {items.map((m) => {
                const on = selected.includes(m.path);
                return (
                  <li key={m.path}>
                    <button
                      type="button"
                      className={`media-tile px${on ? " is-on" : ""}`}
                      aria-pressed={multiple ? on : undefined}
                      onClick={() => pick(m)}
                      title={m.path}
                    >
                      {m.contentType.startsWith("image/") ? (
                        <img src={m.url} alt="" loading="lazy" />
                      ) : (
                        <span className="pdf-badge lcd">PDF</span>
                      )}
                      <span className="media-name">{fileNameOf(m.path)}</span>
                      <span className="media-meta">{formatBytes(m.size)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          {multiple ? (
            <footer className="picker-foot">
              <button type="button" className="btn btn-primary" disabled={!selected.length} onClick={confirm}>
                ใช้ {selected.length} ไฟล์ที่เลือก
              </button>
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                ยกเลิก
              </button>
            </footer>
          ) : null}
        </div>
      ) : null}
    </dialog>
  );
}
