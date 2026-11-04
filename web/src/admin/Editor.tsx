import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Content } from "@pho0m/content";
import type { Issue } from "./api.ts";
import { JumpProvider, MediaProvider, useApi, type Jump } from "./context.tsx";
import { SECTIONS, humanPath, isSectionId, sectionForPath, type SectionId } from "./sections.ts";
import { formatDateTime } from "./sections/HistorySection.tsx";
import { CompanySection } from "./sections/CompanySection.tsx";
import { DiarySection } from "./sections/DiarySection.tsx";
import { DocumentsSection } from "./sections/DocumentsSection.tsx";
import { HistorySection } from "./sections/HistorySection.tsx";
import { MediaSection } from "./sections/MediaSection.tsx";
import { ProfileSection } from "./sections/ProfileSection.tsx";
import { ProjectsSection } from "./sections/ProjectsSection.tsx";
import { SiteSection } from "./sections/SiteSection.tsx";
import { SkillsSection } from "./sections/SkillsSection.tsx";
import { TimelineSection } from "./sections/TimelineSection.tsx";
import { timeLabel, useDraft, type DraftStore } from "./useDraft.ts";
import { thaiMessage } from "./validate.ts";
import { Splash } from "./Splash.tsx";

function sectionFromHash(): SectionId {
  const h = window.location.hash.replace(/^#/, "");
  return isSectionId(h) ? h : "profile";
}

class SectionBoundary extends Component<{ children: ReactNode; onReset: () => void }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidCatch(error: Error) {
    console.error("Admin section crashed:", error);
  }
  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="banner banner-error px" role="alert">
        <strong>ส่วนนี้แสดงผลผิดพลาด</strong>
        <p className="small">{this.state.error.message}</p>
        <div className="btnrow">
          <button type="button" className="btn btn-sm" onClick={() => this.setState({ error: null })}>
            ลองใหม่
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              this.setState({ error: null });
              this.props.onReset();
            }}
          >
            โหลดเวอร์ชันล่าสุดจากเซิร์ฟเวอร์
          </button>
        </div>
      </div>
    );
  }
}

function IssuesPanel({ issues, onJump }: { issues: Issue[]; onJump: (path: string) => void }) {
  const headRef = useRef<HTMLHeadingElement>(null);
  const count = issues.length;
  useEffect(() => {
    if (count) headRef.current?.focus();
  }, [count]);
  if (!count) return null;
  return (
    <section className="banner banner-error px" aria-labelledby="issues-h">
      <h2 id="issues-h" ref={headRef} tabIndex={-1}>
        ต้องแก้ {count} จุดก่อนบันทึก
      </h2>
      <ul className="issues">
        {issues.slice(0, 40).map((i, k) => (
          <li key={`${i.path}-${k}`}>
            <button type="button" className="issue" onClick={() => onJump(i.path)}>
              <span className="issue-path">{humanPath(i.path)}</span>
              <span className="issue-msg">
                {thaiMessage(i.message)} <small className="muted">({i.message})</small>
              </span>
              <code className="issue-raw">{i.path}</code>
            </button>
          </li>
        ))}
      </ul>
      {count > 40 ? <p className="small muted">…และอีก {count - 40} จุด</p> : null}
    </section>
  );
}

function ConflictDialog({ d }: { d: DraftStore }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (d.conflict && !el.open) {
      if (typeof el.showModal === "function") el.showModal();
      else el.setAttribute("open", "");
    } else if (!d.conflict && el.open) el.close();
  }, [d.conflict]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  return (
    <dialog ref={ref} className="modal px" aria-labelledby="conflict-h" onClose={d.dismissConflict} onCancel={d.dismissConflict}>
      <h2 id="conflict-h">มีคนบันทึกไปก่อนแล้ว</h2>
      <p>
        เนื้อหาบนเซิร์ฟเวอร์ถูกบันทึกจากที่อื่น (แท็บหรืออุปกรณ์อื่น) หลังจากที่คุณเปิดหน้านี้ เลือกว่าจะทำอย่างไร:
      </p>
      <ul className="small">
        <li>
          <strong>โหลดเวอร์ชันล่าสุด</strong> — ทิ้งการแก้ไขในเครื่องนี้ แล้วใช้ของบนเซิร์ฟเวอร์
        </li>
        <li>
          <strong>บันทึกทับ</strong> — ใช้ฉบับร่างของคุณแทนที่ของบนเซิร์ฟเวอร์ (ของเดิมยังอยู่ในประวัติ)
        </li>
      </ul>
      <div className="btnrow">
        <button type="button" className="btn" disabled={busy} onClick={() => void run(d.reloadLatest)}>
          โหลดเวอร์ชันล่าสุด
        </button>
        <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void run(() => d.save(true))}>
          {busy ? "กำลังทำงาน…" : "บันทึกทับ"}
        </button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={d.dismissConflict}>
          ยกเลิก
        </button>
      </div>
    </dialog>
  );
}

export function Editor({
  authVersion,
  expiresAt,
  onLogout,
}: {
  authVersion: number;
  expiresAt: string | null;
  onLogout: () => void;
}) {
  const api = useApi();
  const d = useDraft(api, authVersion);
  const [section, setSectionState] = useState<SectionId>(sectionFromHash);
  const [jump, setJump] = useState<Jump>(null);
  const mainRef = useRef<HTMLElement>(null);

  const setSection = useCallback((id: SectionId) => {
    setSectionState(id);
    try {
      history.replaceState(null, "", `#${id}`);
    } catch {
      /* ignore */
    }
    mainRef.current?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  }, []);

  useEffect(() => {
    const onHash = () => setSectionState(sectionFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Ctrl/Cmd + S saves
  const save = d.save;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  const issueCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of d.issues) {
      const s = sectionForPath(i.path);
      if (s) m.set(s, (m.get(s) ?? 0) + 1);
    }
    return m;
  }, [d.issues]);

  const goToIssue = (path: string) => {
    const s = sectionForPath(path);
    if (s) setSection(s);
    setJump({ path, n: Date.now() });
  };

  if (d.status === "loading") return <Splash>กำลังโหลดเนื้อหา…</Splash>;
  if (d.status === "error" || !d.draft) {
    return (
      <Splash>
        <p className="err" role="alert">
          โหลดเนื้อหาไม่สำเร็จ: {d.loadError}
        </p>
        <div className="btnrow center">
          <button type="button" className="btn btn-primary" onClick={d.retry}>
            ลองใหม่
          </button>
          <button type="button" className="btn btn-ghost" onClick={onLogout}>
            ออกจากระบบ
          </button>
        </div>
      </Splash>
    );
  }

  const draft = d.draft;
  const set =
    <K extends keyof Content>(key: K) =>
    (v: Content[K]) =>
      d.setDraft((c) => (c ? { ...c, [key]: v } : c));
  const canSave = (d.dirty || d.generation === null) && !d.saving;
  const siteUrl = draft.site.url;
  const current = SECTIONS.find((s) => s.id === section)!;

  const renderSection = () => {
    switch (section) {
      case "profile":
        return <ProfileSection value={draft.profile} onChange={set("profile")} />;
      case "timeline":
        return <TimelineSection value={draft.timeline} onChange={set("timeline")} />;
      case "utotech":
        return <CompanySection value={draft.company} onChange={set("company")} />;
      case "projects":
        return <ProjectsSection value={draft.projects} onChange={set("projects")} />;
      case "skills":
        return <SkillsSection value={draft.skills} onChange={set("skills")} />;
      case "diary":
        return <DiarySection value={draft.diary} onChange={set("diary")} />;
      case "documents":
        return <DocumentsSection value={draft.documents} onChange={set("documents")} />;
      case "media":
        return <MediaSection contentJson={d.draftJson} />;
      case "history":
        return <HistorySection dirty={d.dirty} onLoad={(c) => d.setDraft(c)} />;
      case "site":
        return <SiteSection value={draft.site} onChange={set("site")} />;
    }
  };

  return (
    <MediaProvider>
      <JumpProvider value={jump}>
        <div className="adm">
          <a className="skip" href="#main">
            ข้ามไปยังเนื้อหา
          </a>
          <header className="adm-bar">
            <div className="brand">
              <span className="brand-name">pho0m</span>
              <span className="brand-sub">หลังบ้าน</span>
            </div>
            <div className="bar-status" aria-live="polite">
              <span className={`led${d.dirty ? " led-on" : ""}${d.saving ? " led-blink" : ""}`} aria-hidden="true" />
              <span className="lcd bar-state">
                {d.saving ? "SAVING…" : d.dirty ? "ยังไม่บันทึก" : d.lastSaved ? `บันทึก ${timeLabel(d.lastSaved)}` : "ตรงกับเว็บ"}
              </span>
              {draft.updatedAt ? (
                <span className="bar-meta hide-sm">แก้ล่าสุด {formatDateTime(draft.updatedAt)}</span>
              ) : (
                <span className="bar-meta hide-sm">ยังไม่เคยบันทึก (ใช้ seed)</span>
              )}
            </div>
            <div className="bar-actions">
              {d.issues.length ? (
                <button type="button" className="btn btn-warn btn-sm" onClick={() => d.issues[0] && goToIssue(d.issues[0].path)}>
                  ⚠ {d.issues.length}
                  <span className="sr-only"> จุดที่ต้องแก้</span>
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canSave}
                onClick={() => void d.save()}
                title="บันทึก (Ctrl+S)"
              >
                {d.saving ? <span className="spinner" aria-hidden="true" /> : null}
                {d.saving ? "กำลังบันทึก…" : "บันทึก"}
              </button>
              {siteUrl ? (
                <a className="btn btn-ghost btn-sm hide-sm" href={siteUrl} target="_blank" rel="noreferrer">
                  เปิดเว็บ ↗
                </a>
              ) : null}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  d.flush();
                  onLogout();
                }}
                title={expiresAt ? `เซสชันหมดอายุ ${formatDateTime(expiresAt)}` : undefined}
              >
                <span className="hide-sm">ออกจากระบบ</span>
                <span className="show-sm">ออก</span>
              </button>
            </div>
          </header>

          <nav className="adm-nav" aria-label="ส่วนของเนื้อหา">
            <ul>
              {SECTIONS.map((s) => {
                const n = issueCounts.get(s.id);
                return (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      aria-current={s.id === section ? "page" : undefined}
                      onClick={(e) => {
                        e.preventDefault();
                        setSection(s.id);
                      }}
                    >
                      <span className="nav-th">{s.th}</span>
                      <span className="nav-en">{s.en}</span>
                      {n ? (
                        <span className="nav-badge" aria-label={`${n} จุดที่ต้องแก้`}>
                          {n}
                        </span>
                      ) : null}
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>

          <main className="adm-main" id="main" ref={mainRef} tabIndex={-1} aria-label={current.th}>
            {d.restore ? (
              <div className="banner banner-warn px" role="status">
                <strong>พบฉบับร่างที่ยังไม่ได้บันทึก</strong>
                <p className="small">
                  แก้ไว้เมื่อ {d.restore.savedAt ? formatDateTime(d.restore.savedAt) : "ก่อนหน้านี้"} ในเบราว์เซอร์นี้
                  {d.restore.generation !== d.generation ? " · มีการบันทึกเวอร์ชันใหม่บนเซิร์ฟเวอร์หลังจากนั้น" : ""}
                </p>
                <div className="btnrow">
                  <button type="button" className="btn btn-primary btn-sm" onClick={d.restoreDraft}>
                    กู้คืนฉบับร่าง
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={d.discardRestore}>
                    ทิ้ง ใช้ของบนเซิร์ฟเวอร์
                  </button>
                </div>
              </div>
            ) : null}
            {d.loadIssues.length ? (
              <div className="banner banner-warn px" role="status">
                <strong>เนื้อหาบนเซิร์ฟเวอร์ไม่ผ่านการตรวจสอบ {d.loadIssues.length} จุด</strong>
                <p className="small">แก้ให้ถูกแล้วบันทึกใหม่ · เช่น {d.loadIssues[0]?.path}: {d.loadIssues[0]?.message}</p>
              </div>
            ) : null}
            <IssuesPanel issues={d.issues} onJump={goToIssue} />
            <SectionBoundary key={section} onReset={() => void d.reloadLatest()}>
              {renderSection()}
            </SectionBoundary>
          </main>
          <ConflictDialog d={d} />
        </div>
      </JumpProvider>
    </MediaProvider>
  );
}
