import { parseContent } from "./index.ts";
import type { Content } from "./schema.ts";
import seedJson from "../../../content/seed.json";

/**
 * The content committed in content/seed.json, validated. Throws if the seed is invalid.
 * Its own entry point ("@pho0m/content/seed") so the public site bundle does not carry the
 * whole seed: the built pages embed the published content instead.
 */
export const seed: Content = (() => {
  const r = parseContent(seedJson);
  if (!r.ok) {
    throw new Error(
      "content/seed.json is invalid:\n" + r.issues.map((i) => `  ${i.path}: ${i.message}`).join("\n"),
    );
  }
  return r.content;
})();
