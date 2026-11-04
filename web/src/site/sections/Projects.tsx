import { useMemo, useState } from "react";
import { PROJECT_GROUPS, type Project } from "@pho0m/content";
import { ui, useLang } from "../../lib/i18n.tsx";
import { A, SectionHead, Tags } from "../ui/bits.tsx";
import { Print } from "../ui/Print.tsx";
import { groupLabel } from "../util.ts";

type Filter = "all" | Project["group"];

export function Projects({ projects }: { projects: Project[] }) {
  const { lang, t } = useLang();
  const [filter, setFilter] = useState<Filter>("all");

  const published = useMemo(
    () =>
      projects
        .map((p, i) => ({ p, i }))
        .filter(({ p }) => p.published)
        .sort((a, b) => Number(b.p.featured) - Number(a.p.featured) || a.i - b.i)
        .map(({ p }) => p),
    [projects],
  );
  const groups = PROJECT_GROUPS.filter((g) => published.some((p) => p.group === g));
  const list = filter === "all" ? published : published.filter((p) => p.group === filter);
  if (published.length === 0) return null;

  const chips: { id: Filter; label: string; count: number }[] = [
    { id: "all", label: ui(lang, "ทั้งหมด", "All"), count: published.length },
    ...groups.map((g) => ({ id: g, label: groupLabel(g, lang), count: published.filter((p) => p.group === g).length })),
  ];

  return (
    <section id="projects" className="sec projects" aria-labelledby="projects-title">
      <div className="wrap">
        <SectionHead
          no="03"
          kicker={ui(lang, "งานส่วนตัว · สอน · สมัยเรียน", "SIDE WORK · TEACHING · SCHOOL")}
          title={ui(lang, "โปรเจกต์", "Projects")}
          id="projects-title"
          lead={ui(
            lang,
            "โปรเจกต์ที่ทำเอง ชุดสื่อการสอน และงานสมัยเรียน",
            "Things I built on my own, teaching material and school work.",
          )}
        />
        <div className="chips" role="group" aria-label={ui(lang, "กรองตามกลุ่ม", "Filter by group")}>
          {chips.map((c) => (
            <button
              key={c.id}
              type="button"
              className="chip-btn px"
              aria-pressed={filter === c.id}
              onClick={() => setFilter(c.id)}
            >
              {c.label} <span className="chip-count lcd">{c.count}</span>
            </button>
          ))}
        </div>
        <p className="sr-only" aria-live="polite">
          {ui(lang, `แสดง ${list.length} โปรเจกต์`, `Showing ${list.length} projects`)}
        </p>
        <ul className="pgrid" role="list">
          {list.map((p, i) => (
            <li key={p.id} className={`pcard${p.featured ? " pcard--featured" : ""}`}>
              <div className="pcard-edge lcd" aria-hidden="true">
                <span>▸{i + 1}</span>
                <span>{p.featured ? "★ " : ""}PHO0M 400</span>
              </div>
              {p.image ? <Print image={p.image} width={160} aspect={16 / 9} /> : null}
              <div className="pcard-body">
                <p className="pcard-meta lcd">
                  {p.year ? <span>{p.year}</span> : null}
                  <span>{groupLabel(p.group, lang)}</span>
                  {p.featured ? <span className="pcard-feat">{ui(lang, "เด่น", "FEATURED")}</span> : null}
                </p>
                <h3 className="pcard-name">{p.name}</h3>
                <p className="pcard-desc">{t(p.description)}</p>
                <Tags tags={p.tags} />
                {p.repo || p.url ? (
                  <p className="pcard-links">
                    {p.repo ? (
                      <A href={p.repo} className="tlink">
                        <span className="lcd" aria-hidden="true">
                          GH
                        </span>{" "}
                        {ui(lang, "ซอร์สโค้ด", "Source")} <span className="sr-only">{p.name}</span>↗
                      </A>
                    ) : null}
                    {p.url ? (
                      <A href={p.url} className="tlink">
                        <span className="lcd" aria-hidden="true">
                          DEMO
                        </span>{" "}
                        {ui(lang, "เดโม", "Demo")} <span className="sr-only">{p.name}</span>↗
                      </A>
                    ) : null}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
