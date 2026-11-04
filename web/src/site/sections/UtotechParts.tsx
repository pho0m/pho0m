import { useId, useRef, useState, type KeyboardEvent } from "react";
import type { Company, CompanyProject } from "@pho0m/content";
import { ui, useLang } from "../../lib/i18n.tsx";
import { A } from "../ui/bits.tsx";
import { Modal } from "../ui/Modal.tsx";
import { hostOf, paragraphs } from "../util.ts";

/** "Work with us" as accessible tabs (arrow keys move between tabs). */
export function WorkWithUs({ items }: { items: Company["workWithUs"] }) {
  const { lang, t } = useLang();
  const [active, setActive] = useState(0);
  const base = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  if (items.length === 0) return null;
  const cur = items[Math.min(active, items.length - 1)]!;

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null;
    if (e.key === "ArrowRight") next = (active + 1) % items.length;
    else if (e.key === "ArrowLeft") next = (active - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next === null) return;
    e.preventDefault();
    setActive(next);
    tabs.current[next]?.focus();
  };

  return (
    <div className="ut-block">
      <h3 className="sub-title">{ui(lang, "ทำงานกับเรา", "Work with us")}</h3>
      <div className="tabs" role="tablist" aria-label={ui(lang, "ทำงานกับเรา", "Work with us")} onKeyDown={onKey}>
        {items.map((it, i) => (
          <button
            key={i}
            ref={(el) => void (tabs.current[i] = el)}
            type="button"
            role="tab"
            id={`${base}-tab-${i}`}
            aria-selected={i === active}
            aria-controls={`${base}-panel`}
            tabIndex={i === active ? 0 : -1}
            className="tab"
            onClick={() => setActive(i)}
          >
            <span className="tab-no lcd" aria-hidden="true">
              {String(i + 1).padStart(2, "0")}
            </span>
            {t(it.title)}
          </button>
        ))}
      </div>
      <div className="tabpanel" role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${active}`}>
        <div className="tabpanel-text">
          <h4 className="tabpanel-head">{t(cur.heading)}</h4>
          {paragraphs(t(cur.description)).map((p, k) => (
            <p key={k}>{p}</p>
          ))}
        </div>
        {cur.image ? (
          <div className="tabpanel-img paper-print px">
            <img key={cur.image.url} src={cur.image.url} alt={t(cur.image.alt)} loading="lazy" decoding="async" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Services as a darkroom price list. */
export function Services({ services }: { services: Company["services"] }) {
  const { lang, t } = useLang();
  if (services.length === 0) return null;
  return (
    <div className="ut-block">
      <h3 className="sub-title">{ui(lang, "บริการและราคา", "Services & prices")}</h3>
      <ol className="pricelist" role="list">
        {services.map((s, i) => (
          <li key={s.id} className="price-row">
            <span className="price-no lcd" aria-hidden="true">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div className="price-main">
              <h4 className="price-title">{t(s.title)}</h4>
              {t(s.subtitle) ? <p className="price-sub">{t(s.subtitle)}</p> : null}
              <p className="price-desc">{t(s.description)}</p>
            </div>
            {s.image ? (
              <div className="price-img paper-print px">
                <img src={s.image.url} alt={t(s.image.alt)} loading="lazy" decoding="async" />
              </div>
            ) : null}
            {t(s.price) ? <p className="price-tag lcd">{t(s.price)}</p> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Company project grid; each card opens a modal with every feature. */
export function CompanyProjects({ projects }: { projects: CompanyProject[] }) {
  const { lang, t } = useLang();
  const [open, setOpen] = useState<CompanyProject | null>(null);
  if (projects.length === 0) return null;
  return (
    <div className="ut-block">
      <h3 className="sub-title">{ui(lang, "ผลงานของ Utotech", "Utotech projects")}</h3>
      <ul className="cp-grid" role="list">
        {projects.map((p, i) => (
          <li key={p.id} className="cp-card">
            <div className="cp-cover paper-print">
              {p.cover ? <img src={p.cover.url} alt={t(p.cover.alt)} loading="lazy" decoding="async" /> : null}
              {p.featured ? (
                <span className="cp-star lcd" title={ui(lang, "ผลงานเด่น", "Featured")}>
                  ★
                </span>
              ) : null}
            </div>
            <div className="cp-body">
              <p className="cp-cat lcd">
                ▸{i + 1}A · {p.category}
              </p>
              <h4 className="cp-name">{p.name}</h4>
              <p className="cp-sum">{t(p.summary)}</p>
              <button
                type="button"
                className="btn btn--ghost px cp-open"
                onClick={() => setOpen(p)}
                aria-haspopup="dialog"
              >
                {ui(lang, "ดูรายละเอียด", "Details")} <span className="sr-only">{p.name}</span> ▸
              </button>
            </div>
          </li>
        ))}
      </ul>
      {open ? <ProjectModal project={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function ProjectModal({ project: p, onClose }: { project: CompanyProject; onClose: () => void }) {
  const { lang, t } = useLang();
  const titleId = useId();
  const description = paragraphs(t(p.description));
  return (
    <Modal onClose={onClose} labelledBy={titleId} className="proj-modal">
      <header className="pj-head">
        {p.cover ? (
          <div className="pj-cover paper-print px">
            <img src={p.cover.url} alt={t(p.cover.alt)} />
          </div>
        ) : null}
        <div>
          <p className="pj-cat lcd">{p.category}</p>
          <h2 id={titleId} className="pj-title">
            {p.name}
          </h2>
          <p className="pj-sum">{t(p.summary)}</p>
          {p.url ? (
            <A href={p.url} className="btn btn--paper px pj-demo">
              {ui(lang, "เปิดเดโม", "Open demo")} · {hostOf(p.url)} ↗
            </A>
          ) : null}
        </div>
      </header>
      {description.length ? (
        <div className="pj-desc">
          {description.map((d, k) => (
            <p key={k}>{d}</p>
          ))}
        </div>
      ) : null}
      {p.features.length ? (
        <>
          <h3 className="pj-feat-title lcd">
            {ui(lang, "ฟีเจอร์", "FEATURES")} · {p.features.length}
          </h3>
          <ol className="pj-features" role="list">
            {p.features.map((f, k) => (
              <li key={k} className="pj-feature">
                {f.image ? (
                  <div className="pj-shot paper-print">
                    <img src={f.image.url} alt={t(f.image.alt) || t(f.title)} loading="lazy" decoding="async" />
                  </div>
                ) : null}
                <div>
                  <h4 className="pj-feature-title">
                    <span className="lcd" aria-hidden="true">
                      {String(k + 1).padStart(2, "0")}{" "}
                    </span>
                    {t(f.title)}
                  </h4>
                  {t(f.description) ? <p>{t(f.description)}</p> : null}
                </div>
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </Modal>
  );
}

/** Customer logo wall: grayscale until hover / focus. */
export function Customers({ customers }: { customers: Company["customers"] }) {
  const { lang, t } = useLang();
  if (customers.length === 0) return null;
  return (
    <div className="ut-block">
      <h3 className="sub-title">
        {ui(lang, "ลูกค้าของเรา", "Our clients")} <span className="sub-count lcd">{customers.length}</span>
      </h3>
      <ul className="logo-wall" role="list">
        {customers.map((c, i) => {
          const inner = (
            <>
              {c.logo ? (
                <img src={c.logo.url} alt={t(c.logo.alt) || c.name} loading="lazy" decoding="async" />
              ) : (
                <span className="logo-name">{c.name}</span>
              )}
            </>
          );
          return (
            <li key={`${c.name}-${i}`} className="logo-tile" title={c.name}>
              {c.url ? (
                <A href={c.url} className="logo-link" label={c.name}>
                  {inner}
                </A>
              ) : (
                inner
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
