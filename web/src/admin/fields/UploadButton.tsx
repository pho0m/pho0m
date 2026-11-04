import { useRef, useState } from "react";
import { errorMessage } from "../api.ts";
import { useMedia, useToast, type UploadResult } from "../context.tsx";

export type UploadJob = { name: string; progress: number; status: "working" | "done" | "error"; message?: string };

/** Upload files one after another, reporting progress per file. */
export function useUploader(folder?: string) {
  const media = useMedia();
  const toast = useToast();
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const busy = jobs.some((j) => j.status === "working");

  async function run(files: File[], onUploaded?: (r: UploadResult, index: number) => void): Promise<UploadResult[]> {
    const start: UploadJob[] = files.map((f) => ({ name: f.name, progress: 0, status: "working" }));
    setJobs(start);
    const results: UploadResult[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      const set = (patch: Partial<UploadJob>) =>
        setJobs((js) => js.map((j, k) => (k === i ? { ...j, ...patch } : j)));
      try {
        const r = await media.upload(file, folder, (progress) => set({ progress }));
        results.push(r);
        set({ status: "done", progress: 1, message: r.note });
        onUploaded?.(r, i);
      } catch (e) {
        set({ status: "error", message: errorMessage(e) });
        toast.push({ kind: "error", text: `อัปโหลด "${file.name}" ไม่สำเร็จ`, detail: errorMessage(e) });
      }
    }
    // keep errors visible, clear successful rows after a moment
    window.setTimeout(() => setJobs((js) => js.filter((j) => j.status === "error")), 4000);
    return results;
  }

  return { jobs, busy, run, clear: () => setJobs([]) };
}

export function UploadProgress({ jobs }: { jobs: UploadJob[] }) {
  if (!jobs.length) return null;
  return (
    <ul className="uploads" aria-live="polite">
      {jobs.map((j, i) => (
        <li key={`${j.name}-${i}`} className={`upload upload-${j.status}`}>
          <span className="upload-name">
            {j.status === "working" ? <span className="spinner" aria-hidden="true" /> : null}
            {j.name}
          </span>
          {j.status === "working" ? (
            <progress max={1} value={j.progress || undefined} aria-label={`กำลังอัปโหลด ${j.name}`} />
          ) : null}
          <small>{j.status === "done" ? `อัปโหลดแล้ว${j.message ? ` · ${j.message}` : ""}` : j.status === "error" ? j.message : ""}</small>
        </li>
      ))}
    </ul>
  );
}

/** A button that opens the file chooser and uploads to the media library. */
export function UploadButton({
  label = "อัปโหลด",
  accept,
  multiple,
  folder,
  onUploaded,
  onDone,
  className = "btn btn-sm",
}: {
  label?: string;
  accept?: string;
  multiple?: boolean;
  folder?: string;
  onUploaded?: (r: UploadResult, index: number) => void;
  onDone?: (rs: UploadResult[]) => void;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const up = useUploader(folder);
  // async callbacks must see the latest props (the draft may change while uploading)
  const latest = useRef({ onUploaded, onDone });
  latest.current = { onUploaded, onDone };
  return (
    <div className="upload-btn">
      <button type="button" className={className} disabled={up.busy} onClick={() => input.current?.click()}>
        {up.busy ? <span className="spinner" aria-hidden="true" /> : null}
        {up.busy ? "กำลังอัปโหลด…" : label}
      </button>
      <input
        ref={input}
        type="file"
        hidden
        tabIndex={-1}
        aria-hidden="true"
        accept={accept ?? "image/jpeg,image/png,image/webp,image/gif,image/avif,application/pdf"}
        multiple={multiple}
        onChange={async (e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (!files.length) return;
          const rs = await up.run(files, (r, i) => latest.current.onUploaded?.(r, i));
          if (rs.length) latest.current.onDone?.(rs);
        }}
      />
      <UploadProgress jobs={up.jobs} />
    </div>
  );
}
