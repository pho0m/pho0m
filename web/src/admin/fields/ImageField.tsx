import { useId, useRef, useState, type DragEvent } from "react";
import type { ImageRef, MediaItem } from "@pho0m/content";
import type { UploadResult } from "../context.tsx";
import { fileNameOf, isPdfUrl } from "../image.ts";
import { LocalizedField, TextField } from "./basic.tsx";
import { DarkroomCanvas } from "./canvas.tsx";
import { ListEditor } from "./ListEditor.tsx";
import { MediaPicker } from "./MediaPicker.tsx";
import { UploadButton, UploadProgress, useUploader } from "./UploadButton.tsx";

const emptyAlt = () => ({ th: "", en: "" });

function fromUpload(r: UploadResult, prev?: ImageRef): ImageRef {
  const img: ImageRef = { url: r.item.url, alt: prev?.alt ?? emptyAlt() };
  if (r.width && r.height) {
    img.width = r.width;
    img.height = r.height;
  }
  return img;
}

/** Read natural size of a picked library image (best effort, resolves undefined on failure). */
function measure(url: string): Promise<{ width: number; height: number } | undefined> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth ? { width: img.naturalWidth, height: img.naturalHeight } : undefined);
    img.onerror = () => resolve(undefined);
    img.src = url;
  });
}

async function fromMedia(m: MediaItem, prev?: ImageRef): Promise<ImageRef> {
  const img: ImageRef = { url: m.url, alt: prev?.alt ?? emptyAlt() };
  const size = await measure(m.url);
  if (size) {
    img.width = size.width;
    img.height = size.height;
  }
  return img;
}

function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/**
 * One image: thumbnail + darkroom dithered preview, upload (drag & drop too),
 * pick from the library, edit URL, alt TH/EN, remove.
 */
export function ImageField({
  label,
  value,
  onChange,
  folder,
  hint,
  removable = true,
}: {
  label: string;
  value: ImageRef | undefined;
  onChange: (v: ImageRef | undefined) => void;
  folder?: string;
  hint?: string;
  removable?: boolean;
}) {
  const id = useId();
  const latest = useLatest({ value, onChange });
  const [picking, setPicking] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const up = useUploader(folder);

  const upload = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    const [r] = await up.run([file]);
    if (r) latest.current.onChange(fromUpload(r, latest.current.value));
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void upload(Array.from(e.dataTransfer.files));
  };

  const url = value?.url ?? "";
  return (
    <fieldset
      className={`field imgf${dragging ? " is-drag" : ""}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <legend>{label}</legend>
      <div className="imgf-row">
        <div className="imgf-previews">
          <div className="thumb px">
            {url && !isPdfUrl(url) ? (
              <img src={url} alt={value?.alt.th || value?.alt.en || ""} loading="lazy" />
            ) : (
              <span className="thumb-empty">{up.busy ? "กำลังอัปโหลด…" : "ยังไม่มีรูป\nลากไฟล์มาวางได้"}</span>
            )}
          </div>
          {url ? <DarkroomCanvas url={url} label={`พรีวิวแบบภาพพิมพ์ห้องมืดของ ${label}`} className="thumb px" /> : null}
        </div>
        <div className="imgf-ctl">
          <TextField
            label="URL รูป"
            type="url"
            mono
            value={url}
            placeholder="/media/… หรือ https://…"
            hint={value?.width && value.height ? `${value.width}×${value.height}px · ${fileNameOf(url)}` : hint}
            onChange={(v) => {
              if (!v && !value?.alt.th && !value?.alt.en) return onChange(undefined);
              onChange({ url: v, alt: value?.alt ?? emptyAlt() });
            }}
          />
          <div className="btnrow">
            <button type="button" className="btn btn-sm" disabled={up.busy} onClick={() => fileRef.current?.click()}>
              {up.busy ? <span className="spinner" aria-hidden="true" /> : null}
              {up.busy ? "กำลังอัปโหลด…" : "อัปโหลด"}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setPicking(true)}>
              เลือกจากคลัง
            </button>
            {removable && value ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(undefined)}>
                เอารูปออก
              </button>
            ) : null}
            <input
              ref={fileRef}
              id={`${id}-file`}
              type="file"
              hidden
              tabIndex={-1}
              aria-hidden="true"
              accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                void upload(files);
              }}
            />
          </div>
          <UploadProgress jobs={up.jobs} />
        </div>
      </div>
      {value ? (
        <LocalizedField
          label="คำอธิบายรูป (alt)"
          value={value.alt}
          onChange={(alt) => onChange({ ...value, alt })}
          hint="อธิบายสิ่งที่อยู่ในรูปสั้น ๆ สำหรับโปรแกรมอ่านหน้าจอ"
        />
      ) : null}
      <MediaPicker
        open={picking}
        onClose={() => setPicking(false)}
        kind="image"
        folder={folder}
        onPick={async ([m]) => {
          if (!m) return;
          const img = await fromMedia(m, latest.current.value);
          latest.current.onChange(img);
        }}
      />
    </fieldset>
  );
}

/** Several images (gallery, frame photos) with bulk upload and multi-select from the library. */
export function ImagesField({
  label,
  value,
  onChange,
  folder,
  hint,
  path,
}: {
  label: string;
  value: ImageRef[];
  onChange: (v: ImageRef[]) => void;
  folder?: string;
  hint?: string;
  path?: string;
}) {
  const latest = useLatest({ value, onChange });
  const [picking, setPicking] = useState(false);
  return (
    <>
      <ListEditor
        label={label}
        hint={hint}
        path={path}
        items={value}
        onChange={onChange}
        create={() => ({ url: "", alt: emptyAlt() })}
        addLabel="เพิ่มช่องรูป"
        empty="ยังไม่มีรูป"
        collapsed={value.length > 2}
        title={(img) => (
          <span className="img-title">
            {img.url && !isPdfUrl(img.url) ? <img src={img.url} alt="" loading="lazy" /> : null}
            <span>{img.alt.th || img.alt.en || (img.url ? fileNameOf(img.url) : "")}</span>
          </span>
        )}
        render={(img, set) => (
          <ImageField
            label="รูป"
            value={img}
            folder={folder}
            removable={false}
            onChange={(v) => set(v ?? { url: "", alt: emptyAlt() })}
          />
        )}
        actions={
          <>
            <UploadButton
              label="อัปโหลดหลายรูป"
              accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
              multiple
              folder={folder}
              onDone={(rs) => latest.current.onChange([...latest.current.value, ...rs.map((r) => fromUpload(r))])}
            />
            <button type="button" className="btn btn-sm" onClick={() => setPicking(true)}>
              เลือกจากคลัง (หลายรูป)
            </button>
          </>
        }
      />
      <MediaPicker
        open={picking}
        multiple
        kind="image"
        folder={folder}
        onClose={() => setPicking(false)}
        onPick={async (items) => {
          const imgs = await Promise.all(items.map((m) => fromMedia(m)));
          latest.current.onChange([...latest.current.value, ...imgs]);
        }}
      />
    </>
  );
}

/** A file URL (PDF/document) with upload + library picker. */
export function FileUrlField({
  label,
  value,
  onChange,
  folder = "docs",
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  folder?: string;
  hint?: string;
}) {
  const latest = useLatest(onChange);
  const [picking, setPicking] = useState(false);
  return (
    <div className="filef">
      <TextField label={label} type="url" mono value={value} onChange={onChange} hint={hint} placeholder="https://… หรืออัปโหลด PDF" />
      <div className="btnrow">
        <UploadButton
          label="อัปโหลด PDF"
          accept="application/pdf"
          folder={folder}
          onDone={([r]) => r && latest.current(r.item.url)}
        />
        <button type="button" className="btn btn-sm" onClick={() => setPicking(true)}>
          เลือกจากคลัง
        </button>
        {value ? (
          <a className="btn btn-ghost btn-sm" href={value} target="_blank" rel="noreferrer">
            เปิดไฟล์ ↗
          </a>
        ) : null}
      </div>
      <MediaPicker
        open={picking}
        kind="pdf"
        folder={folder}
        onClose={() => setPicking(false)}
        onPick={([m]) => m && latest.current(m.url)}
      />
    </div>
  );
}
