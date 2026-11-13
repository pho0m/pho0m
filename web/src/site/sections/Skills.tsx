import { SKILL_LEVEL_MAX, type SkillGroup } from "@pho0m/content";
import { ui, useLang } from "../../lib/i18n.tsx";
import { SectionHead } from "../ui/bits.tsx";
import { badgeTint, monogram } from "../util.ts";

const STEPS = Array.from({ length: SKILL_LEVEL_MAX }, (_, i) => i + 1);
const levelLabel = (level: number, lang: "th" | "en") =>
  lang === "th" ? `ระดับ ${level} จาก ${SKILL_LEVEL_MAX}` : `Level ${level} of ${SKILL_LEVEL_MAX}`;

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
            const level = Math.min(SKILL_LEVEL_MAX, Math.max(1, g.level));
            return (
              <li key={g.id} className="tier" data-level={level}>
                <div className="tier-head">
                  <p className="tier-dots" role="img" aria-label={levelLabel(level, lang)}>
                    {STEPS.map((k) => (
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
