/** A film spool drawn on a 32×32 pixel grid (rotated by the film loop). */
const R = 15.5;
const C = 16;

function cells(): { x: number; y: number; k: "rim" | "disc" | "hole" | "hub" | "pin" | "film" }[] {
  const out: { x: number; y: number; k: "rim" | "disc" | "hole" | "hub" | "pin" | "film" }[] = [];
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const dx = x + 0.5 - C;
      const dy = y + 0.5 - C;
      const d = Math.hypot(dx, dy);
      if (d > R) continue;
      const a = Math.atan2(dy, dx);
      // five window cut-outs between the rim and the hub
      const sector = ((a + Math.PI * 2) % ((Math.PI * 2) / 5)) / ((Math.PI * 2) / 5);
      let k: (typeof out)[number]["k"];
      if (d > R - 1.6) k = "rim";
      else if (d > 9.5 && d < 13 && sector > 0.18 && sector < 0.82) k = "hole";
      else if (d < 2.2) k = "pin";
      else if (d < 5) k = "hub";
      else if (d < 8.5) k = "film";
      else k = "disc";
      out.push({ x, y, k });
    }
  return out;
}

const FILL = {
  rim: "var(--line-2)",
  disc: "var(--bg-3)",
  hole: "var(--hole)",
  hub: "var(--line)",
  pin: "var(--led)",
  film: "var(--film-base)",
} as const;

/** One path per colour keeps the DOM small. */
const PATHS = (Object.keys(FILL) as (keyof typeof FILL)[]).map((k) => ({
  k,
  d: cells()
    .filter((p) => p.k === k)
    .map((p) => `M${p.x} ${p.y}h1v1h-1z`)
    .join(""),
}));

export function Spool() {
  return (
    <svg viewBox="0 0 32 32" className="spool" shapeRendering="crispEdges" focusable="false">
      {PATHS.map((p) => (
        <path key={p.k} d={p.d} fill={FILL[p.k]} />
      ))}
    </svg>
  );
}
