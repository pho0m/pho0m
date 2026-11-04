import { useCallback, useEffect, useState } from "react";
import { parseContent, type Content, type HistoryItem } from "@pho0m/content";
import { errorMessage } from "../api.ts";
import { useApi, useToast } from "../context.tsx";
import { ConfirmButton } from "../fields/basic.tsx";
import { formatBytes } from "../image.ts";
import { SectionHead } from "./common.tsx";

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}

export function HistorySection({ dirty, onLoad }: { dirty: boolean; onLoad: (c: Content, label: string) => void }) {
  const api = useApi();
  const toast = useToast();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await api.history();
      setItems(res.items);
      setStatus("ready");
    } catch (e) {
      setError(errorMessage(e));
      setStatus("error");
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const load = async (item: HistoryItem) => {
    setBusy(item.path);
    try {
      const res = await api.historyItem(item.path);
      const parsed = parseContent(res.content);
      if (!parsed.ok) {
        toast.push({
          kind: "error",
          text: "เวอร์ชันนี้ไม่ผ่านการตรวจสอบ จึงไม่ได้โหลด",
          detail: parsed.issues
            .slice(0, 3)
            .map((i) => `${i.path}: ${i.message}`)
            .join(" · "),
        });
        return;
      }
      const label = formatDateTime(item.updated);
      onLoad(parsed.content, label);
      toast.push({ kind: "info", text: `โหลดเวอร์ชัน ${label} เข้าฉบับร่างแล้ว — กด “บันทึก” เพื่อใช้จริง` });
    } catch (e) {
      toast.push({ kind: "error", text: "โหลดเวอร์ชันนี้ไม่สำเร็จ", detail: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <SectionHead title="ประวัติ" en="Version history">
        ทุกครั้งที่บันทึก เวอร์ชันก่อนหน้าจะถูกเก็บไว้ (ล่าสุด 30 เวอร์ชัน) · โหลดกลับมาเป็นฉบับร่างได้ ยังไม่ทับของจริงจนกว่าจะกดบันทึก
      </SectionHead>
      <div className="btnrow">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void refresh()}>
          รีเฟรช
        </button>
      </div>
      {status === "loading" ? <p className="muted">กำลังโหลด…</p> : null}
      {status === "error" ? (
        <p className="err" role="alert">
          {error}
        </p>
      ) : null}
      {status === "ready" && !items.length ? <p className="empty">ยังไม่มีประวัติ — จะเริ่มเก็บหลังบันทึกครั้งแรก</p> : null}
      {items.length ? (
        <ol className="history">
          {items.map((it, i) => (
            <li key={it.path} className="history-row px">
              <span className="lcd history-no">{String(items.length - i).padStart(2, "0")}</span>
              <span className="history-date">{formatDateTime(it.updated)}</span>
              <span className="muted history-size">{formatBytes(it.size)}</span>
              {dirty ? (
                <ConfirmButton
                  label={busy === it.path ? "กำลังโหลด…" : "โหลดเข้าฉบับร่าง"}
                  className="btn btn-sm"
                  disabled={busy !== null}
                  question="แทนที่การแก้ไขที่ยังไม่บันทึก?"
                  confirmLabel="แทนที่"
                  onConfirm={() => void load(it)}
                />
              ) : (
                <button type="button" className="btn btn-sm" disabled={busy !== null} onClick={() => void load(it)}>
                  {busy === it.path ? "กำลังโหลด…" : "โหลดเข้าฉบับร่าง"}
                </button>
              )}
            </li>
          ))}
        </ol>
      ) : null}
    </>
  );
}
