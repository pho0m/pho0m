import { loadImage, sourceToImageData } from "../../lib/pixel.ts";

const cache = new Map<string, Promise<HTMLImageElement>>();

/** loadImage() with a per-URL cache; failed loads are forgotten so they can be retried. */
export function loadCached(url: string): Promise<HTMLImageElement> {
  let p = cache.get(url);
  if (!p) {
    p = loadImage(url);
    cache.set(url, p);
    p.catch(() => cache.delete(url));
  }
  return p;
}

const natural = (img: HTMLImageElement) => ({
  w: img.naturalWidth || img.width || 1,
  h: img.naturalHeight || img.height || 1,
});

/**
 * True when the image has see-through corners (a cut-out logo). Throws on a
 * tainted (non-CORS) image, like sourceToImageData.
 */
export function hasTransparentEdges(img: HTMLImageElement): boolean {
  const c = document.createElement("canvas");
  c.width = 8;
  c.height = 8;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(img, 0, 0, 8, 8);
  const d = ctx.getImageData(0, 0, 8, 8).data;
  const corners = [0, 7, 56, 63];
  return corners.some((p) => d[p * 4 + 3]! < 250);
}

/** Contain-fit a cut-out image on white paper with a small margin. */
function containOnPaper(img: HTMLImageElement, w: number, h: number): ImageData {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  const { w: sw, h: sh } = natural(img);
  const scale = Math.min((w * 0.84) / sw, (h * 0.84) / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  return ctx.getImageData(0, 0, w, h);
}

export type Tone = { black: number; white: number };
export type PrintSource = { data: ImageData; tone: Tone | undefined };

/**
 * Per-photo tone curve for ditherPrint: map the darkest/lightest `clip` share of
 * pixels to solid ink/paper so the subject reads as a clean silhouette.
 */
export function autoTone(src: ImageData, clip = 0.12, minSpan = 0.35): Tone {
  const hist = new Uint32Array(256);
  const d = src.data;
  for (let k = 0; k < d.length; k += 4) hist[Math.round(d[k]! * 0.3 + d[k + 1]! * 0.59 + d[k + 2]! * 0.11)]!++;
  const total = d.length / 4;
  const at = (q: number) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v]!;
      if (acc >= q * total) return v / 255;
    }
    return 1;
  };
  let black = at(clip);
  let white = at(1 - clip);
  if (white - black < minSpan) {
    const mid = (white + black) / 2;
    black = Math.max(0, mid - minSpan / 2);
    white = Math.min(1, mid + minSpan / 2);
  }
  return { black, white };
}

/**
 * Image → bitmap ready for ditherPrint: photos are cover-fitted (pixel.ts) and
 * get an auto tone curve; cut-out logos are placed on white so their transparent
 * parts print as paper. Throws when the canvas cannot be read (CORS).
 */
export function toPrintSource(img: HTMLImageElement, w: number, h: number): PrintSource {
  if (hasTransparentEdges(img)) return { data: containOnPaper(img, w, h), tone: undefined };
  const data = sourceToImageData(img, w, h);
  return { data, tone: autoTone(data) };
}

/** Height for a target width keeping the image's natural aspect (bounded). */
export function naturalHeight(img: HTMLImageElement, w: number, minAspect = 0.5, maxAspect = 2): number {
  const { w: sw, h: sh } = natural(img);
  const ratio = Math.min(maxAspect, Math.max(minAspect, sw / sh));
  return Math.max(1, Math.round(w / ratio));
}
