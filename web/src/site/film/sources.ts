import type { Frame } from "@pho0m/content";
import { FRAME_H, FRAME_W, iconScene } from "../../lib/pixel.ts";
import { loadCached, toPrintSource, type Tone } from "../ui/images.ts";

export type FrameSource = { data: ImageData; photo: boolean; tone: Tone | undefined };

/** Time of day for the generated scene: dawn for the oldest frame, night for the newest. */
export const sceneTime = (i: number, n: number): number => (n > 1 ? i / (n - 1) : 0);

const cache = new Map<string, Promise<FrameSource>>();

/**
 * Colour source bitmap for a frame: its first image (CORS-loaded), or the
 * generated icon scene when it has none or the image cannot be read.
 */
export function frameSource(frame: Frame, i: number, n: number, w = FRAME_W, h = FRAME_H): Promise<FrameSource> {
  const img = frame.images[0];
  const key = `${img?.url ?? ""}|${frame.icon}|${i}|${n}|${w}x${h}`;
  let p = cache.get(key);
  if (!p) {
    p = (async (): Promise<FrameSource> => {
      if (img) {
        try {
          const el = await loadCached(img.url);
          const { data, tone } = toPrintSource(el, w, h);
          return { data, tone, photo: true };
        } catch {
          /* CORS / taint / network: fall back to the pixel scene */
        }
      }
      return { data: iconScene(frame.icon, sceneTime(i, n), i), photo: false, tone: undefined };
    })();
    cache.set(key, p);
  }
  return p;
}
