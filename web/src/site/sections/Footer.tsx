import type { Content } from "@pho0m/content";
import { ui, useLang } from "../../lib/i18n.tsx";
import { A, LinkRow, SectionHead } from "../ui/bits.tsx";
import { hostOf, telHref } from "../util.ts";

export function Footer({ content }: { content: Content }) {
  const { lang, t } = useLang();
  const p = content.profile;
  const c = content.company;
  const year = new Date().getFullYear();
  const website = c.links.find((l) => l.kind === "website");
  const office = t(c.contact.officeAddress);

  return (
    <footer id="contact" className="footer" aria-labelledby="contact-title">
      <div className="wrap">
        <SectionHead
          no="07"
          kicker={ui(lang, "ติดต่อ", "CONTACT")}
          title={ui(lang, "คุยกันได้", "Get in touch")}
          id="contact-title"
          lead={ui(lang, "ติดต่อผมหรือทีม Utotech ได้ตามช่องทางนี้", "Reach me or the Utotech team here.")}
        />
        <div className="contact-grid">
          <div className="contact-card px">
            <h3 className="contact-h">{t(p.name)}</h3>
            <p className="contact-role">{t(p.role)}</p>
            <ul className="contact-list" role="list">
              {p.email.visible && p.email.value ? (
                <li>
                  <span className="lcd contact-k">@</span>
                  <a href={`mailto:${p.email.value}`}>{p.email.value}</a>
                </li>
              ) : null}
              {p.phone.visible && p.phone.value ? (
                <li>
                  <span className="lcd contact-k">TEL</span>
                  <a href={telHref(p.phone.value)}>{p.phone.value}</a>
                </li>
              ) : null}
            </ul>
            <LinkRow links={p.links} small />
          </div>
          <div className="contact-card px">
            <h3 className="contact-h">{t(c.name)}</h3>
            {t(c.tagline) ? <p className="contact-role">{t(c.tagline)}</p> : null}
            <ul className="contact-list" role="list">
              {c.contact.email ? (
                <li>
                  <span className="lcd contact-k">@</span>
                  <a href={`mailto:${c.contact.email}`}>{c.contact.email}</a>
                </li>
              ) : null}
              {c.contact.phone ? (
                <li>
                  <span className="lcd contact-k">TEL</span>
                  <a href={telHref(c.contact.phone)}>{c.contact.phone}</a>
                </li>
              ) : null}
              {website ? (
                <li>
                  <span className="lcd contact-k">WWW</span>
                  <A href={website.url}>{hostOf(website.url)}</A>
                </li>
              ) : null}
              {office ? (
                <li>
                  <span className="lcd contact-k">MAP</span>
                  <span>{office}</span>
                </li>
              ) : null}
            </ul>
          </div>
        </div>
        <div className="foot-bottom">
          <p className="lcd">
            © {year} pho0m <span aria-hidden="true">·</span> {ui(lang, "ล้างในห้องมืด", "developed in the darkroom")}
          </p>
          <a className="admin-link lcd" href="/admin">
            admin
          </a>
        </div>
      </div>
    </footer>
  );
}
