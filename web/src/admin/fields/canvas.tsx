import { useEffect, useRef, useState } from "react";
import type { IconName } from "@pho0m/content";
import {
  FRAME_H,
  FRAME_W,
  ditherPrint,
  drawSprite,
  iconScene,
  loadImage,
  negativeOf,
  paint,
  sourceToImageData,
} from "../../lib/pixel.ts";

/** A 16x16 sprite drawn at integer scale (icon picker, frame list). */
export function SpriteIcon({ icon, scale = 2, label }: { icon: IconName; scale?: number; label?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, 16 * scale, 16 * scale);
    drawSprite(ctx, icon, 0, 0, scale);
  }, [icon, scale]);
  return (
    <canvas
      ref={ref}
      width={16 * scale}
      height={16 * scale}
      className="sprite pixelated"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}

type SourceState = { status: "idle" | "loading" | "ok" | "error"; data: ImageData | null };

/** Composite transparent pixels over white so logos print on paper instead of solid ink. */
export function flattenAlpha(img: ImageData): ImageData {
  const d = img.data;
  for (let k = 0; k < d.length; k += 4) {
    const a = d[k + 3]! / 255;
    if (a >= 1) continue;
    d[k] = Math.round(d[k]! * a + 255 * (1 - a));
    d[k + 1] = Math.round(d[k + 1]! * a + 255 * (1 - a));
    d[k + 2] = Math.round(d[k + 2]! * a + 255 * (1 - a));
    d[k + 3] = 255;
  }
  return img;
}

/** Load an image URL into FRAME_W x FRAME_H pixels (cover fit). Debounced; null url → idle. */
export function useFrameSource(url: string | undefined): SourceState {
  const [state, setState] = useState<SourceState>({ status: "idle", data: null });
  useEffect(() => {
    if (!url) {
      setState({ status: "idle", data: null });
      return;
    }
    let alive = true;
    setState((s) => ({ status: "loading", data: s.data }));
    const timer = window.setTimeout(() => {
      loadImage(url).then(
        (img) => {
          if (!alive) return;
          try {
            setState({ status: "ok", data: flattenAlpha(sourceToImageData(img, FRAME_W, FRAME_H)) });
          } catch {
            setState({ status: "error", data: null }); // tainted canvas (no CORS)
          }
        },
        () => alive && setState({ status: "error", data: null }),
      );
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [url]);
  return state;
}

/**
 * The darkroom look of an image: two-tone ordered dither (or its negative).
 * Falls back to the icon scene when there is no image or it cannot be read.
 */
export function DarkroomCanvas({
  url,
  icon,
  t = 0.4,
  seed = 0,
  level = 1,
  negative = false,
  label,
  className = "",
}: {
  url?: string;
  icon?: IconName;
  t?: number;
  seed?: number;
  level?: number;
  negative?: boolean;
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const src = useFrameSource(url);
  const usingIcon = !src.data && !!icon && (!url || src.status === "error");

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !canvas.getContext("2d")) return;
    const base = src.data ?? (usingIcon && icon ? iconScene(icon, t, seed) : null);
    if (!base) {
      canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    let print = ditherPrint(base, { level });
    if (negative) print = negativeOf(print);
    paint(canvas, print);
  }, [src.data, usingIcon, icon, t, seed, level, negative]);

  const note =
    src.status === "loading"
      ? "กำลังล้างภาพ…"
      : src.status === "error"
        ? icon
          ? "อ่านรูปไม่ได้ (CORS) — ใช้ภาพไอคอนแทน"
          : "พรีวิวไม่ได้ (รูปโหลดไม่ได้หรือไม่เปิด CORS)"
        : "";
  return (
    <div className={`darkroom ${className}`}>
      <canvas ref={ref} width={FRAME_W} height={FRAME_H} className="pixelated" role="img" aria-label={label} />
      {note ? <small className="darkroom-note">{note}</small> : null}
    </div>
  );
}
