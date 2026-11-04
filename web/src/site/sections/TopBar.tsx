import { useEffect, useRef, useState } from "react";
import { ui, useLang } from "../../lib/i18n.tsx";
import { useActiveSection } from "../hooks.ts";

const NAV = [
  { id: "film", th: "ฟิล์ม", en: "Film" },
  { id: "utotech", th: "Utotech", en: "Utotech" },
  { id: "projects", th: "โปรเจกต์", en: "Projects" },
  { id: "skills", th: "ทักษะ", en: "Skills" },
  { id: "diary", th: "บันทึก", en: "Diary" },
  { id: "contact", th: "ติดต่อ", en: "Contact" },
] as const;
const IDS = NAV.map((n) => n.id);

export function TopBar() {
  const { lang, setLang } = useLang();
  const [open, setOpen] = useState(false);
  const active = useActiveSection(IDS);
  const navRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // Close the phone menu on Escape or a click outside it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  return (
    <header className="topbar">
      <div className="topbar-in">
        <a href="#top" className="logo lcd" aria-label={ui(lang, "pho0m กลับขึ้นด้านบน", "pho0m, back to top")}>
          <span className="logo-led" aria-hidden="true" />
          PHO0M
        </a>
        <nav ref={navRef} className="nav" aria-label={ui(lang, "เมนูหลัก", "Main menu")}>
          <button
            ref={toggleRef}
            type="button"
            className="nav-toggle lcd"
            aria-expanded={open}
            aria-controls="nav-list"
            onClick={() => setOpen((o) => !o)}
          >
            <span aria-hidden="true">{open ? "✕" : "☰"}</span> {ui(lang, "เมนู", "MENU")}
          </button>
          <ul id="nav-list" className="nav-list" data-open={open || undefined}>
            {NAV.map((n) => (
              <li key={n.id}>
                <a
                  href={`#${n.id}`}
                  aria-current={active === n.id ? "location" : undefined}
                  onClick={() => setOpen(false)}
                >
                  {ui(lang, n.th, n.en)}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="langs lcd" role="group" aria-label={ui(lang, "ภาษา", "Language")}>
          <button type="button" aria-pressed={lang === "th"} onClick={() => setLang("th")} aria-label="ภาษาไทย" lang="th">
            TH
          </button>
          <button type="button" aria-pressed={lang === "en"} onClick={() => setLang("en")} aria-label="English" lang="en">
            EN
          </button>
        </div>
      </div>
    </header>
  );
}
