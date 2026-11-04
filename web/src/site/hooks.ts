import { useEffect, useRef, useState, type RefObject } from "react";

function query(q: string): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(q).matches;
}

/** Live `matchMedia` value. */
export function useMediaQuery(q: string): boolean {
  const [match, setMatch] = useState(() => query(q));
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(q);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return match;
}

export const useReducedMotion = (): boolean => useMediaQuery("(prefers-reduced-motion: reduce)");

/**
 * True once the element has come within `margin` of the viewport (sticky: never
 * flips back). Used to lazy-render canvases and load images.
 */
export function useNearViewport(ref: RefObject<Element | null>, margin = "300px"): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, margin, near]);
  return near;
}

/** Id of the section currently under the top bar (for nav highlighting). */
export function useActiveSection(ids: readonly string[]): string {
  const [active, setActive] = useState("");
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const seen = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting);
        const first = ids.find((id) => seen.get(id));
        setActive(first ?? "");
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [ids]);
  return active;
}

/* ---- landing on #section links ------------------------------------------------------------ */

/** The element named by location.hash (#film, #utotech, …), if it is on the page. */
export function hashTarget(doc: Document = document): HTMLElement | null {
  const raw = doc.defaultView?.location.hash.slice(1) ?? "";
  if (!raw) return null;
  let id = raw;
  try {
    id = decodeURIComponent(raw);
  } catch {
    /* malformed escape: use it as written */
  }
  return doc.getElementById(id);
}

/** Space the top bar takes (html scroll-padding-top), in px. */
function scrollPad(doc: Document): number {
  const v = parseFloat(doc.defaultView?.getComputedStyle(doc.documentElement).scrollPaddingTop ?? "");
  return Number.isFinite(v) ? v : 0;
}

/**
 * True when `el` is not where a jump to it should leave it: its top under the top bar,
 * or the page scrolled as far as it goes (a short last section cannot reach the top).
 */
export function isOffTarget(el: HTMLElement, tolerance = 3): boolean {
  const doc = el.ownerDocument;
  const win = doc.defaultView;
  if (!win) return false;
  const top = el.getBoundingClientRect().top - scrollPad(doc);
  if (top < -tolerance) return true;
  const maxY = doc.documentElement.scrollHeight - win.innerHeight;
  return top > tolerance && win.scrollY < maxY - 1;
}

function jumpTo(el: HTMLElement, behavior: ScrollBehavior) {
  // scroll-padding-top keeps it clear of the sticky top bar
  if (typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "start", behavior });
}

const USER_INPUT = ["wheel", "touchstart", "keydown", "pointerdown", "mousedown"] as const;

/**
 * Land on location.hash and keep it there while the page settles: the page is
 * rendered by React after the static snapshot, then web fonts swap in and the film
 * measures itself, and each of those moves the sections. Every layout change re-aligns
 * the target until the layout has been quiet for `settleMs` after the fonts are ready,
 * `maxMs` has passed, or the visitor scrolls, types or taps. Returns a cleanup.
 */
export function holdHashTarget(
  doc: Document = document,
  { settleMs = 800, maxMs = 6000 }: { settleMs?: number; maxMs?: number } = {},
): () => void {
  const win = doc.defaultView;
  const el = hashTarget(doc);
  if (!win || !el) return () => {};
  try {
    // the browser must not restore an older offset over the landing on a reload
    win.history.scrollRestoration = "manual";
  } catch {
    /* not supported */
  }
  let done = false;
  let quiet = 0;
  let fontsReady = !doc.fonts;
  const align = () => {
    if (!done && el.isConnected && isOffTarget(el)) jumpTo(el, "instant");
  };
  const finish = () => {
    if (done) return;
    done = true;
    win.clearTimeout(quiet);
    win.clearTimeout(cap);
    ro?.disconnect();
    for (const ev of USER_INPUT) win.removeEventListener(ev, finish, true);
  };
  const settleLater = () => {
    win.clearTimeout(quiet);
    if (fontsReady) quiet = win.setTimeout(finish, settleMs);
  };
  const onResize = () => {
    align();
    settleLater();
  };
  const cap = win.setTimeout(finish, maxMs);
  for (const ev of USER_INPUT) win.addEventListener(ev, finish, { capture: true, passive: true });
  const RO = (win as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
  const ro = RO ? new RO(onResize) : null;
  const main = doc.querySelector("main");
  for (const node of [doc.body, main, ...(main ? [...main.children] : [])]) if (node) ro?.observe(node);
  void doc.fonts?.ready.then(() => {
    fontsReady = true;
    align();
    settleLater();
  });
  jumpTo(el, "instant");
  win.requestAnimationFrame?.(align);
  settleLater();
  return finish;
}

/**
 * Wait until scrolling has stopped (no scroll event for `idleMs`, at most `maxMs`),
 * then call `fn`. Used after a hash change: the browser's own (smooth) jump runs
 * first and is only corrected if it ended off target.
 */
function afterScrollStops(win: Window, fn: () => void, idleMs = 160, maxMs = 3000): () => void {
  let t = win.setTimeout(done, idleMs);
  const cap = win.setTimeout(done, maxMs);
  function onScroll() {
    win.clearTimeout(t);
    t = win.setTimeout(done, idleMs);
  }
  function stop() {
    win.clearTimeout(t);
    win.clearTimeout(cap);
    win.removeEventListener("scroll", onScroll);
  }
  function done() {
    stop();
    fn();
  }
  win.addEventListener("scroll", onScroll, { passive: true });
  return stop;
}

/**
 * Deep links (#film, #utotech, #projects, #skills, #diary, #documents, #contact, as
 * used by the README) land on their section on the first load and on every hash
 * change. `contentKey` changes when the live content replaces the baked one; the
 * page then lands again unless the visitor has already moved.
 */
export function useHashLanding(contentKey: unknown, reduced = false): void {
  const moved = useRef(false);
  const lastInput = useRef(0);
  const first = useRef(true);

  useEffect(() => {
    const mark = () => {
      moved.current = true;
      lastInput.current = performance.now();
    };
    for (const ev of USER_INPUT) window.addEventListener(ev, mark, { capture: true, passive: true });
    let stopWait: (() => void) | null = null;
    const onHash = () => {
      stopWait?.();
      const at = performance.now();
      stopWait = afterScrollStops(window, () => {
        // The visitor took over (wheel, keys, touch) while the jump ran: leave the page where they put it.
        if (lastInput.current > at) return;
        const el = hashTarget();
        if (el && isOffTarget(el)) jumpTo(el, reduced ? "instant" : "smooth");
      });
    };
    window.addEventListener("hashchange", onHash);
    return () => {
      for (const ev of USER_INPUT) window.removeEventListener(ev, mark, true);
      window.removeEventListener("hashchange", onHash);
      stopWait?.();
    };
  }, [reduced]);

  useEffect(() => {
    if (!first.current && moved.current) return;
    first.current = false;
    return holdHashTarget(document);
  }, [contentKey]);
}
