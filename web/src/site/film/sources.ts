import type { Frame } from "@pho0m/content";
import { FRAME_H, FRAME_W, PRINT_H, PRINT_W } from "../../lib/pixel.ts";
import { iconSource, type PrintSource } from "../../lib/print.ts";
import { ensureFinals, photoPrintSource, type FinalsOptions } from "../ui/images.ts";

/** Time of day for the generated scene: dawn for the oldest frame, night for the newest. */
export const sceneTime = (i: number, n: number): number => (n > 1 ? i / (n - 1) : 0);

/** What the film paints for a frame: clear print, negative and the dither at frame size. */
export const FILM_FINALS: FinalsOptions = { negative: true, dev: { w: FRAME_W, h: FRAME_H } };

const cache = new Map<string, Promise<PrintSource>>();

/**
 * Print source for a frame: its first image (CORS-loaded, PRINT size by default),
 * or the generated pixel-art scene when it has none or the image cannot be read.
 * Resolves once the pieces in `opts` are computed (in the print worker when there
 * is one), so painting it is only a canvas copy.
 */
export function frameSource(
  frame: Frame,
  i: number,
  n: number,
  w = PRINT_W,
  h = PRINT_H,
  opts: FinalsOptions = FILM_FINALS,
): Promise<PrintSource> {
  const img = frame.images[0];
  const key = `${img?.url ?? ""}|${frame.icon}|${i}|${n}|${w}x${h}`;
  let p = cache.get(key);
  if (!p) {
    p = (async (): Promise<PrintSource> => {
      if (img) {
        try {
          return await photoPrintSource(img.url, w, h, opts);
        } catch {
          /* CORS / taint / network: fall back to the pixel scene */
        }
      }
      return iconSource(frame.icon, sceneTime(i, n), i);
    })();
    cache.set(key, p);
  }
  return p.then(async (src) => {
    await ensureFinals(src, opts);
    return src;
  });
}
