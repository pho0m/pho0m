import type { DocumentItem } from "@pho0m/content";
import { ui, useLang } from "../../lib/i18n.tsx";
import { A, SectionHead } from "../ui/bits.tsx";
import { Print } from "../ui/Print.tsx";
import { hostOf } from "../util.ts";

/** Documents that have a file/link; the section is hidden when none do. */
export function Documents({ documents }: { documents: DocumentItem[] }) {
  const { lang, t } = useLang();
  const docs = documents.filter((d) => d.url.trim());
  if (docs.length === 0) return null;
  return (
    <section id="documents" className="sec documents" aria-labelledby="documents-title">
      <div className="wrap">
        <SectionHead
          no="06"
          kicker={ui(lang, "ไฟล์และลิงก์", "FILES & LINKS")}
          title={ui(lang, "เอกสาร", "Documents")}
          id="documents-title"
        />
        <ul className="docs" role="list">
          {docs.map((d, i) => (
            <li key={d.id} className="doc px">
              {d.image ? <Print image={d.image} width={160} aspect={4 / 3} /> : null}
              <p className="doc-no lcd" aria-hidden="true">
                DOC {String(i + 1).padStart(2, "0")} · {hostOf(d.url)}
              </p>
              <h3 className="doc-title">{t(d.title)}</h3>
              {t(d.description) ? <p className="doc-desc">{t(d.description)}</p> : null}
              <A href={d.url} className="tlink doc-link">
                {ui(lang, "เปิด", "Open")} <span className="sr-only">{t(d.title)}</span> ↗
              </A>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
