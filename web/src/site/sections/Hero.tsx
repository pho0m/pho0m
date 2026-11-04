import type { Content } from "@pho0m/content";
import { ui, useLang } from "../../lib/i18n.tsx";
import { LinkRow } from "../ui/bits.tsx";
import { Print } from "../ui/Print.tsx";

type Stat = { value: string; label: string };

export function Hero({ content, frameCount }: { content: Content; frameCount: number }) {
  const { lang, t } = useLang();
  const p = content.profile;
  const c = content.company;
  const projectCount = content.projects.filter((x) => x.published).length;

  // Only numbers that are true in the content.
  const stats: Stat[] = [];
  if (c.teamSize.trim()) stats.push({ value: c.teamSize.trim(), label: ui(lang, "คนในทีม Utotech", "Utotech team") });
  if (c.customers.length > 0)
    stats.push({ value: String(c.customers.length), label: ui(lang, "ลูกค้าของ Utotech", "Utotech clients") });
  if (frameCount > 0) stats.push({ value: String(frameCount), label: ui(lang, "เฟรมบนไทม์ไลน์", "Timeline frames") });
  if (projectCount > 0) stats.push({ value: String(projectCount), label: ui(lang, "โปรเจกต์ส่วนตัว", "Personal projects") });
  if (p.codingSince)
    stats.push({ value: String(p.codingSince), label: ui(lang, "เริ่มเขียนโค้ดปี", "Coding since") });

  const edu = p.education[0];
  const location = t(p.location);

  return (
    <section id="top" className="hero" aria-labelledby="hero-name">
      <div className="lamp" aria-hidden="true">
        <span className="lamp-cord" />
        <span className="lamp-head" />
      </div>
      <div className="hero-in wrap">
        <div className="hero-text">
          <p className="hero-kicker lcd">
            <span className="rec" aria-hidden="true" /> {p.handle ? `@${p.handle}` : "pho0m"}
            {p.nickname ? ` · ${p.nickname}` : ""}
            {location ? ` · ${location}` : ""}
          </p>
          <h1 id="hero-name" className="hero-name">
            {t(p.name)}
          </h1>
          <p className="hero-role">{t(p.role)}</p>
          {edu ? (
            <p className="hero-edu lcd">
              {t(edu.school)}
              {t(edu.program) ? ` · ${t(edu.program)}` : ""}
              {edu.period ? ` · ${edu.period}` : ""}
            </p>
          ) : null}
          <p className="hero-headline">{t(p.headline)}</p>
          <p className="hero-bio">{t(p.bio)}</p>
          {stats.length > 0 ? (
            <ul className="stats" role="list">
              {stats.map((s) => (
                <li key={s.label} className="stat px">
                  <span className="stat-v lcd">{s.value}</span>
                  <span className="stat-l">{s.label}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <LinkRow links={p.links} />
        </div>

        {p.avatar ? (
          <div className="hero-print">
            <span className="hang-line" aria-hidden="true" />
            <div className="hang">
              <span className="peg" aria-hidden="true" />
              <div className="hang-paper">
                <Print image={p.avatar} width={150} aspect={4 / 5} develop className="print--avatar" />
                <p className="hang-cap lcd" aria-hidden="true">
                  {p.handle || "pho0m"} · ISO 400
                </p>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <a href="#film" className="scrollcue">
        <span className="scrollcue-text lcd">
          {ui(lang, "เลื่อนลง ฟิล์มจะเดินไปทีละเฟรม", "Scroll down to advance the film")}
        </span>
        <span className="scrollcue-arrow" aria-hidden="true" />
      </a>
    </section>
  );
}
