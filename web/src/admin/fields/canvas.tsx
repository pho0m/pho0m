import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { IconName } from "@pho0m/content";
import { FRAME_H, FRAME_W, ditherPrint, drawSprite, loadImage, paint } from "../../lib/pixel.ts";
import {
  clearPrint,
  developingPrint,
  downsample,
  iconSource,
  negativePrint,
  photoSource,
  renderingFor,
  type PrintSource,
} from "../../lib/print.ts";
import {
  FRAME_ASPECT,
  PRINT_VIEWS,
  REPLAY_MS,
  darkroomTimer,
  developEase,
  developSize,
  printSize,
  type PrintView,
} from "../darkroom.ts";

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

/* ---------- loading photos into print sources (lib/print.ts) ---------- */

const MAX_CACHED = 24;
const sources = new Map<string, Promise<PrintSource>>();

/** photoSource() of a URL at w×h, cached per URL and size; failures are forgotten so they can be retried. */
function loadPhotoSource(url: string, w: number, h: number): Promise<PrintSource> {
  const key = `${w}x${h}|${url}`;
  let p = sources.get(key);
  if (!p) {
    p = loadImage(url).then((img) => photoSource(img, w, h)); // throws on a tainted (no CORS) image
    sources.set(key, p);
    p.catch(() => sources.delete(key));
    if (sources.size > MAX_CACHED) sources.delete(sources.keys().next().value!);
  }
  return p;
}

type SourceState = { status: "idle" | "loading" | "ok" | "error"; src: PrintSource | null };

/** Print source for an image URL (debounced while typing). No URL → idle. */
function usePhotoSource(url: string | undefined, w: number, h: number): SourceState {
  const [state, setState] = useState<SourceState>({ status: "idle", src: null });
  useEffect(() => {
    if (!url) {
      setState({ status: "idle", src: null });
      return;
    }
    let alive = true;
    setState((s) => ({ status: "loading", src: s.src }));
    const timer = window.setTimeout(() => {
      loadPhotoSource(url, w, h).then(
        (src) => alive && setState({ status: "ok", src }),
        () => alive && setState({ status: "error", src: null }),
      );
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [url, w, h]);
  return state;
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/* ---------- one print, three views ---------- */

export type DarkroomPrint = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  view: PrintView;
  setView: (v: PrintView) => void;
  /** Development level of the "กำลังล้าง" view, 0..1. */
  level: number;
  setLevel: (v: number) => void;
  /** Progress of the darkroom timer (0..1). */
  progress: number;
  playing: boolean;
  replay: () => void;
  /** Changes on each replay: re-mounts the flash overlay. */
  flash: number;
  status: SourceState["status"];
  usingIcon: boolean;
  hasSource: boolean;
  /** CSS image-rendering for the current view. */
  rendering: "auto" | "pixelated";
  aspect: number;
};

/**
 * The admin's darkroom preview of an image (or of a frame's pixel icon scene),
 * drawn with the site's pipeline (lib/print.ts):
 *   clear      → clearPrint: sharp continuous-tone duotone (the finished print, default)
 *   developing → developingPrint: two-tone dither, replayable 0 → 1 (the effect)
 *   negative   → negativePrint: red safelight negative
 */
export function useDarkroomPrint({
  url,
  icon,
  t = 0.4,
  seed = 0,
  aspect = FRAME_ASPECT,
}: {
  url?: string;
  icon?: IconName;
  t?: number;
  seed?: number;
  aspect?: number;
}): DarkroomPrint {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = printSize(aspect);
  const photo = usePhotoSource(url, size.w, size.h);
  const [view, setViewState] = useState<PrintView>("clear");
  const [level, setLevelState] = useState(1);
  const [progress, setProgress] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [flash, setFlash] = useState(0);
  const raf = useRef(0);

  const usingIcon = !photo.src && !!icon && (!url || photo.status === "error");
  const iconSrc = useMemo(() => (usingIcon && icon ? iconSource(icon, t, seed) : null), [usingIcon, icon, t, seed]);
  const src = photo.src ?? iconSrc;

  const stop = useCallback(() => {
    cancelAnimationFrame(raf.current);
    raf.current = 0;
    setPlaying(false);
  }, []);
  useEffect(() => stop, [stop]);

  const setView = useCallback(
    (v: PrintView) => {
      stop();
      setViewState(v);
    },
    [stop],
  );
  const setLevel = useCallback(
    (v: number) => {
      stop();
      setLevelState(v);
      setProgress(v);
    },
    [stop],
  );

  const replay = useCallback(() => {
    stop();
    setViewState("developing");
    const reduced = prefersReducedMotion();
    if (!reduced) setFlash((n) => n + 1);
    setPlaying(true);
    setLevelState(0);
    setProgress(0);
    const t0 = performance.now();
    const step = (now: number) => {
      const u = Math.min(1, (now - t0) / REPLAY_MS);
      // reduced motion: four still steps (DEV, STOP, FIX, DRY) instead of a smooth fade
      const shown = reduced ? Math.ceil(u * 4) / 4 : u;
      setProgress(shown);
      setLevelState(developEase(shown));
      if (u < 1) raf.current = requestAnimationFrame(step);
      else {
        raf.current = 0;
        setPlaying(false);
      }
    };
    raf.current = requestAnimationFrame(step);
  }, [stop]);

  // finished prints are cached per source; the dither is cheap (128 px wide) and redrawn per level
  const memo = useRef<{ src: PrintSource | null; clear?: ImageData; negative?: ImageData; out?: ImageData; small?: ImageData }>({
    src: null,
  });
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !canvas.getContext("2d")) return;
    if (!src) {
      canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const m = memo.current;
    if (m.src !== src) memo.current = { src };
    const c = memo.current;
    if (view === "clear") paint(canvas, (c.clear ??= clearPrint(src)));
    else if (view === "negative") paint(canvas, (c.negative ??= negativePrint(src)));
    else {
      const dev = developSize(aspect);
      if (dev.w === FRAME_W && dev.h === FRAME_H) {
        c.out = developingPrint(src, level, c.out);
      } else {
        // same dither as developingPrint, at this image's own aspect ratio
        c.small ??= downsample(src.data, dev.w, dev.h);
        c.out = ditherPrint(c.small, { ...src.ditherTone, level }, c.out);
      }
      paint(canvas, c.out);
    }
  }, [src, view, level, aspect]);

  const rendering = view === "developing" || !src ? "pixelated" : renderingFor(src);
  return {
    canvasRef,
    view,
    setView,
    level,
    setLevel,
    progress,
    playing,
    replay,
    flash,
    status: photo.status,
    usingIcon,
    hasSource: !!src,
    rendering,
    aspect,
  };
}

/** The canvas of a DarkroomPrint, with the exposure flash and a loading / CORS note. */
export function PrintCanvas({
  p,
  label,
  icon,
  className = "",
  children,
}: {
  p: DarkroomPrint;
  label: string;
  /** Whether an icon scene can stand in for an unreadable image (frames). */
  icon?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const dev = developSize(p.aspect);
  const note =
    p.status === "loading"
      ? "กำลังล้างภาพ…"
      : p.status === "error"
        ? icon
          ? "อ่านรูปไม่ได้ (CORS) — ใช้ภาพไอคอนแทน"
          : "พรีวิวไม่ได้ (รูปโหลดไม่ได้หรือไม่เปิด CORS)"
        : "";
  const viewName = PRINT_VIEWS.find((v) => v.id === p.view)?.th ?? "";
  return (
    <div className={`darkroom ${className}`} data-view={p.view} style={{ aspectRatio: String(p.aspect) }}>
      <canvas
        ref={p.canvasRef}
        width={dev.w}
        height={dev.h}
        className={p.rendering === "pixelated" ? "pixelated" : "smooth"}
        style={{ imageRendering: p.rendering }}
        role="img"
        aria-label={`${label} · ${viewName}`}
      />
      {p.flash ? <span key={p.flash} className="darkroom-flash" aria-hidden="true" /> : null}
      {children}
      {note ? <small className="darkroom-note">{note}</small> : null}
    </div>
  );
}

/** View switch (ล้างเสร็จ / กำลังล้าง / เนกาทีฟ) + replay, timer and (optionally) a level slider. */
export function PrintControls({ p, slider = false }: { p: DarkroomPrint; slider?: boolean }) {
  const id = useId();
  const timer = darkroomTimer(p.progress);
  return (
    <div className="pv-ctl">
      <div className="pv-views" role="group" aria-label="มุมมองพรีวิว">
        {PRINT_VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            className={`chip-btn${p.view === v.id ? " is-on" : ""}`}
            aria-pressed={p.view === v.id}
            title={v.en}
            onClick={() => p.setView(v.id)}
          >
            {v.th}
          </button>
        ))}
      </div>
      {p.view === "developing" ? (
        <div className="pv-dev">
          <button type="button" className="btn btn-sm" disabled={!p.hasSource} onClick={p.replay}>
            {p.playing ? "กำลังล้าง…" : "▶ ล้างใหม่"}
          </button>
          <span className="lcd pv-timer" aria-live="off">
            {timer.stage} {timer.clock}
          </span>
          {slider ? (
            <>
              <label htmlFor={`${id}-lv`} className="sr-only">
                ระดับการล้าง
              </label>
              <input
                id={`${id}-lv`}
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={p.level}
                aria-valuetext={`${Math.round(p.level * 100)}%`}
                onChange={(e) => p.setLevel(Number(e.target.value))}
              />
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Compact preview for an image field: the print plus its view switch. */
export function PrintPreview({ url, aspect, label }: { url: string; aspect?: number; label: string }) {
  const p = useDarkroomPrint({ url, aspect });
  return (
    <div className="pv">
      <PrintCanvas p={p} label={label} className="pv-print px" />
      <PrintControls p={p} />
    </div>
  );
}
