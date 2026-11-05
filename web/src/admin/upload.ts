import { MAX_UPLOAD_BYTES } from "@pho0m/content";
import {
  MAX_IMAGE_EDGE,
  JPEG_QUALITY,
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
  /** Short note for the UI, e.g. "ย่อจาก 4032×3024 → 2000×1500 · JPEG". */
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

/** True when any pixel is not fully opaque (sampled on a grid for big images). */
function hasAlpha(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 250_000)));
  const d = ctx.getImageData(0, 0, w, h).data;
  for (let y = 0; y < h; y += step)
    for (let x = 0; x < w; x += step) if (d[(y * w + x) * 4 + 3]! < 255) return true;
  return false;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

/**
 * Validate a file and, for still images, downscale to ≤ 2000px and re-encode:
 * photos → JPEG, images with transparency → PNG (both decodable everywhere, incl. the
 * README generator). GIF and PDF are passed through unchanged. Throws UploadRejected (Thai message).
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
    // Already small JPEG/PNG: keep the original bytes.
    if (!resized && (type === "image/jpeg" || type === "image/png") && file.size <= MAX_UPLOAD_BYTES) {
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
    const transparent = type !== "image/jpeg" && hasAlpha(ctx, width, height);
    const target = transparent ? "image/png" : "image/jpeg";
    const blob = await toBlob(canvas, target, JPEG_QUALITY);

    let out: File = file;
    let note: string | undefined;
    const label = target === "image/png" ? "PNG" : "JPEG";
    // Always convert WebP/AVIF so every consumer can read the file; otherwise only when it helps.
    const mustConvert = type === "image/webp" || type === "image/avif";
    if (blob && (resized || mustConvert || blob.size < file.size)) {
      const ext = blob.type === "image/png" ? "png" : "jpg";
      out = new File([blob], renameExt(file.name, ext), { type: blob.type || target });
      note = resized
        ? `ย่อจาก ${decoded.width}×${decoded.height} → ${width}×${height} · ${label}`
        : `แปลงเป็น ${label} · ${formatBytes(file.size)} → ${formatBytes(blob.size)}`;
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
