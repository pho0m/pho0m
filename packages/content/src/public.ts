import type { Content } from "./schema.ts";

/**
 * The part of the content that may be published (content/site.json in the public bucket,
 * the baked HTML, llms.txt, README). Drafts and hidden items never leave the admin:
 *  - timeline frames, projects and Utotech projects with published=false are removed
 *  - profile email/phone values are blanked when not marked visible
 *  - documents without a url are removed
 * Pure and idempotent: publicProjection(publicProjection(c)) equals publicProjection(c).
 */
export function publicProjection(content: Content): Content {
  const c: Content = structuredClone(content);
  c.timeline = c.timeline.filter((f) => f.published);
  c.projects = c.projects.filter((p) => p.published);
  c.company.projects = c.company.projects.filter((p) => p.published);
  if (!c.profile.email.visible) c.profile.email = { value: "", visible: false };
  if (!c.profile.phone.visible) c.profile.phone = { value: "", visible: false };
  c.documents = c.documents.filter((d) => d.url.trim() !== "");
  return c;
}
