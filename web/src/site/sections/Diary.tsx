import { useId, useRef, type CSSProperties } from "react";
import type { Diary as DiaryT, Profile } from "@pho0m/content";
import { ui, useLang } from "../../lib/i18n.tsx";
import { LinkRow, SectionHead } from "../ui/bits.tsx";
import { hostOf } from "../util.ts";
import { useNearViewport } from "../hooks.ts";

export function Diary({ diary: d, profile }: { diary: DiaryT; profile: Profile }) {
  const { lang, t } = useLang();
  const base = useId();
  const dutiesRef = useRef<HTMLDivElement>(null);
  // the darkroom timer runs once and lights the duties one by one when they come into view
  const dutiesSeen = useNearViewport(dutiesRef, "0px 0px -20% 0px");
  const co = d.company;
  const dream = t(profile.dream);

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
                <img
                  className="co-logo"
                  src={co.logo.url}
                  alt={t(co.logo.alt)}
                  width={64}
                  height={64}
                  loading="lazy"
                  decoding="async"
                />
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
            <div ref={dutiesRef} className={`duties ${dutiesSeen ? "is-in" : "is-out"}`}>
              <h3 className="sub-title duties-title">
                {ui(lang, "หน้าที่ที่ได้รับ", "My duties")}
                <span className="duty-dial" aria-hidden="true">
                  <i />
                </span>
              </h3>
              <ol className="duty-list" role="list">
                {d.duties.map((x, i) => (
                  <li key={i} className="duty" style={{ "--i": i } as CSSProperties}>
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

        {docLinks.length ? (
          <div className="diary-docs">
            <LinkRow links={docLinks} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
