import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { ImageRef } from "@pho0m/content";
import { createImageData, paint } from "../../lib/pixel.ts";
import { renderingFor, type PrintSource } from "../../lib/print.ts";
import { ui, useLang } from "../../lib/i18n.tsx";
import { useNearViewport, useReducedMotion } from "../hooks.ts";
import { developLevel, isDry } from "../film/math.ts";
import { clearOf, clearSize, developingAt, loadCached, naturalHeight, photoPrintSource, whenIdle } from "./images.ts";

type Props = {
  image: ImageRef;
  /** Width of the developing dither in image pixels (the clear print is ~3× sharper; CSS scales both). */
  width: number;
  /** Crop to this width/height ratio; omitted → the photo's own ratio. */
  aspect?: number;
  /** Hover / focus / tap shows the real colour photo. */
  reveal?: boolean;
  /** Develop in dither when it comes into view, then crossfade to the clear print. */
  develop?: boolean;
  /** "contain" for cut-out logos: the colour original sits on the paper instead of being cropped. */
  fit?: "cover" | "contain";
  className?: string;
};

type Mode = "loading" | "print" | "fallback";

/** How long a print takes to come up in the tray (ms). */
const DEVELOP_MS = 1200;
const FADE_MS = 400;

/**
 * A photo shown as a darkroom print. The finished print is the clear duotone from
 * the shared pipeline (web/src/lib/print.ts); with `develop` it first comes up as
 * a two-tone dither and crossfades to the clear print when it reaches DRY.
 * Loads lazily near the viewport; falls back to the plain <img> when the canvas
 * cannot read the image (CORS).
 */
export function Print({ image, width, aspect, reveal = false, develop = false, fit = "cover", className = "" }: Props) {
  const { lang, t } = useLang();
  const reduced = useReducedMotion();
  const boxRef = useRef<HTMLDivElement>(null);
  const devRef = useRef<HTMLCanvasElement>(null);
  const clearRef = useRef<HTMLCanvasElement>(null);
  const near = useNearViewport(boxRef);
  const [mode, setMode] = useState<Mode>("loading");
  const [shown, setShown] = useState(false);
  const metaRatio = image.width && image.height ? image.width / image.height : 4 / 3;
  const [ratio, setRatio] = useState(aspect ?? metaRatio);
  const alt = t(image.alt);

  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    let raf = 0;
    let io: IntersectionObserver | null = null;
    void (async () => {
      let src: PrintSource;
      let r: number;
      try {
        const img = await loadCached(image.url);
        r = aspect ?? width / naturalHeight(img, width);
        const size = clearSize(img, width, r);
        src = await photoPrintSource(image.url, size.w, size.h);
      } catch {
        if (!cancelled) setMode("fallback");
        return;
      }
      const clear = clearRef.current;
      const dev = devRef.current;
      if (cancelled || !clear) return;
      setRatio(r);
      setMode("print");
      clear.style.imageRendering = renderingFor(src);
      let painted = false;
      const paintClear = () => {
        if (painted || cancelled) return;
        painted = true;
        paint(clear, clearOf(src));
      };
      if (!develop || reduced || !dev) {
        paintClear();
        clear.style.opacity = "1";
        return;
      }

      // Develop: blank paper → dither comes up → DRY → crossfade to the clear print.
      const dw = width;
      const dh = Math.max(1, Math.round(width / r));
      const out = createImageData(dw, dh);
      paint(dev, developingAt(src, 0, out, dw, dh));
      whenIdle(paintClear); // ready before it is needed, computed outside animation frames
      let dry = false;
      let t0 = 0;
      const step = (now: number) => {
        if (cancelled) return;
        if (!t0) t0 = now;
        const level = developLevel(now - t0, DEVELOP_MS);
        paint(dev, developingAt(src, level, out, dw, dh));
        if (!dry && isDry(level)) {
          dry = true;
          paintClear();
          clear.style.opacity = "1";
          if (typeof clear.animate === "function")
            clear.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: "ease-out" });
        }
        if (level < 1) raf = requestAnimationFrame(step);
      };
      const start = () => {
        raf = requestAnimationFrame(step);
      };
      const box = boxRef.current;
      if (!box || typeof IntersectionObserver === "undefined") return start();
      // Start once it is really on screen, so the visitor sees it come up.
      io = new IntersectionObserver(
        (entries) => {
          if (entries.some((x) => x.isIntersecting)) {
            io?.disconnect();
            start();
          }
        },
        { threshold: 0.4 },
      );
      io.observe(box);
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      io?.disconnect();
    };
  }, [near, image.url, width, aspect, develop, reduced]);

  const cls = `print ${className} print--${mode}${reveal ? " print--reveal" : ""}${shown ? " is-shown" : ""}`;

  if (mode === "fallback") {
    return (
      <div ref={boxRef} className={cls}>
        <img src={image.url} alt={alt} loading="lazy" decoding="async" />
      </div>
    );
  }

  // Canvas sizes are set by paint(); layout comes from the frame's aspect ratio.
  const frame = (
    <span
      className="print-frame"
      style={{ aspectRatio: ratio } as CSSProperties}
      role={reveal || !alt ? undefined : "img"}
      aria-label={reveal || !alt ? undefined : alt}
    >
      {develop ? (
        <canvas ref={devRef} className="print-dev pixelated" aria-hidden="true" />
      ) : null}
      <canvas ref={clearRef} className="print-clear" aria-hidden="true" />
    </span>
  );

  if (!reveal) {
    return (
      <div ref={boxRef} className={cls}>
        {frame}
      </div>
    );
  }

  return (
    <div ref={boxRef} className={cls}>
      <button
        type="button"
        className="print-toggle"
        aria-pressed={shown}
        aria-label={`${ui(lang, "ดูภาพสี", "Show colour photo")}${alt ? `: ${alt}` : ""}`}
        onClick={() => setShown((s) => !s)}
      >
        {frame}
        {mode === "print" && (
          <img
            className={`print-real${fit === "contain" ? " print-real--contain" : ""}`}
            src={image.url}
            alt=""
            crossOrigin="anonymous"
            loading="lazy"
            decoding="async"
          />
        )}
      </button>
    </div>
  );
}
