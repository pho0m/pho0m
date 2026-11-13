import type { Company, Profile } from "@pho0m/content";
import { ui, useLang } from "../../lib/i18n.tsx";
import { LinkRow, SectionHead } from "../ui/bits.tsx";
import { Print } from "../ui/Print.tsx";
import { paragraphs, telHref } from "../util.ts";

export function Utotech({ company: c, profile }: { company: Company; profile: Profile }) {
  const { lang, t } = useLang();
  const projects = c.projects.filter((p) => p.published);

  const facts: { k: string; v: string; note?: string }[] = [];
  if (c.founded) facts.push({ k: ui(lang, "ก่อตั้ง", "FOUNDED"), v: c.founded, note: t(c.foundedNote) });
  if (c.teamSize) facts.push({ k: ui(lang, "ทีม", "TEAM"), v: c.teamSize });
  if (c.customers.length) facts.push({ k: ui(lang, "ลูกค้า", "CLIENTS"), v: String(c.customers.length) });
  if (projects.length) facts.push({ k: ui(lang, "ผลงาน", "PROJECTS"), v: String(projects.length) });

  const blocks = [
    { k: "about", label: ui(lang, "เกี่ยวกับเรา", "About"), text: t(c.about) },
    { k: "mission", label: ui(lang, "พันธกิจ", "Mission"), text: t(c.mission) },
    { k: "vision", label: ui(lang, "วิสัยทัศน์", "Vision"), text: t(c.vision) },
    { k: "story", label: ui(lang, "ที่มาของชื่อ", "The name"), text: t(c.story) },
  ].filter((b) => b.text);

  const ct = c.contact;
  const officeAddress = t(ct.officeAddress);
  const registeredAddress = t(ct.registeredAddress);

  return (
    <section id="utotech" className="sec utotech" aria-labelledby="utotech-title">
      <div className="wrap">
        <SectionHead
          no="02"
          kicker={ui(lang, "บริษัทของผม · คอนแทคชีต", "MY COMPANY · CONTACT SHEET")}
          title={c.shortName || t(c.name)}
          id="utotech-title"
          lead={t(c.tagline)}
        />

        {/* identity */}
        <div className="ut-id">
          <div className="ut-logo">
            {c.logo ? (
              <div className="paper-print px">
                <Print image={c.logo} width={120} aspect={1} develop reveal fit="contain" className="print--logo" />
              </div>
            ) : null}
            <p className="ut-mark lcd" aria-hidden="true">
              1A ▸ {c.shortName.toUpperCase()}
            </p>
          </div>
          <div className="ut-names">
            <p className="ut-name-th" lang="th">
              {c.name.th}
            </p>
            <p className="ut-name-en" lang="en">
              {c.name.en}
            </p>
            {t(c.role) ? (
              <p className="ut-role">
                <span className="badge lcd">{t(c.role)}</span> {t(profile.name)}
              </p>
            ) : null}
            {t(c.slogan) ? <p className="ut-slogan">{t(c.slogan)}</p> : null}
            {facts.length ? (
              <dl className="facts">
                {facts.map((f) => (
                  <div key={f.k} className="fact px">
                    <dt className="lcd">{f.k}</dt>
                    <dd>
                      <span className="fact-v lcd">
                        {f.v}
                        {f.note ? <sup aria-hidden="true">*</sup> : null}
                      </span>
                      {f.note ? <span className="sr-only">({f.note})</span> : null}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {t(c.foundedNote) && c.founded ? (
              <p className="fact-foot" aria-hidden="true">
                * {t(c.foundedNote)}
              </p>
            ) : null}
          </div>
          {c.cover ? (
            <div className="ut-cover">
              <Print image={c.cover} width={192} aspect={4 / 3} develop reveal />
            </div>
          ) : null}
        </div>

        {/* highlights: hanging prints */}
        {c.highlights.length ? (
          <div className="ut-block">
            <h3 className="sub-title">{ui(lang, "จุดเด่นของเรา", "What we do best")}</h3>
            <p className="sub-hint lcd">{ui(lang, "ชี้หรือแตะภาพเพื่อดูสีจริง", "Hover or tap a print to see the colour photo")}</p>
            <div className="line-wrap">
              <span className="hang-line" aria-hidden="true" />
              <ul className="hangers" role="list">
                {c.highlights.map((h, i) => (
                  <li key={i} className="hanger">
                    <span className="peg" aria-hidden="true" />
                    <div className="hang-paper">
                      {h.image ? <Print image={h.image} width={160} aspect={4 / 3} develop reveal /> : null}
                    </div>
                    <h4 className="hanger-title">{t(h.title)}</h4>
                    <p className="hanger-text">{t(h.description)}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}

        {/* about / mission / vision / story */}
        {blocks.length ? (
          <div className="ut-sheets">
            {blocks.map((b, i) => (
              <article key={b.k} className={`sheet sheet--${b.k}`}>
                <p className="sheet-no lcd" aria-hidden="true">
                  {String(i + 2).padStart(2, "0")}A
                </p>
                <h3 className="sheet-title">{b.label}</h3>
                {paragraphs(b.text).map((p, k) => (
                  <p key={k}>{p}</p>
                ))}
              </article>
            ))}
          </div>
        ) : null}

        {/* contact */}
        <div className="ut-block ut-contact">
          <h3 className="sub-title">{ui(lang, "ติดต่อ Utotech", "Contact Utotech")}</h3>
          <dl className="kv">
            {ct.email ? (
              <div>
                <dt>{ui(lang, "อีเมลบริษัท", "Company email")}</dt>
                <dd>
                  <a href={`mailto:${ct.email}`}>{ct.email}</a>
                </dd>
              </div>
            ) : null}
            {ct.ceoEmail ? (
              <div>
                <dt>{ui(lang, "อีเมล CEO", "CEO email")}</dt>
                <dd>
                  <a href={`mailto:${ct.ceoEmail}`}>{ct.ceoEmail}</a>
                </dd>
              </div>
            ) : null}
            {ct.phone ? (
              <div>
                <dt>{ui(lang, "โทรศัพท์", "Phone")}</dt>
                <dd>
                  <a href={telHref(ct.phone)}>{ct.phone}</a>
                </dd>
              </div>
            ) : null}
            {officeAddress ? (
              <div>
                <dt>{ui(lang, "ที่อยู่สำนักงาน", "Office")}</dt>
                <dd>{officeAddress}</dd>
              </div>
            ) : null}
            {registeredAddress ? (
              <div>
                <dt>{ui(lang, "ที่อยู่จดทะเบียน", "Registered address")}</dt>
                <dd>{registeredAddress}</dd>
              </div>
            ) : null}
            {ct.taxId ? (
              <div>
                <dt>{ui(lang, "เลขประจำตัวผู้เสียภาษี", "Tax ID")}</dt>
                <dd className="lcd kv-led">{ct.taxId}</dd>
              </div>
            ) : null}
          </dl>
          <LinkRow links={c.links} />
        </div>
      </div>
    </section>
  );
}
