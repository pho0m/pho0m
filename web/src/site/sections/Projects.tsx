import { useMemo, useRef, useState } from "react";
import { PROJECT_GROUPS, type Project } from "@pho0m/content";
import { ui, useLang } from "../../lib/i18n.tsx";
import { A, SectionHead, Tags } from "../ui/bits.tsx";
import { Print } from "../ui/Print.tsx";
import { groupLabel, projectGroups } from "../util.ts";
import { DarkroomBench } from "../darkroom/Bench.tsx";
import { BENCH_STAGES } from "../darkroom/bench.ts";

/** "all" or a project group id (any string, so a group added to the contract later still works). */
type Filter = string;

export function Projects({ projects }: { projects: Project[] }) {
  const { lang, t } = useLang();
  const [filter, setFilter] = useState<Filter>("all");
  const listRef = useRef<HTMLUListElement>(null);

  const published = useMemo(
    () =>
      projects
        .map((p, i) => ({ p, i }))
        .filter(({ p }) => p.published)
        .sort((a, b) => Number(b.p.featured) - Number(a.p.featured) || a.i - b.i)
        .map(({ p }) => p),
    [projects],
  );
  const groups = projectGroups(
    PROJECT_GROUPS,
    published.map((p) => p.group),
  );
  // A filter whose group vanished (live content swap) falls back to "all".
  const active: Filter = filter !== "all" && groups.includes(filter) ? filter : "all";
  const list = active === "all" ? published : published.filter((p) => p.group === active);
  if (published.length === 0) return null;
  const hasClient = groups.includes("client");

  const chips: { id: Filter; label: string; count: number }[] = [
    { id: "all", label: ui(lang, "ทั้งหมด", "All"), count: published.length },
    ...groups.map((g) => ({ id: g, label: groupLabel(g, lang), count: published.filter((p) => p.group === g).length })),
  ];

  return (
    <section id="projects" className="sec projects" aria-labelledby="projects-title">
      <div className="wrap">
        <SectionHead
          no="03"
          kicker={
            hasClient
              ? ui(lang, "งานลูกค้า · ส่วนตัว · สอน · สมัยเรียน", "CLIENT WORK · SIDE WORK · TEACHING · SCHOOL")
              : ui(lang, "งานส่วนตัว · สอน · สมัยเรียน", "SIDE WORK · TEACHING · SCHOOL")
          }
          title={ui(lang, "โปรเจกต์", "Projects")}
          id="projects-title"
          lead={
            hasClient
              ? ui(
                  lang,
                  "งานที่ทำให้ลูกค้า โปรเจกต์ที่ทำเอง ชุดสื่อการสอน และงานสมัยเรียน",
                  "Work for clients, things I built on my own, teaching material and school work.",
                )
              : ui(
                  lang,
                  "โปรเจกต์ที่ทำเอง ชุดสื่อการสอน และงานสมัยเรียน",
                  "Things I built on my own, teaching material and school work.",
                )
          }
        />
        <div className="chips" role="group" aria-label={ui(lang, "กรองตามกลุ่ม", "Filter by group")}>
          {chips.map((c) => (
            <button
              key={c.id}
              type="button"
              className="chip-btn px"
              aria-pressed={active === c.id}
              onClick={() => setFilter(c.id)}
            >
              {c.label} <span className="chip-count lcd">{c.count}</span>
            </button>
          ))}
        </div>
        <p className="sr-only" aria-live="polite">
          {ui(lang, `แสดง ${list.length} โปรเจกต์`, `Showing ${list.length} projects`)}
        </p>
        {active === "client" ? (
          <p className="nda-note">
            <span className="nda-tag lcd" aria-hidden="true">
              NDA
            </span>
            {ui(
              lang,
              "งานลูกค้ามักติดสัญญา NDA จึงแสดงเป็นข้อความเท่านั้น ไม่มีภาพหน้าจอ",
              "Client work is often under NDA, so it is shown as text only, without screenshots.",
            )}
          </p>
        ) : null}
        <div className="pj-darkroom">
          <DarkroomBench projects={list} listRef={listRef} />
          <ul ref={listRef} className="pgrid pgrid--darkroom" role="list">
            {list.map((p, i) => (
              <li
                key={p.id}
                className={`pcard${p.featured ? " pcard--featured" : ""}${p.group === "client" ? " pcard--client" : ""}`}
              >
                <div className="pcard-edge lcd" aria-hidden="true">
                  <span>▸{i + 1}</span>
                  {/* lit by the darkroom bench as the card goes through the trays (data-stage on the card) */}
                  <span className="pcard-stages">
                    {BENCH_STAGES.map((s) => (
                      <span key={s} className={`stg stg--${s.toLowerCase()}`}>
                        {s}
                      </span>
                    ))}
                  </span>
                  <span>{p.featured ? "★ " : ""}PHO0M 400</span>
                </div>
                {/* client work is text only (NDA): never show a screenshot for it */}
                {p.image && p.group !== "client" ? <Print image={p.image} width={160} aspect={16 / 9} /> : null}
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
      </div>
    </section>
  );
}
