import { useEffect, useRef, type RefObject } from "react";
import type { Project } from "@pho0m/content";
import { useLang } from "../../lib/i18n.tsx";
import type { PrintSource } from "../../lib/print.ts";
import { useMediaQuery, useReducedMotion } from "../hooks.ts";
import { damp, pad2 } from "../film/math.ts";
import { developingAt } from "../ui/images.ts";
import { groupLabel } from "../util.ts";
import {
  BENCH_STAGES,
  benchLayout,
  cardState,
  current,
  hungPrints,
  lineAt,
  pegX,
  posFromTops,
  printPhase,
  stageAt,
  timerText,
  type BenchLayout,
} from "./bench.ts";
import { benchBuffer, clearThumb, photoFor, sceneFor } from "./prints.ts";

/** Narrow screens get the short bench strip above the list instead of the bench beside it. */
export const COMPACT_QUERY = "(max-width: 899px)";

/** After this long without the list moving, the bench draws a calm frame and stops its loop. */
export const SETTLE_MS = 2500;

type Props = {
  /** The cards in the list, in order (after the group filter). */
  projects: Project[];
  /** The list whose cards drive the bench (one <li> per project, same order). */
  listRef: RefObject<HTMLElement | null>;
};

const WALL = "#170404";
const WALL_LINE = "#1e0605";
const RIM = "#3a0f0b";
const BATH = "#4e100b";
const LIP = "#2a0b08";
const SHIMMER = "#7a2017";
const CORD = "#6b2a1d";
const PEG = "#9a6a48";

type Ctx = CanvasRenderingContext2D;

/** Everything on the bench that never moves: wall, timer face, shelf, cord, bench top, trays. */
function paintStatic(g: Ctx, L: BenchLayout): void {
  const { W, H } = L;
  g.fillStyle = WALL;
  g.fillRect(0, 0, W, H);
  g.fillStyle = WALL_LINE;
  for (let y = 9; y < L.trays[0]!.y - 8; y += 14) g.fillRect(0, y, W, 1);
  if (L.clock) {
    const { x: cx, y: cy, r } = L.clock;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 > r * r) continue;
        g.fillStyle = d2 > (r - 2) * (r - 2) ? RIM : "#0d0202";
        g.fillRect(cx + dx, cy + dy, 1, 1);
      }
    g.fillStyle = "#6b2f25";
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      g.fillRect(Math.round(cx + Math.cos(a) * (r - 4)), Math.round(cy + Math.sin(a) * (r - 4)), 1, 1);
    }
  }
  if (L.shelf) {
    const { x0, x1, y } = L.shelf;
    g.fillStyle = RIM;
    g.fillRect(x0, y, x1 - x0, 3);
    g.fillRect(x0 + 6, y + 3, 2, 5);
    g.fillRect(x1 - 8, y + 3, 2, 5);
    [18, 14, 21, 16].forEach((bh, k) => {
      const bx = x0 + 8 + k * 25;
      g.fillStyle = "#3d0f0a";
      g.fillRect(bx, y - bh, 14, bh);
      g.fillStyle = "#5a1a12";
      g.fillRect(bx + 2, y - bh + 2, 2, bh - 4);
      g.fillStyle = LIP;
      g.fillRect(bx + 4, y - bh - 4, 6, 4);
      g.fillStyle = "#cfc3b2";
      g.fillRect(bx + 2, y - Math.round(bh * 0.6), 10, 5);
      g.fillStyle = "#b8261a";
      g.fillRect(bx + 3, y - Math.round(bh * 0.6) + 2, 2 + ((k * 3) % 7), 1);
    });
  }
  g.fillStyle = CORD;
  for (let x = 4; x < W - 4; x++) g.fillRect(x, lineAt(L, x), 1, 1);
  g.fillStyle = "#0d0202";
  g.fillRect(0, L.benchY, W, H - L.benchY);
  for (const tr of L.trays) {
    g.fillStyle = RIM;
    g.fillRect(tr.x, tr.y, tr.w, tr.h);
    g.fillStyle = BATH;
    g.fillRect(tr.x + 3, tr.y + 3, tr.w - 6, tr.h - 6);
  }
}

const offscreen = (w: number, h: number): { c: HTMLCanvasElement; g: Ctx | null } => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return { c, g: c.getContext("2d") };
};

/**
 * The darkroom bench (concept A): trays DEV / STOP / FIX and a drying line, drawn as pixel
 * art on a small canvas. Scrolling the project list walks the card at the gate line
 * through the trays and hangs it on the line; cards get data-state / data-stage so the
 * list shows the same progress. Decorative (aria-hidden): the list carries the content.
 * The loop runs only while the list is on screen and something moves, and settles into a
 * still frame shortly after the scrolling stops. With reduced motion it is a still picture
 * of the finished line.
 */
export function DarkroomBench({ projects, listRef }: Props) {
  const { lang } = useLang();
  const reduced = useReducedMotion();
  const compact = useMediaQuery(COMPACT_QUERY);
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timerRef = useRef<HTMLSpanElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);
  const pileRef = useRef<HTMLSpanElement>(null);
  const groupRef = useRef<HTMLSpanElement>(null);
  const nameRef = useRef<HTMLElement>(null);
  const trayRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const L = benchLayout(compact);

  useEffect(() => {
    const canvas = canvasRef.current;
    const list = listRef.current;
    const root = rootRef.current;
    if (!canvas || !list || !root) return;
    const g = canvas.getContext("2d");
    if (!g) return;
    canvas.width = L.W;
    canvas.height = L.H;
    const n = projects.length;
    const area = list.parentElement ?? list;

    // Pixel scenes are built on first draw (most prints are never on screen at once).
    const srcs: (PrintSource | undefined)[] = [];
    const srcOf = (k: number): PrintSource | undefined => {
      const p = projects[k];
      if (!p) return undefined;
      return (srcs[k] ??= sceneFor(p));
    };

    const bg = offscreen(L.W, L.H);
    if (bg.g) paintStatic(bg.g, L);
    // The developing dither of the print in the trays, redrawn only when its level changes.
    const dev = offscreen(L.pw, L.ph);
    const buf = benchBuffer(L.pw, L.ph);
    let devKey = "";

    let cancelled = false;
    let raf = 0;
    let visible = typeof IntersectionObserver === "undefined";
    let last = 0;
    let time = 0;
    let still = 0;
    let pos = 0;
    /** Card tops relative to the list's own top, then the bottom of the last card. */
    let rel: number[] = [];
    /** Viewport y of the bench's bottom edge once it is stuck (its sticky top + its height). */
    let stuckBottom = 0;
    let stickyTop = 0;
    let hits: { x: number; y: number; index: number }[] = [];
    // null: nothing written yet in this run, so the first value always reaches the span
    const shown: Record<"timer" | "count" | "pile" | "group" | "name", string | null> = {
      timer: null,
      count: null,
      pile: null,
      group: null,
      name: null,
    };
    let shownTray = -2;
    const states: string[] = [];

    const measure = () => {
      const items = Array.from(list.children) as HTMLElement[];
      const top0 = list.getBoundingClientRect().top;
      rel = items.map((el) => el.getBoundingClientRect().top - top0);
      const tail = items[items.length - 1];
      if (tail) rel.push(tail.getBoundingClientRect().bottom - top0);
      stickyTop = parseFloat(getComputedStyle(root).top) || 0;
      stuckBottom = stickyTop + root.offsetHeight;
      // focus and jumps inside the list keep clear of the strip on phones (see .pgrid--darkroom in CSS)
      area.style.setProperty("--bench-h", compact ? `${root.offsetHeight}px` : "0px");
    };
    /**
     * Where a card counts as "on the bench". Phones: a bit below the strip. Desktop: mid-screen,
     * but never above the bench's bottom, so the last print is dry before the bench is released.
     */
    const gateY = () => {
      const vh = window.innerHeight || 800;
      if (compact) {
        const bottom = root.getBoundingClientRect().bottom;
        return bottom + Math.max(0, vh - bottom) * 0.35;
      }
      return Math.max(vh * 0.5, Math.min(stuckBottom, vh * 0.9));
    };
    const targetPos = () => (reduced ? n : posFromTops(rel, gateY() - list.getBoundingClientRect().top));

    const setText = (el: HTMLElement | null, key: keyof typeof shown, text: string) => {
      if (!el || shown[key] === text) return;
      shown[key] = text;
      el.textContent = text;
    };

    const syncCards = () => {
      const items = list.children;
      for (let j = 0; j < items.length; j++) {
        const el = items[j] as HTMLElement;
        if (reduced) {
          if (states[j] !== "") {
            delete el.dataset.state;
            delete el.dataset.stage;
            states[j] = "";
          }
          continue;
        }
        const st = cardState(j, pos, n);
        const stage =
          st === "dry" ? "dry" : st === "active" ? BENCH_STAGES[stageAt(current(pos, n).t)].toLowerCase() : "";
        const key = `${st}|${stage}`;
        if (states[j] === key) continue;
        states[j] = key;
        el.dataset.state = st;
        if (stage) el.dataset.stage = stage;
        else delete el.dataset.stage;
      }
    };

    const drawPrint = (k: number, x: number, y: number, level: number, clear: number) => {
      const src = srcOf(k);
      if (!src) return;
      if (clear < 1) {
        const lv = Math.round(level * 24) / 24;
        const key = `${k}|${lv}`;
        if (dev.g) {
          if (key !== devKey) {
            dev.g.putImageData(developingAt(src, lv, buf, L.pw, L.ph), 0, 0);
            devKey = key;
          }
          g.drawImage(dev.c, x, y);
        } else g.putImageData(developingAt(src, lv, buf, L.pw, L.ph), x, y);
      }
      if (clear > 0) {
        const th = clearThumb(src, L.pw, L.ph);
        if (!th) return;
        g.globalAlpha = clear;
        g.drawImage(th, x, y);
        g.globalAlpha = 1;
      }
    };

    /** One frame. `ambient` adds the flicker, sway, ripples and drips; a calm frame has none. */
    const draw = (ambient: boolean) => {
      const { W } = L;
      const { i, t } = current(pos, n);
      const phase = printPhase(L, t);
      const flicker = ambient ? 0.88 + 0.12 * Math.sin(time * 9) * Math.sin(time * 3.3) : 1;
      g.globalAlpha = 1;
      if (bg.g) g.drawImage(bg.c, 0, 0);
      else paintStatic(g, L);
      // safelight: a stepped pixel glow from the lamp at the top
      const glow: [number, number][] = [
        [150, 0.045],
        [108, 0.05],
        [70, 0.06],
        [38, 0.08],
      ];
      for (const [r, a] of glow) {
        g.fillStyle = `rgba(255,74,50,${(a * flicker).toFixed(3)})`;
        g.fillRect(W / 2 - r, 0, r * 2, Math.round(r * 0.5));
      }
      g.fillStyle = RIM;
      g.fillRect(W / 2 - 12, 0, 24, 6);
      g.fillStyle = `rgba(255,74,50,${flicker.toFixed(3)})`;
      g.fillRect(W / 2 - 10, 3, 20, 3);

      // the darkroom timer's hand runs once round per card
      if (L.clock) {
        const { x: cx, y: cy, r } = L.clock;
        const hand = -Math.PI / 2 + (reduced || pos >= n ? 1 : t) * Math.PI * 2;
        g.fillStyle = "#ff4a32";
        for (let s = 0; s < r - 4; s++)
          g.fillRect(Math.round(cx + Math.cos(hand) * s), Math.round(cy + Math.sin(hand) * s), 1, 1);
        g.fillStyle = "#efe7d8";
        g.fillRect(cx - 1, cy - 1, 2, 2);
      }

      // pile and hung prints
      const { hung, piled } = hungPrints(pos, n, L.pegs);
      if (piled > 0) {
        const sheets = Math.min(piled, 6);
        for (let s = 0; s < sheets; s++) {
          g.fillStyle = s % 2 ? "#cfc3b2" : "#e4dacb";
          g.fillRect(L.pile.x + (s % 2), L.pile.y + L.ph + 10 - s * 2, L.pw - 2, 2);
        }
      }
      hits = [];
      for (const h of hung) {
        const sway = ambient ? Math.round(Math.sin(time * 1.5 + h.index * 1.7) * 0.9) : 0;
        const x = Math.round(pegX(L, h.slot)) + sway;
        const y = lineAt(L, x + L.pw / 2) + 4;
        g.fillStyle = "rgba(0,0,0,0.35)";
        g.fillRect(x + 2, y + L.ph, L.pw - 2, 2);
        drawPrint(h.index, x, y, 1, 1);
        g.fillStyle = PEG;
        g.fillRect(x + Math.floor(L.pw / 2) - 1, y - 5, 3, 7);
        hits.push({ x, y, index: h.index });
      }

      // the print in its tray, under the bath
      L.trays.forEach((tr, k) => {
        if (i >= 0 && phase.tray === k) drawPrint(i, phase.x, phase.y, phase.level, phase.clear);
        const bathY = tr.y + Math.round(tr.h * 0.3);
        g.fillStyle = "rgba(120,20,14,0.4)";
        g.fillRect(tr.x + 3, bathY, tr.w - 6, tr.y + tr.h - 3 - bathY);
        g.fillStyle = SHIMMER;
        const drift = ambient ? time * 18 : 0;
        for (let x = tr.x + 4; x < tr.x + tr.w - 4; x++) if ((x + drift) % 13 < 2) g.fillRect(x, bathY, 1, 1);
        if (ambient && i >= 0 && phase.tray === k) {
          const cx = tr.x + tr.w / 2;
          const cy = tr.y + tr.h * 0.62;
          for (let r = 0; r < 2; r++) {
            const u = (time * 0.7 + r * 0.5) % 1;
            const rx = 8 + u * (tr.w / 2 - 8);
            const ry = 2 + u * (tr.h * 0.22);
            g.fillStyle = `rgba(255,138,118,${((1 - u) * 0.55).toFixed(3)})`;
            const steps = Math.max(24, Math.round(rx * 4));
            for (let s = 0; s < steps; s++) {
              const a = (s / steps) * Math.PI * 2;
              const px = Math.round(cx + Math.cos(a) * rx);
              const py = Math.round(cy + Math.sin(a) * ry);
              if (px > tr.x + 3 && px < tr.x + tr.w - 3 && py > bathY && py < tr.y + tr.h - 3) g.fillRect(px, py, 1, 1);
            }
          }
        }
        g.fillStyle = LIP;
        g.fillRect(tr.x, tr.y + tr.h - 3, tr.w, 3);
      });
      // in the air between trays, or on its way to the line
      if (i >= 0 && phase.tray < 0 && t > 0 && t < 1) {
        drawPrint(i, phase.x, phase.y, phase.level, phase.clear);
        if (ambient && phase.y > 0) {
          g.fillStyle = "rgba(255,138,118,0.55)";
          g.fillRect(phase.x + 5, phase.y + L.ph + Math.floor((time * 30) % 5), 1, 2);
          g.fillRect(phase.x + L.pw - 8, phase.y + L.ph + Math.floor((time * 24 + 2) % 5), 1, 2);
        }
      }

      // readouts
      const p = i >= 0 ? projects[i] : undefined;
      setText(timerRef.current, "timer", reduced ? "DRY 00:89" : timerText(pos >= n ? 1 : t));
      setText(countRef.current, "count", `${pad2(Math.max(0, i) + 1)}/${pad2(n)}`);
      setText(pileRef.current, "pile", piled > 0 ? `+${piled}` : "");
      setText(groupRef.current, "group", p ? groupLabel(p.group, lang) : "");
      setText(nameRef.current, "name", p ? p.name : "");
      const tray = reduced || pos <= 0 ? -1 : phase.tray;
      if (shownTray !== tray) {
        shownTray = tray;
        trayRefs.current.forEach((el, k) => el?.toggleAttribute("data-on", k === tray));
      }
    };

    const paintOnce = () => {
      if (cancelled) return;
      pos = targetPos();
      draw(false);
      syncCards();
    };

    const frame = (now: number) => {
      raf = 0;
      if (cancelled) return;
      const dt = last ? Math.min(64, Math.max(0, now - last)) : 16;
      last = now;
      time += dt / 1000;
      const target = targetPos();
      // a jump (filter change, nav link) moves straight there instead of flying past every card
      pos = Math.abs(target - pos) > 1.5 ? target : damp(pos, target, dt, 140);
      still = Math.abs(target - pos) < 1e-3 ? still + dt : 0;
      const calm = still >= SETTLE_MS;
      draw(!calm);
      syncCards();
      if (visible && !calm) raf = requestAnimationFrame(frame);
    };
    /** Run the loop (while the list is on screen); without rAF, paint once instead. */
    const start = () => {
      if (reduced || raf || cancelled) return;
      if (typeof requestAnimationFrame !== "function") return paintOnce();
      last = 0;
      still = 0;
      raf = requestAnimationFrame(frame);
    };

    // Photos replace the pixel scenes, fetched once the list is near the screen.
    let photosAsked = false;
    const askPhotos = () => {
      if (photosAsked) return;
      photosAsked = true;
      projects.forEach((p, k) => {
        photoFor(p, { w: L.pw, h: L.ph })
          ?.then((src) => {
            if (cancelled) return;
            srcs[k] = src;
            devKey = "";
            if (!raf) paintOnce();
          })
          .catch(() => {});
      });
    };

    measure();
    paintOnce();

    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver(
        (entries) => {
          visible = entries.some((e) => e.isIntersecting);
          if (!visible) return;
          askPhotos();
          if (reduced) paintOnce();
          else start();
        },
        { rootMargin: "200px 0px" },
      );
      io.observe(area);
    } else {
      askPhotos();
      start();
    }

    let ro: ResizeObserver | null = null;
    const onResize = () => {
      measure();
      if (raf) return;
      if (visible && !reduced) start();
      else paintOnce();
    };
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(onResize);
      ro.observe(list);
      ro.observe(root);
    }
    window.addEventListener("resize", onResize);
    // The loop follows the scroll while it runs. Stopped (settled or off screen): wake it up on
    // screen, or keep the cards in step without drawing. Reduced motion: nothing depends on scroll.
    const onScroll = () => {
      if (cancelled || reduced || raf) return;
      if (visible) start();
      else {
        pos = targetPos();
        syncCards();
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    // Pointer shortcut: a print on the line scrolls to its card, which lands just above the
    // gate (so its print stays on the line) and never under the top bar or the phone strip.
    const at = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return -1;
      const x = ((e.clientX - r.left) / r.width) * L.W;
      const y = ((e.clientY - r.top) / r.height) * L.H;
      const hit = hits.find((h) => x >= h.x && x < h.x + L.pw && y >= h.y - 5 && y < h.y + L.ph);
      return hit ? hit.index : -1;
    };
    const onMove = (e: MouseEvent) => {
      canvas.style.cursor = at(e) >= 0 ? "pointer" : "";
    };
    const onClick = (e: MouseEvent) => {
      const k = at(e);
      const el = k >= 0 ? (list.children[k] as HTMLElement | undefined) : undefined;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const minTop = (compact ? stuckBottom : stickyTop) + 8;
      const top = Math.max(gateY() - 6 - r.height, minTop);
      window.scrollTo({ top: window.scrollY + r.top - top, behavior: reduced ? "auto" : "smooth" });
    };
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("click", onClick);

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      io?.disconnect();
      ro?.disconnect();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll);
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("click", onClick);
    };
    // L follows `compact`; listRef is stable.
  }, [projects, compact, reduced, lang, listRef]);

  return (
    <div ref={rootRef} className={`bench${compact ? " bench--compact" : ""}`} aria-hidden="true">
      <div className="bench-stage">
        <canvas ref={canvasRef} className="bench-canvas pixelated" style={{ aspectRatio: `${L.W} / ${L.H}` }} />
        <span ref={timerRef} className="bench-timer lcd" />
        <span ref={countRef} className="bench-count lcd" />
        <span
          ref={pileRef}
          className="bench-pile lcd"
          // anchored from below so the count always ends above the FIX tray
          style={{ left: pct(L.pile.x + L.pw / 2, L.W), bottom: pct(L.H - L.trays[2]!.y + 2, L.H) }}
        />
        {L.trays.map((tr, k) => (
          <span
            key={k}
            ref={(el) => void (trayRefs.current[k] = el)}
            className="bench-tray lcd"
            style={{ left: pct(tr.x + tr.w / 2, L.W), top: pct(L.benchY + 1, L.H) }}
          >
            {BENCH_STAGES[k]}
          </span>
        ))}
      </div>
      <p className="bench-now">
        <span ref={groupRef} className="bench-group lcd" />
        <b ref={nameRef} className="bench-name" />
      </p>
    </div>
  );
}

const pct = (v: number, of: number): string => `${((v / of) * 100).toFixed(2)}%`;
