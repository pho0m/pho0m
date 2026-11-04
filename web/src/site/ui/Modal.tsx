import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ui, useLang } from "../../lib/i18n.tsx";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type Props = {
  onClose: () => void;
  /** id of the heading that names the dialog. */
  labelledBy: string;
  className?: string;
  children: ReactNode;
};

/**
 * Modal dialog rendered while mounted: role=dialog + aria-modal, the page behind
 * is made inert, Tab is trapped, Escape and the backdrop close it, and focus
 * returns to where it was.
 */
export function Modal({ onClose, labelledBy, className = "", children }: Props) {
  const { lang } = useLang();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.getElementById("root");
    const html = document.documentElement;
    const prevOverflow = html.style.overflow;
    root?.setAttribute("inert", "");
    html.style.overflow = "hidden";

    const panel = panelRef.current;
    const focusables = () =>
      panel ? [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest("[inert]")) : [];
    (focusables()[0] ?? panel)?.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const list = focusables();
      if (list.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = list[0]!;
      const last = list[list.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      root?.removeAttribute("inert");
      html.style.overflow = prevOverflow;
      prev?.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={`modal ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
      >
        <button type="button" className="modal-close lcd" onClick={onClose} aria-label={ui(lang, "ปิด", "Close")}>
          ✕ <span aria-hidden="true">ESC</span>
        </button>
        {children}
      </div>
    </div>,
    document.body,
  );
}
