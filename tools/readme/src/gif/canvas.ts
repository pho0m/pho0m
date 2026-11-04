import { dotGlyph } from "../svg/glyphs.ts";

/** A palette-indexed raster with clipping, for drawing GIF frames in Node (no DOM). */
export class Canvas {
  readonly px: Uint8Array;
  private clipBox = { x0: 0, y0: 0, x1: 0, y1: 0 };

  constructor(
    readonly width: number,
    readonly height: number,
    fill: number,
  ) {
    this.px = new Uint8Array(width * height).fill(fill);
    this.unclip();
  }

  clip(x: number, y: number, w: number, h: number): void {
    this.clipBox = {
      x0: Math.max(0, Math.floor(x)),
      y0: Math.max(0, Math.floor(y)),
      x1: Math.min(this.width, Math.floor(x + w)),
      y1: Math.min(this.height, Math.floor(y + h)),
    };
  }

  unclip(): void {
    this.clipBox = { x0: 0, y0: 0, x1: this.width, y1: this.height };
  }

  set(x: number, y: number, c: number): void {
    const { x0, y0, x1, y1 } = this.clipBox;
    if (x >= x0 && x < x1 && y >= y0 && y < y1) this.px[y * this.width + x] = c;
  }

  rect(x: number, y: number, w: number, h: number, c: number): void {
    const { x0, y0, x1, y1 } = this.clipBox;
    const xa = Math.max(x0, Math.round(x));
    const xb = Math.min(x1, Math.round(x + w));
    const ya = Math.max(y0, Math.round(y));
    const yb = Math.min(y1, Math.round(y + h));
    for (let yy = ya; yy < yb; yy++) this.px.fill(c, yy * this.width + xa, yy * this.width + Math.max(xa, xb));
  }

  /** Box with stepped "pixel" corners (two steps of `s`). */
  pxBox(x: number, y: number, w: number, h: number, c: number, s = 3): void {
    this.rect(x + 2 * s, y, w - 4 * s, h, c);
    this.rect(x + s, y + s, w - 2 * s, h - 2 * s, c);
    this.rect(x, y + 2 * s, w, h - 4 * s, c);
  }

  /** Outline of a stepped box, `t` px thick. */
  pxFrame(x: number, y: number, w: number, h: number, c: number, fill: number, t = 2, s = 3): void {
    this.pxBox(x, y, w, h, c, s);
    this.pxBox(x + t, y + t, w - 2 * t, h - 2 * t, fill, s);
  }

  /** Copy a w x h image; `color(i)` gives the palette index of source pixel i. */
  blit(x: number, y: number, w: number, h: number, color: (i: number) => number): void {
    const X = Math.round(x);
    const Y = Math.round(y);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(X + i, Y + j, color(j * w + i));
  }

  /** Right-pointing triangle, `size` px tall. */
  triangle(x: number, y: number, size: number, c: number): void {
    const half = Math.floor(size / 2);
    for (let j = -half; j <= half; j++) this.rect(x, y + j, half - Math.abs(j) + 1, 1, c);
  }

  /** Dot-matrix LED text (5x7 font, `scale` px per dot). Returns the width in px. */
  text(value: string, x: number, y: number, scale: number, c: number): number {
    let cx = Math.round(x);
    for (const ch of value) {
      const g = dotGlyph(ch);
      if (g) g.forEach((row, j) => {
        for (let i = 0; i < row.length; i++) if (row[i] === "#") this.rect(cx + i * scale, y + j * scale, scale, scale, c);
      });
      cx += 6 * scale;
    }
    return textWidth(value, scale);
  }
}

export const textWidth = (value: string, scale: number): number => (value.length ? (Array.from(value).length * 6 - 1) * scale : 0);

/** Upper-case `value` and keep only what the dot-matrix font can draw (accents dropped, unknown characters removed). */
export function dotSafe(value: string): string {
  return Array.from(value.toUpperCase().normalize("NFKD").replace(/[̀-ͯ]/g, ""))
    .map((c) => (/\s/.test(c) ? " " : c === "–" || c === "—" ? "-" : c === "’" || c === "‘" ? "'" : c))
    .filter((c) => dotGlyph(c))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cut `value` to at most `max` px wide at `scale`, ending with ".." when cut. */
export function dotFit(value: string, scale: number, max: number): string {
  if (textWidth(value, scale) <= max) return value;
  const chars = Array.from(value);
  while (chars.length && textWidth(chars.join("").trimEnd() + "..", scale) > max) chars.pop();
  return chars.join("").trimEnd() + "..";
}
