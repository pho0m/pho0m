import { useEffect, useId, useRef, useState } from "react";
import { frameDateLabel, frameStamp, type Frame } from "@pho0m/content";
import { FRAME_H, FRAME_W, PRINT_H, PRINT_W, createImageData, paint } from "../../lib/pixel.ts";
import { renderingFor } from "../../lib/print.ts";
import { ui, useLang } from "../../lib/i18n.tsx";
import { useReducedMotion } from "../hooks.ts";
import { LinkRow, Tags } from "../ui/bits.tsx";
import { Modal } from "../ui/Modal.tsx";
import { Print } from "../ui/Print.tsx";
import { clearOf, developingAt } from "../ui/images.ts";
import { paragraphs } from "../util.ts";
import { developLevel, isDry, pad2 } from "./math.ts";
import { frameSource } from "./sources.ts";

/** Photos get a bigger clear print in the dialog; pixel-art scenes stay 128×88 (shown pixelated). */
const BIG_W = PRINT_W * 2;
const BIG_H = PRINT_H * 2;

export function PrintDialog({ frame, index, n, onClose }: { frame: Frame; index: number; n: number; onClose: () => void }) {
  const { lang, t } = useLang();
  const reduced = useReducedMotion();
  const titleId = useId();
  const devRef = useRef<HTMLCanvasElement>(null);
  const clearRef = useRef<HTMLCanvasElement>(null);
  /** Develop once per opened frame; coming back from "Original" shows the clear print straight away. */
  const developed = useRef("");
  const [original, setOriginal] = useState(false);
  const photo = frame.images[0];

  useEffect(() => {
    if (original) return;
    let cancelled = false;
    let raf = 0;
    const source = photo ? frameSource(frame, index, n, BIG_W, BIG_H) : frameSource(frame, index, n);
    void source.then((src) => {
      const dev = devRef.current;
      const clear = clearRef.current;
      if (cancelled || !dev || !clear) return;
      paint(clear, clearOf(src));
      clear.style.imageRendering = renderingFor(src);
      if (reduced || developed.current === frame.id) {
        clear.style.opacity = "1";
        developed.current = frame.id;
        return;
      }
      const out = createImageData(FRAME_W, FRAME_H);
      let dry = false;
      const t0 = performance.now();
      const step = (now: number) => {
        if (cancelled) return;
        const level = developLevel(now - t0, 1100);
        paint(dev, developingAt(src, level, out));
        if (!dry && isDry(level)) {
          dry = true;
          developed.current = frame.id;
          clear.style.opacity = "1";
          if (typeof clear.animate === "function")
            clear.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, easing: "ease-out" });
        }
        if (level < 1) raf = requestAnimationFrame(step);
      };
      paint(dev, developingAt(src, 0, out));
      raf = requestAnimationFrame(step);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [frame, index, n, photo, original, reduced]);

  const summary = t(frame.summary);
  const body = paragraphs(t(frame.body));
  const printAlt = photo ? t(photo.alt) || t(frame.title) : t(frame.title);

  return (
    <Modal onClose={onClose} labelledBy={titleId} className="print-modal">
      <div className="pm-grid">
        <div className="pm-figure">
          <div className="pm-clip" aria-hidden="true" />
          <div className="pm-paper">
            {original && photo ? (
              <img className="pm-original" src={photo.url} alt={printAlt} />
            ) : (
              <div className="pm-print" role="img" aria-label={printAlt}>
                <canvas ref={devRef} className="pm-dev pixelated" width={FRAME_W} height={FRAME_H} />
                <canvas ref={clearRef} className="pm-clear" width={FRAME_W} height={FRAME_H} />
              </div>
            )}
            <span className="pm-stamp lcd" aria-hidden="true">
              {frameStamp(frame)}
            </span>
          </div>
          <p className="pm-cap lcd">
            FR {pad2(index + 1)}/{pad2(n)} · {frameDateLabel(frame)}
          </p>
          {photo ? (
            <button
              type="button"
              className="btn btn--ghost px pm-toggle"
              aria-pressed={original}
              onClick={() => setOriginal((o) => !o)}
            >
              {ui(lang, "ดูรูปจริง", "Original")}
            </button>
          ) : null}
        </div>

        <div className="pm-text">
          <p className="pm-kicker lcd">{ui(lang, "ภาพจากม้วนฟิล์ม", "Print from the roll")}</p>
          <h2 id={titleId} className="pm-title">
            {t(frame.title)}
          </h2>
          {summary ? <p className="pm-lead">{summary}</p> : null}
          {body.map((p, k) => (
            <p key={k}>{p}</p>
          ))}
          {frame.images.length > 0 ? (
            <ul className="pm-thumbs" role="list" aria-label={ui(lang, "ภาพทั้งหมด", "All images")}>
              {frame.images.map((img, k) => (
                <li key={`${img.url}-${k}`}>
                  <Print image={img} width={96} aspect={4 / 3} className="print--thumb" />
                </li>
              ))}
            </ul>
          ) : null}
          <LinkRow links={frame.links} small />
          <Tags tags={frame.tags} label={ui(lang, "แท็ก", "Tags")} />
        </div>
      </div>
    </Modal>
  );
}
