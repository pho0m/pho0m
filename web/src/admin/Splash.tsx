import type { ReactNode } from "react";

/** Full-screen centred message (loading, fatal errors). */
export function Splash({ children }: { children: ReactNode }) {
  return (
    <div className="splash">
      <div className="splash-box px">
        <div className="splash-mark lcd" aria-hidden="true">
          DEV ▸ STOP ▸ FIX ▸ DRY
        </div>
        <div className="splash-body">{children}</div>
      </div>
    </div>
  );
}
