import { MAX_UPLOAD_BYTES } from "@pho0m/content";
import {
  MAX_IMAGE_EDGE,
  WEBP_QUALITY,
  canReencode,
  checkUpload,
  fitWithin,
  formatBytes,
  renameExt,
} from "./image.ts";

/** Thrown when a file cannot be uploaded; `message` is ready to show (Thai). */
export class UploadRejected extends Error {
  override readonly name = "UploadRejected";
}

export type PreparedUpload = {
  file: File;
  width?: number;
  height?: number;
  /** Short note for the UI, e.g. "ย่อจาก 4032×3024 → 2000×1500 · WebP". */
  note?: string;
};

type Decoded = { source: CanvasImageSource; width: number; height: number; close: () => void };

async function decode(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file);
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      /* fall through to <img> decoding */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("decode failed"));
      img.src = url;
    });
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => undefined };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

/**
 * Validate a file and, for still images, downscale to ≤ 2000px and re-encode to WebP.
 * GIF and PDF are passed through unchanged. Throws UploadRejected with a Thai message.
 */
export async function prepareUpload(file: File): Promise<PreparedUpload> {
  const check = checkUpload(file);
  if (!check.ok) throw new UploadRejected(check.message);
  const type = check.type;

  if (type === "application/pdf") return { file };

  let decoded: Decoded | null = null;
  try {
    decoded = await decode(file);
  } catch {
    decoded = null;
  }

  if (!decoded || !canReencode(type)) {
    // GIF, or a format this browser cannot decode (e.g. AVIF on old Safari): send as-is.
    decoded?.close();
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new UploadRejected(
        `ไฟล์ "${file.name}" ใหญ่เกินไป (${formatBytes(file.size)}) — สูงสุด ${formatBytes(MAX_UPLOAD_BYTES)}`,
      );
    }
    return decoded ? { file, width: decoded.width, height: decoded.height } : { file };
  }

  const { width, height, resized } = fitWithin(decoded.width, decoded.height, MAX_IMAGE_EDGE);
  try {
    if (!resized && type === "image/webp" && file.size <= MAX_UPLOAD_BYTES) {
      return { file, width, height };
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(decoded.source, 0, 0, width, height);
    const blob = await toBlob(canvas, "image/webp", WEBP_QUALITY);
    const isWebp = blob?.type === "image/webp";

    let out: File = file;
    let note: string | undefined;
    if (blob && isWebp && (resized || blob.size < file.size)) {
      out = new File([blob], renameExt(file.name, "webp"), { type: "image/webp" });
      note = resized
        ? `ย่อจาก ${decoded.width}×${decoded.height} → ${width}×${height} · WebP`
        : `แปลงเป็น WebP · ${formatBytes(file.size)} → ${formatBytes(blob.size)}`;
    } else if (blob && resized) {
      // Browser cannot encode WebP: keep the resized image in whatever format it produced.
      const ext = blob.type === "image/jpeg" ? "jpg" : "png";
      out = new File([blob], renameExt(file.name, ext), { type: blob.type || "image/png" });
      note = `ย่อจาก ${decoded.width}×${decoded.height} → ${width}×${height}`;
    }

    if (out.size > MAX_UPLOAD_BYTES) {
      throw new UploadRejected(
        `ไฟล์ "${file.name}" ยังใหญ่เกิน ${formatBytes(MAX_UPLOAD_BYTES)} หลังย่อแล้ว (${formatBytes(out.size)})`,
      );
    }
    return note ? { file: out, width, height, note } : { file: out, width, height };
  } catch (err) {
    if (err instanceof UploadRejected) throw err;
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new UploadRejected(`ย่อรูป "${file.name}" ไม่สำเร็จ และไฟล์ใหญ่เกิน ${formatBytes(MAX_UPLOAD_BYTES)}`);
    }
    return { file, width: decoded.width, height: decoded.height };
  } finally {
    decoded.close();
  }
}
