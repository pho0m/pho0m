import { useEffect, useMemo, useState } from "react";
import type { MediaItem } from "@pho0m/content";
import { errorMessage } from "../api.ts";
import { useMedia, useToast } from "../context.tsx";
import { ConfirmButton } from "../fields/basic.tsx";
import { UploadButton } from "../fields/UploadButton.tsx";
import { fileNameOf, formatBytes } from "../image.ts";
import { Chip, SectionHead } from "./common.tsx";

type Kind = "all" | "image" | "pdf";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // fallback for http:// or blocked clipboard API
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

/** Where a file is still referenced: on the live site (saved content), only in the draft, or nowhere. */
type Use = "live" | "draft" | null;

function MediaCard({ item, used }: { item: MediaItem; used: Use }) {
  const media = useMedia();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const isImage = item.contentType.startsWith("image/");
  const name = fileNameOf(item.path);
  return (
    <li className="media-card px">
      <a className="media-thumb" href={item.url} target="_blank" rel="noreferrer" aria-label={`เปิด ${name} ในแท็บใหม่`}>
        {isImage ? <img src={item.url} alt="" loading="lazy" /> : <span className="pdf-badge lcd">PDF</span>}
      </a>
      <div className="media-info">
        <span className="media-name" title={item.path}>
          {name}
        </span>
        <span className="media-meta">
          {formatBytes(item.size)} · {item.updated ? new Date(item.updated).toLocaleDateString("th-TH") : ""}
        </span>
        {used === "live" ? <Chip tone="ok">ใช้อยู่บนเว็บ</Chip> : used === "draft" ? <Chip tone="warn">ใช้ในฉบับร่าง</Chip> : null}
      </div>
      <div className="btnrow">
        <button
          type="button"
          className="btn btn-sm"
          onClick={async () => {
            const ok = await copyText(item.url);
            toast.push(ok ? { kind: "ok", text: "คัดลอก URL แล้ว", detail: item.url } : { kind: "error", text: "คัดลอกไม่ได้", detail: item.url });
          }}
        >
          คัดลอก URL
        </button>
        <ConfirmButton
          label={busy ? "กำลังลบ…" : "ลบ"}
          disabled={busy}
          ariaLabel={`ลบไฟล์ ${name}`}
          question={
            used === "live" ? "เว็บยังใช้ไฟล์นี้อยู่ ลบเลย?" : used === "draft" ? "ฉบับร่างยังใช้ไฟล์นี้ ลบเลย?" : "ลบไฟล์นี้ถาวร?"
          }
          onConfirm={async () => {
            setBusy(true);
            try {
              await media.remove(item.path);
              toast.push({ kind: "ok", text: `ลบ ${name} แล้ว` });
            } catch (e) {
              toast.push({ kind: "error", text: `ลบ ${name} ไม่สำเร็จ`, detail: errorMessage(e) });
              setBusy(false);
            }
          }}
        />
      </div>
    </li>
  );
}

export function MediaSection({ draftJson, savedJson }: { draftJson: string; savedJson: string }) {
  const media = useMedia();
  const [kind, setKind] = useState<Kind>("all");
  const [query, setQuery] = useState("");
  useEffect(() => media.ensureLoaded(), [media]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return media.items.filter((m) => {
      if (kind === "image" && !m.contentType.startsWith("image/")) return false;
      if (kind === "pdf" && m.contentType !== "application/pdf") return false;
      return !q || m.path.toLowerCase().includes(q);
    });
  }, [media.items, kind, query]);

  const total = media.items.reduce((s, m) => s + m.size, 0);

  return (
    <>
      <SectionHead title="คลังไฟล์" en="Media library">
        รูปและ PDF ที่อัปโหลดไว้ · รูปที่ใหญ่กว่า 2000px จะถูกย่อ และรูป WebP/AVIF จะถูกแปลงเป็น JPEG (หรือ PNG ถ้ามีพื้นโปร่งใส) ก่อนอัปโหลด
      </SectionHead>
      <div className="media-toolbar">
        <UploadButton label="อัปโหลดไฟล์ (เลือกได้หลายไฟล์)" multiple className="btn btn-primary btn-sm" folder="library" />
        <div className="filter-row" role="group" aria-label="กรองชนิดไฟล์">
          {(
            [
              ["all", "ทั้งหมด"],
              ["image", "รูปภาพ"],
              ["pdf", "PDF"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" className={`chip-btn${kind === k ? " is-on" : ""}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
              {label}
            </button>
          ))}
        </div>
        <label className="sr-only" htmlFor="media-q">
          ค้นหาไฟล์
        </label>
        <input id="media-q" type="search" placeholder="ค้นหาชื่อไฟล์…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void media.refresh()}>
          รีเฟรช
        </button>
      </div>
      <p className="muted small">
        {media.items.length} ไฟล์ · {formatBytes(total)}
      </p>
      {media.status === "loading" && !media.items.length ? <p className="muted">กำลังโหลด…</p> : null}
      {media.status === "error" ? (
        <p className="err" role="alert">
          {media.error}{" "}
          <button type="button" className="btn btn-sm" onClick={() => void media.refresh()}>
            ลองใหม่
          </button>
        </p>
      ) : null}
      {media.status === "ready" && !items.length ? <p className="empty">ไม่มีไฟล์ที่ตรงเงื่อนไข</p> : null}
      <ul className="media-cards">
        {items.map((m) => (
          <MediaCard
            key={m.path}
            item={m}
            used={savedJson.includes(m.url) ? "live" : draftJson.includes(m.url) ? "draft" : null}
          />
        ))}
      </ul>
    </>
  );
}
