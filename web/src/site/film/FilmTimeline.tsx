import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { frameDateLabel, frameStamp, type Frame } from "@pho0m/content";
import { FRAME_H, FRAME_W, createImageData, paint } from "../../lib/pixel.ts";
import { renderingFor, type PrintSource } from "../../lib/print.ts";
import { ui, useLang } from "../../lib/i18n.tsx";
import { useReducedMotion } from "../hooks.ts";
import { Tags } from "../ui/bits.tsx";
import { clearOf, developingAt, negativeFor, whenIdle } from "../ui/images.ts";
import * as M from "./math.ts";
import { frameSource } from "./sources.ts";
import { PrintDialog } from "./PrintDialog.tsx";
import { Spool } from "./Spool.tsx";
import "./film.css";

/**
 * DOM handles of one film cell. Stack inside the frame window, bottom → top:
 *   neg   red safelight negative (continuous tone), seen when the frame is off the gate
 *   pos   wrapper whose opacity crossfades positive ↔ negative with the distance to the gate
 *     dev   the developing two-tone dither at 128×88 (the effect)
 *     clear the finished clear print, faded in when the timer reaches DRY
 */
type Slot = {
  cell: HTMLDivElement | null;
  neg: HTMLCanvasElement | null;
  pos: HTMLDivElement | null;
  dev: HTMLCanvasElement | null;
  clear: HTMLCanvasElement | null;
};

/** Mutable animation state, kept out of React so the scroll loop never re-renders. */
type Engine = {
  pos: number;
  target: number;
  fw: number;
  raf: number;
  last: number;
  onScreen: boolean;
  started: boolean;
  states: M.FrameState[];
  devStart: number[];
  level: number[];
  src: (PrintSource | null)[];
  buf: (ImageData | null)[];
  /** Clear print + negative painted into their canvases. */
  finals: boolean[];
  /** Clear print showing (the frame is DRY). */
  dry: boolean[];
  opacity: number[];
  shown: boolean[];
  leaders: [boolean, boolean];
  lastFlash: number;
  index: number;
  progress: number | null;
  goal: number | null;
  metrics: M.ScrollMetrics | null;
};

function newEngine(n: number): Engine {
  return {
    pos: 0,
    target: 0,
    fw: 300,
    raf: 0,
    last: 0,
    onScreen: false,
    started: false,
    states: M.initialStates(n),
    devStart: Array.from({ length: n }, () => Number.NaN),
    level: Array.from({ length: n }, (_, i) => (i === 0 ? 1 : 0)),
    src: Array.from({ length: n }, () => null),
    buf: Array.from({ length: n }, () => null),
    finals: Array.from({ length: n }, () => false),
    dry: Array.from({ length: n }, () => false),
    opacity: Array.from({ length: n }, () => -1),
    shown: Array.from({ length: n }, () => true),
    leaders: [true, true],
    lastFlash: 0,
    index: 0,
    progress: 1,
    goal: null,
    metrics: null,
  };
}

export function FilmTimeline({ frames }: { frames: Frame[] }) {
  const { lang, t } = useLang();
  const reduced = useReducedMotion();
  const n = frames.length;

  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const reelRefs = useRef<(HTMLDivElement | null)[]>([null, null]);
  const leaderRefs = useRef<(HTMLDivElement | null)[]>([null, null]);
  const ticksRef = useRef<HTMLOListElement>(null);
  const slots = useRef<Slot[]>([]);
  const engRef = useRef<Engine | null>(null);
  if (!engRef.current) engRef.current = newEngine(n);
  const e = engRef.current;
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  const [index, setIndex] = useState(0);
  const [states, setStates] = useState<M.FrameState[]>(() => e.states.slice());
  const [progress, setProgress] = useState<number | null>(1);
  const [fw, setFw] = useState(300);
  const [printOpen, setPrintOpen] = useState(false);

  // ---- painting -------------------------------------------------------------
  /** Developing dither at frame size: the only print work done inside the animation loop. */
  const paintDev = useCallback(
    (i: number, level: number) => {
      const s = slots.current[i];
      const src = e.src[i];
      if (!s?.dev || !src) return;
      const buf = e.buf[i] ?? (e.buf[i] = createImageData(FRAME_W, FRAME_H));
      paint(s.dev, developingAt(src, level, buf));
      e.level[i] = level;
    },
    [e],
  );
  /** Clear print + negative: computed once per source (cached) and painted once per cell. */
  const paintFinals = useCallback(
    (i: number) => {
      const s = slots.current[i];
      const src = e.src[i];
      if (e.finals[i] || !s?.clear || !s.neg || !src) return;
      const rendering = renderingFor(src);
      paint(s.clear, clearOf(src));
      paint(s.neg, negativeFor(src));
      s.clear.style.imageRendering = rendering;
      s.neg.style.imageRendering = rendering;
      e.finals[i] = true;
    },
    [e],
  );
  /**
   * Swap the dither for the clear print: a short opacity crossfade at DRY, instant
   * otherwise. Called from the animation loop, so it never paints there: when the
   * finals are not on their canvases yet they are painted in the next idle slot and
   * the dither stays up until then.
   */
  const showClear = useCallback(
    (i: number, animate: boolean) => {
      const s = slots.current[i];
      if (e.dry[i] || !s?.clear || !e.src[i]) return;
      e.dry[i] = true;
      const clear = s.clear;
      const reveal = () => {
        clear.style.opacity = "1";
        if (animate && typeof clear.animate === "function")
          clear.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, easing: "ease-out" });
      };
      if (e.finals[i]) reveal();
      else
        whenIdle(() => {
          paintFinals(i);
          if (e.finals[i]) reveal();
        });
    },
    [e, paintFinals],
  );

  // ---- the loop ---------------------------------------------------------------
  const loop = useRef<{ schedule: () => void; measure: () => void; apply: () => void }>({
    schedule: () => {},
    measure: () => {},
    apply: () => {},
  });

  useEffect(() => {
    const measure = () => {
      const sec = sectionRef.current;
      if (!sec) return;
      const r = sec.getBoundingClientRect();
      e.metrics = { top: r.top + window.scrollY, height: r.height, viewport: window.innerHeight, n };
      e.target = M.scrollToPos(window.scrollY, e.metrics);
    };

    const apply = () => {
      const track = trackRef.current;
      if (track) track.style.transform = `translate3d(${M.trackX(e.pos, n, e.fw).toFixed(2)}px,0,0)`;
      for (let i = 0; i < n; i++) {
        const s = slots.current[i];
        if (!s?.cell) continue;
        const vis = M.frameVisible(e.pos, i);
        if (vis !== e.shown[i]) {
          s.cell.style.visibility = vis ? "" : "hidden";
          e.shown[i] = vis;
        }
        const op = e.states[i] === "unexposed" ? 0 : Math.round(M.positiveOpacity(e.pos, i) * 100) / 100;
        if (op !== e.opacity[i] && s.pos) {
          s.pos.style.opacity = String(op);
          e.opacity[i] = op;
        }
      }
      // END OF ROLL sits past the newest frame (left); the start leader before frame 0 (right, near the camera).
      const leaderVis: [boolean, boolean] = [e.pos > n - 1 - 5.5, e.pos < 1.6];
      leaderVis.forEach((v, k) => {
        const el = leaderRefs.current[k];
        if (el && v !== e.leaders[k]) {
          el.style.visibility = v ? "" : "hidden";
          e.leaders[k] = v;
        }
      });
      const angle = M.reelAngle(e.pos);
      const [l, r] = reelRefs.current;
      if (l) l.style.transform = `rotate(${angle.toFixed(1)}deg)`;
      if (r) r.style.transform = `rotate(${(angle * 0.8).toFixed(1)}deg)`;
    };

    const flash = (now: number) => {
      const el = flashRef.current;
      if (reducedRef.current || !el || typeof el.animate !== "function") return;
      // At most ~2 flashes per second, even when scrolling fast.
      if (now - e.lastFlash < 450) return;
      e.lastFlash = now;
      el.animate(
        [{ opacity: 0 }, { opacity: 0.8, offset: 0.12 }, { opacity: 0 }],
        { duration: 560, easing: "cubic-bezier(.2,.7,.3,1)" },
      );
    };

    const progressOf = (i: number): number | null => {
      const st = e.states[i];
      if (st === "developed") return 1;
      if (st === "developing") return Math.round((e.level[i] ?? 0) * 50) / 50;
      return null;
    };

    const busy = () => e.pos !== e.target || e.states.some((s, i) => s === "developing" && e.src[i]);

    const tick = (now: number) => {
      e.raf = 0;
      measure();
      const dt = e.last ? now - e.last : 16;
      e.last = now;
      let changed = false;
      if (!e.started) {
        // First look at the film: jump straight to where the page is, frames already passed count as developed.
        e.started = true;
        e.pos = e.target;
        M.initialStates(n, e.pos).forEach((s, i) => {
          if (s === "developed" && e.states[i] !== "developed") {
            e.states[i] = "developed";
            e.level[i] = 1;
            showClear(i, false);
            changed = true;
          }
        });
      }
      const prev = e.pos;
      e.pos = reducedRef.current ? e.target : M.damp(e.pos, e.target, dt);
      if (e.goal !== null && e.pos === e.target && Math.round(e.target) === e.goal) e.goal = null;
      loadAround(e.pos);
      loadAround(e.target);

      for (let i = 0; i < n; i++) {
        if (e.states[i] === "unexposed" && M.crossedGate(prev, e.pos, i)) {
          e.states[i] = "developing";
          e.devStart[i] = Number.NaN;
          e.level[i] = 0;
          changed = true;
          flash(now);
        }
        if (e.states[i] === "developing" && e.src[i]) {
          if (Number.isNaN(e.devStart[i]!)) {
            e.devStart[i] = now;
            // The negative is usually ready already (painted while idle); never compute it here.
            if (!e.finals[i]) whenIdle(() => paintFinals(i));
          }
          const level = reducedRef.current ? 1 : M.developLevel(now - e.devStart[i]!);
          if (reducedRef.current) e.level[i] = level;
          else paintDev(i, level);
          if (M.isDry(level)) showClear(i, !reducedRef.current);
          if (level >= 1) {
            e.states[i] = "developed";
            changed = true;
          }
        }
      }
      apply();
      if (changed) setStates(e.states.slice());
      const idx = Math.round(e.pos);
      if (idx !== e.index) {
        e.index = idx;
        setIndex(idx);
      }
      const prog = progressOf(idx);
      if (prog !== e.progress) {
        e.progress = prog;
        setProgress(prog);
      }
      if (busy()) schedule();
      else e.last = 0;
    };

    const schedule = () => {
      if (e.raf || !e.onScreen) return;
      e.raf = requestAnimationFrame(tick);
    };
    loop.current = { schedule, measure, apply };
    apply(); // lay the strip out at rest before the first tick

    const onScroll = () => schedule();
    // A manual scroll cancels a pending jump from the controls.
    const onUserScroll = () => {
      e.goal = null;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    window.addEventListener("wheel", onUserScroll, { passive: true });
    window.addEventListener("touchstart", onUserScroll, { passive: true });

    // Run the loop only while the stage is on screen.
    let ioVisible: IntersectionObserver | null = null;
    let ioNear: IntersectionObserver | null = null;
    let alive = true;
    // Pictures are only fetched for the frames on, or about to come onto, the strip (M.framesAround).
    let near = false;
    const requested: boolean[] = Array.from({ length: n }, () => false);
    const requestSource = (i: number) => {
      requested[i] = true;
      // Resolves with the clear print, negative and dither input already computed (print worker).
      void frameSource(frames[i]!, i, n).then((source) => {
        if (!alive) return;
        e.src[i] = source;
        if (e.states[i] === "developed") showClear(i, false);
        else if (e.states[i] === "developing") schedule();
        // Copying them onto the canvases happens while the browser is idle, not in the scroll loop.
        whenIdle(() => {
          if (alive) paintFinals(i);
        });
      });
    };
    /** Request the frames around position `p` that are not requested yet, nearest the gate first. */
    function loadAround(p: number) {
      if (!near) return;
      for (const i of M.framesAround(p, n)) if (!requested[i]) requestSource(i);
    }
    const loadSources = () => {
      near = true;
      measure();
      loadAround(e.target);
    };
    const sec = sectionRef.current;
    if (sec && typeof IntersectionObserver !== "undefined") {
      ioVisible = new IntersectionObserver((entries) => {
        const vis = entries.some((x) => x.isIntersecting);
        e.onScreen = vis;
        if (vis) schedule();
        else if (e.raf) {
          cancelAnimationFrame(e.raf);
          e.raf = 0;
          e.last = 0;
        }
      });
      ioVisible.observe(sec);
      ioNear = new IntersectionObserver(
        (entries) => {
          if (entries.some((x) => x.isIntersecting)) {
            loadSources();
            ioNear?.disconnect();
          }
        },
        { rootMargin: "100% 0px" },
      );
      ioNear.observe(sec);
    } else {
      e.onScreen = true;
      loadSources();
      schedule();
    }

    return () => {
      alive = false;
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("wheel", onUserScroll);
      window.removeEventListener("touchstart", onUserScroll);
      ioVisible?.disconnect();
      ioNear?.disconnect();
      if (e.raf) cancelAnimationFrame(e.raf);
      e.raf = 0;
    };
  }, [e, frames, n, paintDev, paintFinals, showClear]);

  // Frame size follows the stage size.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const update = () => setFw(M.frameWidthFor(view.clientWidth, window.innerHeight));
    update();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(view);
    return () => ro.disconnect();
  }, []);
  useLayoutEffect(() => {
    e.fw = fw;
    loop.current.apply();
  }, [e, fw]);

  // Long rolls: the tick row scrolls sideways and keeps the current frame centred.
  const tickIndex = Math.min(index, n - 1);
  useEffect(() => {
    const ol = ticksRef.current;
    if (!ol) return;
    const over = ol.scrollWidth > ol.clientWidth + 1;
    ol.toggleAttribute("data-overflow", over);
    const li = ol.children[tickIndex] as HTMLElement | undefined;
    if (!over || !li || typeof ol.scrollTo !== "function") return;
    const left = li.offsetLeft - (ol.clientWidth - li.offsetWidth) / 2;
    ol.scrollTo({ left, behavior: reducedRef.current ? "auto" : "smooth" });
  }, [tickIndex, n, fw]);

  // ---- navigation -------------------------------------------------------------
  const goTo = useCallback(
    (i: number) => {
      const k = M.clamp(Math.round(i), 0, n - 1);
      loop.current.measure();
      if (!e.metrics) return;
      e.goal = k;
      window.scrollTo({ top: Math.round(M.posToScroll(k, e.metrics)), behavior: reducedRef.current ? "instant" : "smooth" });
    },
    [e, n],
  );
  const base = () => e.goal ?? index;

  const onKeyDown = (ev: KeyboardEvent<HTMLDivElement>) => {
    // Keys with modifiers stay with the browser (Alt+← is "back").
    if (ev.target !== ev.currentTarget || ev.altKey || ev.ctrlKey || ev.metaKey) return;
    if (ev.key === "Enter") {
      ev.preventDefault();
      setPrintOpen(true);
      return;
    }
    // null at the ends (Up on the first frame, Down on the last): the page scrolls on.
    const next = M.keyTarget(ev.key, base(), n);
    if (next === null) return;
    ev.preventDefault();
    goTo(next);
  };

  const onFrameClick = useCallback(
    (i: number) => {
      if (i === e.index) setPrintOpen(true);
      else goTo(i);
    },
    [e, goTo],
  );

  const registerSlot = useCallback((i: number, slot: Slot) => {
    slots.current[i] = slot;
  }, []);

  if (n === 0) return null;
  const cur = Math.min(index, n - 1);
  const frame = frames[cur]!;
  const exposed = states.filter((s) => s !== "unexposed").length;
  const timer = M.darkroomTimer(progress);
  const viewStyle = { "--fw": `${fw}px`, "--n": n } as CSSProperties;

  return (
    <section
      id="film"
      ref={sectionRef}
      className="film"
      style={{ height: M.sectionHeightCss(n) }}
      aria-labelledby="film-title"
    >
      <div
        ref={stageRef}
        className="film-stage"
        tabIndex={0}
        onKeyDown={onKeyDown}
        role="group"
        aria-roledescription={ui(lang, "ม้วนฟิล์ม", "film strip")}
        aria-labelledby="film-title"
        aria-describedby="film-help"
      >
        <h2 id="film-title" className="sr-only">
          {ui(lang, "ไทม์ไลน์บนม้วนฟิล์ม", "Timeline on a roll of film")}
        </h2>
        <p id="film-help" className="sr-only">
          {ui(
            lang,
            "เลื่อนหน้าหรือกดลูกศรเพื่อเปลี่ยนเฟรม กด Enter เพื่อเปิดภาพ",
            "Scroll or use the arrow keys to move between frames. Press Enter to open the print.",
          )}
        </p>

        <div className="film-hud">
          <p className="hud-count lcd">
            <span>FR</span> {M.pad2(cur + 1)}/{M.pad2(n)} <span className="hud-sep">·</span> <span>EXP</span>{" "}
            {exposed}
          </p>
          <div
            className="hud-timer"
            role="img"
            aria-label={`${ui(lang, "ไทเมอร์ห้องมืด", "Darkroom timer")}: ${
              timer.stage >= 0 ? M.TIMER_STAGES[timer.stage] : ui(lang, "ยังไม่ถ่าย", "not exposed")
            } ${timer.clock}`}
          >
            {M.TIMER_STAGES.map((s, k) => (
              <span
                key={s}
                className="hud-chip lcd"
                data-on={k < timer.stage ? "done" : k === timer.stage ? "on" : "off"}
              >
                {s}
              </span>
            ))}
            <span className="hud-clock lcd" aria-hidden="true">
              {timer.clock}
            </span>
          </div>
          <p className="hud-iso lcd">
            ISO 400<span className="hud-iso-x"> · SAFELIGHT</span>
          </p>
        </div>

        <div ref={viewRef} className="film-view" style={viewStyle} aria-hidden="true">
          <div className="reel reel--l">
            <div className="reel-spin" ref={(el) => void (reelRefs.current[0] = el)}>
              <Spool />
            </div>
          </div>
          <div className="reel reel--r">
            <div className="reel-spin" ref={(el) => void (reelRefs.current[1] = el)}>
              <Spool />
            </div>
          </div>
          <div className="film-plane">
            <div ref={trackRef} className="film-track">
              <div className="leader leader--end" ref={(el) => void (leaderRefs.current[0] = el)}>
                <span className="leader-text lcd">END OF ROLL</span>
                <span className="leader-sub lcd">PHO0M 400 · {n} EXP</span>
              </div>
              {frames.map((f, i) => (
                <FilmCell
                  key={f.id}
                  frame={f}
                  i={i}
                  n={n}
                  state={states[i] ?? "unexposed"}
                  current={i === cur}
                  register={registerSlot}
                  onPick={onFrameClick}
                />
              ))}
              <div className="leader leader--start" ref={(el) => void (leaderRefs.current[1] = el)}>
                <span className="leader-text lcd">◂ PHO0M 400 · 35MM</span>
              </div>
            </div>
            <div className="gate">
              <i />
              <i />
              <i />
              <i />
            </div>
          </div>
        </div>

        <div ref={flashRef} className="film-flash" aria-hidden="true" />

        <div className="film-bottom">
          <div className="film-caption">
            <div aria-live="polite" aria-atomic="true">
              <p className="cap-date lcd">
                <span className="sr-only">{ui(lang, "เฟรม", "Frame")} </span>
                {M.pad2(cur + 1)} · {frameDateLabel(frame)}
              </p>
              <h3 className="cap-title">{t(frame.title)}</h3>
              <p className="cap-summary">{t(frame.summary)}</p>
            </div>
            <div className="cap-foot">
              <Tags tags={frame.tags} label={ui(lang, "แท็ก", "Tags")} />
              <button type="button" className="btn btn--paper px" onClick={() => setPrintOpen(true)}>
                {ui(lang, "เปิดภาพ ▸", "OPEN PRINT ▸")}
              </button>
            </div>
          </div>
          <nav className="film-controls" aria-label={ui(lang, "เลือกเฟรม", "Choose a frame")}>
            <button
              type="button"
              className="fc-step lcd"
              onClick={() => goTo(base() - 1)}
              disabled={cur === 0}
              aria-label={ui(lang, "เฟรมก่อนหน้า", "Previous frame")}
            >
              ◂
            </button>
            <ol className="fc-ticks" ref={ticksRef}>
              {frames.map((f, i) => (
                <li key={f.id}>
                  <button
                    type="button"
                    className="fc-tick lcd"
                    data-state={states[i]}
                    aria-current={i === cur ? "step" : undefined}
                    aria-label={`${ui(lang, "เฟรม", "Frame")} ${i + 1}: ${t(f.title)}`}
                    onClick={() => goTo(i)}
                  >
                    {M.pad2(i + 1)}
                  </button>
                </li>
              ))}
            </ol>
            <button
              type="button"
              className="fc-step lcd"
              onClick={() => goTo(base() + 1)}
              disabled={cur === n - 1}
              aria-label={ui(lang, "เฟรมถัดไป", "Next frame")}
            >
              ▸
            </button>
          </nav>
        </div>
      </div>
      {printOpen ? <PrintDialog frame={frame} index={cur} n={n} onClose={() => setPrintOpen(false)} /> : null}
    </section>
  );
}

type CellProps = {
  frame: Frame;
  i: number;
  n: number;
  state: M.FrameState;
  current: boolean;
  register: (i: number, slot: Slot) => void;
  onPick: (i: number) => void;
};

const FilmCell = memo(function FilmCell({ frame, i, n, state, current, register, onPick }: CellProps) {
  const cell = useRef<HTMLDivElement>(null);
  const neg = useRef<HTMLCanvasElement>(null);
  const pos = useRef<HTMLDivElement>(null);
  const dev = useRef<HTMLCanvasElement>(null);
  const clear = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    register(i, { cell: cell.current, neg: neg.current, pos: pos.current, dev: dev.current, clear: clear.current });
  }, [i, register]);
  const style = { "--k": M.frameLeft(i, n, 1) } as CSSProperties;
  return (
    <div
      ref={cell}
      className="ff"
      data-state={state}
      data-current={current || undefined}
      style={style}
      onClick={() => onPick(i)}
    >
      <div className="ff-img">
        <canvas ref={neg} className="ff-neg" width={FRAME_W} height={FRAME_H} />
        <div ref={pos} className="ff-pos">
          <canvas ref={dev} className="ff-dev pixelated" width={FRAME_W} height={FRAME_H} />
          <canvas ref={clear} className="ff-clear" width={FRAME_W} height={FRAME_H} />
        </div>
        <span className="ff-latent lcd">{i + 1}</span>
        <span className="ff-stamp lcd">{frameStamp(frame)}</span>
      </div>
      <span className="ff-edge lcd">{M.edgePrint(i)}</span>
    </div>
  );
});
