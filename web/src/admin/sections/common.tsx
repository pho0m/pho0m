import type { ReactNode } from "react";

export function SectionHead({ title, en, children }: { title: string; en: string; children?: ReactNode }) {
  return (
    <header className="section-head">
      <h1>
        {title} <small className="lcd">{en}</small>
      </h1>
      {children ? <div className="section-intro">{children}</div> : null}
    </header>
  );
}

/** Small LED-style status chip. */
export function Chip({ tone = "muted", children }: { tone?: "ok" | "warn" | "red" | "muted"; children: ReactNode }) {
  return <span className={`chip chip-${tone}`}>{children}</span>;
}
