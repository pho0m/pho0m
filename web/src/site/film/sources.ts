import type { Frame } from "@pho0m/content";
import { PRINT_H, PRINT_W } from "../../lib/pixel.ts";
import { iconSource, type PrintSource } from "../../lib/print.ts";
import { photoPrintSource } from "../ui/images.ts";

/** Time of day for the generated scene: dawn for the oldest frame, night for the newest. */
export const sceneTime = (i: number, n: number): number => (n > 1 ? i / (n - 1) : 0);

const cache = new Map<string, Promise<PrintSource>>();

/**
 * Print source for a frame: its first image (CORS-loaded, PRINT size by default),
 * or the generated pixel-art scene when it has none or the image cannot be read.
 */
export function frameSource(frame: Frame, i: number, n: number, w = PRINT_W, h = PRINT_H): Promise<PrintSource> {
  const img = frame.images[0];
  const key = `${img?.url ?? ""}|${frame.icon}|${i}|${n}|${w}x${h}`;
  let p = cache.get(key);
  if (!p) {
    p = (async (): Promise<PrintSource> => {
      if (img) {
        try {
          return await photoPrintSource(img.url, w, h);
        } catch {
          /* CORS / taint / network: fall back to the pixel scene */
        }
      }
      return iconSource(frame.icon, sceneTime(i, n), i);
    })();
    cache.set(key, p);
  }
  return p;
}
