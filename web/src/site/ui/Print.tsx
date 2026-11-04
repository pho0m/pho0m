import { useEffect, useRef, useState } from "react";
import type { ImageRef } from "@pho0m/content";
import { createImageData, ditherPrint, paint } from "../../lib/pixel.ts";
import { ui, useLang } from "../../lib/i18n.tsx";
import { useNearViewport, useReducedMotion } from "../hooks.ts";
import { developLevel } from "../film/math.ts";
import { loadCached, naturalHeight, toPrintSource, type PrintSource } from "./images.ts";

type Props = {
  image: ImageRef;
  /** Width of the dithered bitmap in image pixels (CSS scales it). */
  width: number;
  /** Crop to this width/height ratio; omitted → the photo's own ratio. */
  aspect?: number;
  /** Hover / focus / tap shows the real colour photo. */
  reveal?: boolean;
  /** Animate the print developing when it first appears. */
  develop?: boolean;
  className?: string;
};

type Mode = "loading" | "print" | "fallback";

/**
 * A photo shown as a darkroom print: two-tone ordered dither on paper.
 * Loads lazily near the viewport; falls back to the plain <img> when the
 * canvas cannot read the image (CORS).
 */
export function Print({ image, width, aspect, reveal = false, develop = false, className = "" }: Props) {
  const { lang, t } = useLang();
  const reduced = useReducedMotion();
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const near = useNearViewport(boxRef);
  const [mode, setMode] = useState<Mode>("loading");
  const [shown, setShown] = useState(false);
  const alt = t(image.alt);

  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    let raf = 0;
    loadCached(image.url)
      .then((img) => {
        if (cancelled) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const h = aspect ? Math.max(1, Math.round(width / aspect)) : naturalHeight(img, width);
        let src: PrintSource;
        try {
          src = toPrintSource(img, width, h);
        } catch {
          setMode("fallback");
          return;
        }
        const out = createImageData(width, h);
        const draw = (level: number) => paint(canvas, ditherPrint(src.data, { ...src.tone, level }, out));
        setMode("print");
        if (develop && !reduced) {
          const t0 = performance.now();
          const step = (now: number) => {
            if (cancelled) return;
            const level = developLevel(now - t0, 1400);
            draw(level);
            if (level < 1) raf = requestAnimationFrame(step);
          };
          draw(0);
          raf = requestAnimationFrame(step);
        } else draw(1);
      })
      .catch(() => {
        if (!cancelled) setMode("fallback");
      });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [near, image.url, width, aspect, develop, reduced]);

  const ratio = aspect ?? (image.width && image.height ? image.width / image.height : 4 / 3);
  const cls = `print ${className} print--${mode}${reveal ? " print--reveal" : ""}${shown ? " is-shown" : ""}`;

  if (mode === "fallback") {
    return (
      <div ref={boxRef} className={cls}>
        <img src={image.url} alt={alt} loading="lazy" decoding="async" />
      </div>
    );
  }

  const canvas = (
    <canvas
      ref={canvasRef}
      className="print-canvas pixelated"
      width={width}
      height={Math.round(width / ratio)}
      role={reveal ? undefined : "img"}
      aria-label={reveal ? undefined : alt || undefined}
      aria-hidden={reveal || !alt ? true : undefined}
    />
  );

  if (!reveal) {
    return (
      <div ref={boxRef} className={cls}>
        {canvas}
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
        {canvas}
        {mode === "print" && (
          <img className="print-real" src={image.url} alt="" crossOrigin="anonymous" loading="lazy" decoding="async" />
        )}
      </button>
    </div>
  );
}
