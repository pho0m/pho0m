import { useId, useState } from "react";
import type { Diary as DiaryT, Profile } from "@pho0m/content";
import { ui, useLang } from "../../lib/i18n.tsx";
import { LinkRow, SectionHead } from "../ui/bits.tsx";
import { Print } from "../ui/Print.tsx";
import { hostOf, paragraphs } from "../util.ts";

export function Diary({ diary: d, profile }: { diary: DiaryT; profile: Profile }) {
  const { lang, t } = useLang();
  const base = useId();
  const [open, setOpen] = useState<Set<string>>(() => new Set(d.entries[0] ? [d.entries[0].id] : []));
  const co = d.company;
  const dream = t(profile.dream);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const coLinks = [
    co.website ? { kind: "website" as const, label: hostOf(co.website), url: co.website } : null,
    co.facebook ? { kind: "facebook" as const, label: "Facebook", url: co.facebook } : null,
  ].filter((l): l is NonNullable<typeof l> => l !== null);

  const docLinks = [
    d.sheetUrl ? { kind: "document" as const, label: ui(lang, "ตารางบันทึกรายวัน", "Daily log sheet"), url: d.sheetUrl } : null,
    d.slidesUrl ? { kind: "document" as const, label: ui(lang, "สไลด์สรุปสหกิจ", "Co-op slides"), url: d.slidesUrl } : null,
  ].filter((l): l is NonNullable<typeof l> => l !== null);

  return (
    <section id="diary" className="sec diary" aria-labelledby="diary-title">
      <div className="wrap">
        <SectionHead
          no="05"
          kicker={ui(lang, "สหกิจศึกษา", "CO-OP")}
          title={t(d.title)}
          id="diary-title"
          lead={t(d.intro)}
        />
        {dream ? (
          <blockquote className="dream">
            <p>{dream}</p>
          </blockquote>
        ) : null}

        <div className="diary-grid">
          <article className="co-card paper px" aria-labelledby={`${base}-co`}>
            <div className="co-top">
              {co.logo ? (
                <img className="co-logo" src={co.logo.url} alt={t(co.logo.alt)} loading="lazy" decoding="async" />
              ) : null}
              <div>
                <h3 id={`${base}-co`} className="co-name">
                  {t(co.name)}
                </h3>
                {co.legalName ? <p className="co-legal">{co.legalName}</p> : null}
                {t(co.type) ? <p className="co-type">{t(co.type)}</p> : null}
              </div>
            </div>
            {t(co.about) ? <p className="co-about">{t(co.about)}</p> : null}
            {t(co.address) ? (
              <p className="co-address">
                <span className="co-k">{ui(lang, "ที่อยู่", "Address")}</span> {t(co.address)}
              </p>
            ) : null}
            <LinkRow links={coLinks} small />
          </article>

          {d.duties.length ? (
            <div className="duties">
              <h3 className="sub-title">{ui(lang, "หน้าที่ที่ได้รับ", "My duties")}</h3>
              <ol className="duty-list" role="list">
                {d.duties.map((x, i) => (
                  <li key={i} className="duty">
                    <span className="duty-no lcd" aria-hidden="true">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <h4 className="duty-title">{t(x.title)}</h4>
                      <p>{t(x.description)}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>

        {d.entries.length ? (
          <div className="entries">
            <h3 className="sub-title">{ui(lang, "บันทึกรายเดือน", "Month by month")}</h3>
            {d.entries.map((e, i) => {
              const isOpen = open.has(e.id);
              const btn = `${base}-${e.id}-btn`;
              const panel = `${base}-${e.id}-panel`;
              return (
                <div key={e.id} className="entry" data-open={isOpen || undefined}>
                  <h4 className="entry-h">
                    <button
                      id={btn}
                      type="button"
                      className="entry-btn"
                      aria-expanded={isOpen}
                      aria-controls={panel}
                      onClick={() => toggle(e.id)}
                    >
                      <span className="entry-no lcd" aria-hidden="true">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="entry-month">{t(e.month)}</span>
                      <span className="entry-title">{t(e.title)}</span>
                      {e.period ? <span className="entry-period lcd">{e.period}</span> : null}
                      <span className="entry-icon lcd" aria-hidden="true">
                        {isOpen ? "−" : "+"}
                      </span>
                    </button>
                  </h4>
                  <div id={panel} role="region" aria-labelledby={btn} className="entry-body" hidden={!isOpen}>
                    {paragraphs(t(e.body)).map((p, k) => (
                      <p key={k}>{p}</p>
                    ))}
                    {e.images.length ? (
                      <ul className="entry-imgs" role="list">
                        {e.images.map((img, k) => (
                          <li key={`${img.url}-${k}`}>
                            <Print image={img} width={160} aspect={4 / 3} reveal />
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        {docLinks.length ? (
          <div className="diary-docs">
            <LinkRow links={docLinks} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
