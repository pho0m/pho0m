import { useEffect, useId, useRef, useState } from "react";
import { frameDateLabel, frameStamp, type Frame } from "@pho0m/content";
import { FRAME_H, FRAME_W, ditherPrint, paint } from "../../lib/pixel.ts";
import { ui, useLang } from "../../lib/i18n.tsx";
import { useReducedMotion } from "../hooks.ts";
import { LinkRow, Tags } from "../ui/bits.tsx";
import { Modal } from "../ui/Modal.tsx";
import { Print } from "../ui/Print.tsx";
import { paragraphs } from "../util.ts";
import { developLevel, pad2 } from "./math.ts";
import { frameSource } from "./sources.ts";

/** Big print size for photos (icon scenes stay at their native 128×88). */
const BIG_W = FRAME_W * 2;
const BIG_H = FRAME_H * 2;

export function PrintDialog({ frame, index, n, onClose }: { frame: Frame; index: number; n: number; onClose: () => void }) {
  const { lang, t } = useLang();
  const reduced = useReducedMotion();
  const titleId = useId();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [original, setOriginal] = useState(false);
  const photo = frame.images[0];

  useEffect(() => {
    if (original) return;
    let cancelled = false;
    let raf = 0;
    const big = Boolean(photo);
    void frameSource(frame, index, n, big ? BIG_W : FRAME_W, big ? BIG_H : FRAME_H).then(({ data, tone }) => {
      const canvas = canvasRef.current;
      if (cancelled || !canvas) return;
      if (reduced) {
        paint(canvas, ditherPrint(data, tone));
        return;
      }
      const t0 = performance.now();
      const step = (now: number) => {
        if (cancelled) return;
        const level = developLevel(now - t0, 900);
        paint(canvas, ditherPrint(data, { ...tone, level }));
        if (level < 1) raf = requestAnimationFrame(step);
      };
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
              <canvas
                ref={canvasRef}
                className="pm-canvas pixelated"
                width={photo ? BIG_W : FRAME_W}
                height={photo ? BIG_H : FRAME_H}
                role="img"
                aria-label={printAlt}
              />
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
