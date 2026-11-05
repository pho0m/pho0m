import { PROJECT_GROUPS } from "@pho0m/content";

/**
 * Labels for project groups. Derived from PROJECT_GROUPS so a group added to the
 * schema shows up everywhere at once; a group without a label here falls back to its id.
 */

export type GroupLabel = { th: string; en: string };

const LABELS: Readonly<Record<string, GroupLabel>> = {
  utotech: { th: "Utotech", en: "Utotech" },
  client: { th: "งานลูกค้า (NDA)", en: "Client work" },
  personal: { th: "ส่วนตัว", en: "Personal" },
  teaching: { th: "สอน / แบ่งปัน", en: "Teaching" },
  school: { th: "งานเรียน", en: "School" },
  coop: { th: "สหกิจ", en: "Co-op" },
};

export function groupLabel(group: string): GroupLabel {
  return Object.hasOwn(LABELS, group) ? LABELS[group]! : { th: group, en: group };
}

/** Options for the group <select>: "งานลูกค้า (NDA) · Client work". */
export function groupOptions<G extends string>(groups: readonly G[]): { value: G; label: string }[] {
  return groups.map((g) => {
    const l = groupLabel(g);
    return { value: g, label: l.th === l.en ? l.th : `${l.th} · ${l.en}` };
  });
}

export const GROUP_OPTIONS = groupOptions(PROJECT_GROUPS);

/** Groups whose work is usually under NDA: text only, no screenshots. */
export const NDA_GROUPS: readonly string[] = ["client"];
