import type { SkillGroup } from "@pho0m/content";
import { ui, useLang } from "../../lib/i18n.tsx";
import { SectionHead } from "../ui/bits.tsx";
import { badgeTint, monogram } from "../util.ts";

const LEVEL_LABEL = {
  3: { th: "ระดับ 3 จาก 3", en: "Level 3 of 3" },
  2: { th: "ระดับ 2 จาก 3", en: "Level 2 of 3" },
  1: { th: "ระดับ 1 จาก 3", en: "Level 1 of 3" },
} as const;

export function Skills({ skills }: { skills: SkillGroup[] }) {
  const { lang, t } = useLang();
  if (skills.length === 0) return null;
  return (
    <section id="skills" className="sec skills" aria-labelledby="skills-title">
      <div className="wrap">
        <SectionHead
          no="04"
          kicker={ui(lang, "เครื่องมือที่ใช้", "TOOLS I USE")}
          title={ui(lang, "ทักษะ", "Skills")}
          id="skills-title"
          lead={ui(lang, "แบ่งตามระดับที่ใช้ได้จริง", "Grouped by how ready I am to use them.")}
        />
        <ul className="tiers" role="list">
          {skills.map((g) => {
            const level = Math.min(3, Math.max(1, g.level)) as 1 | 2 | 3;
            return (
              <li key={g.id} className="tier" data-level={level}>
                <div className="tier-head">
                  <p className="tier-dots" role="img" aria-label={LEVEL_LABEL[level][lang]}>
                    {[1, 2, 3].map((k) => (
                      <span key={k} className={k <= level ? "dot on" : "dot"} />
                    ))}
                  </p>
                  <h3 className="tier-title">{t(g.title)}</h3>
                  {t(g.description) ? <p className="tier-desc">{t(g.description)}</p> : null}
                </div>
                <ul className="tier-items" role="list">
                  {g.items.map((s) => (
                    <li key={s.name} className="skill">
                      <span className="mono lcd" style={{ background: badgeTint(s.name) }} aria-hidden="true">
                        {monogram(s.name)}
                      </span>
                      <span className="skill-name">{s.name}</span>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
