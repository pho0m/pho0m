import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseContent, type Content } from "@pho0m/content";
import { errorMessage, isApiError, type AdminApi, type Issue } from "./api.ts";
import { useToast } from "./context.tsx";
import { clearDraft, loadDraft, storeDraft, type StoredDraft } from "./storage.ts";
import { validateDraft } from "./validate.ts";

export function timeLabel(d = new Date()): string {
  return d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/**
 * Owns the editable draft: loading from the API, dirty tracking, local validation,
 * saving with generation checks (409 → conflict), autosave to localStorage and restore.
 */
export function useDraft(api: AdminApi, authVersion: number) {
  const toast = useToast();
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  const [draft, setDraft] = useState<Content | null>(null);
  const [baseline, setBaseline] = useState("");
  const [generation, setGeneration] = useState<string | null>(null);
  const [contentUrl, setContentUrl] = useState<string | null>(null);
  const [restore, setRestore] = useState<StoredDraft | null>(null);
  const [loadIssues, setLoadIssues] = useState<Issue[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  const draftJson = useMemo(() => (draft ? JSON.stringify(draft) : ""), [draft]);
  const dirty = !!draft && draftJson !== baseline;

  const refs = useRef({ draft, generation, dirty, saving: false, status });
  refs.current.draft = draft;
  refs.current.generation = generation;
  refs.current.dirty = dirty;
  refs.current.status = status;

  const load = useCallback(
    async (offerRestore: boolean): Promise<boolean> => {
      if (refs.current.status !== "ready") setStatus("loading");
      try {
        const res = await api.getContent();
        const parsed = parseContent(res.content);
        const content = parsed.ok ? parsed.content : (res.content as Content);
        const json = JSON.stringify(content);
        setLoadIssues(parsed.ok ? [] : parsed.issues);
        setDraft(content);
        setBaseline(json);
        setGeneration(res.generation);
        setContentUrl(res.url);
        setIssues([]);
        if (offerRestore) {
          const stored = loadDraft();
          if (stored && JSON.stringify(stored.content) !== json) setRestore(stored);
          else {
            if (stored) clearDraft();
            setRestore(null);
          }
        }
        setStatus("ready");
        return true;
      } catch (e) {
        if (refs.current.status !== "ready") {
          setLoadError(errorMessage(e));
          setStatus("error");
        } else {
          toast.push({ kind: "error", text: "โหลดเวอร์ชันล่าสุดไม่สำเร็จ", detail: errorMessage(e) });
        }
        return false;
      }
    },
    [api, toast],
  );

  // first load, and retry after logging in again if it failed (e.g. 401)
  useEffect(() => {
    if (refs.current.status === "ready") return;
    void load(true);
  }, [load, authVersion]);

  // autosave the draft locally while it differs from the saved version
  useEffect(() => {
    if (!draft || restore || status !== "ready") return;
    if (!dirty) {
      clearDraft();
      return;
    }
    const t = window.setTimeout(() => {
      storeDraft({ content: draft, generation, savedAt: new Date().toISOString() });
    }, 700);
    return () => window.clearTimeout(t);
  }, [draft, dirty, generation, restore, status]);

  // warn before leaving with unsaved changes (and flush the autosave)
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const d = refs.current.draft;
      if (d) storeDraft({ content: d, generation: refs.current.generation, savedAt: new Date().toISOString() });
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // once issues are shown, re-check as the owner fixes them
  useEffect(() => {
    if (!issues.length || !draft) return;
    const t = window.setTimeout(() => {
      const r = validateDraft(draft);
      setIssues(r.ok ? [] : r.issues);
    }, 400);
    return () => window.clearTimeout(t);
  }, [draft]);

  const save = useCallback(
    async (force = false) => {
      const current = refs.current.draft;
      if (!current || refs.current.saving) return;
      const check = validateDraft(current);
      if (!check.ok) {
        setIssues(check.issues);
        toast.push({ kind: "error", text: `ยังบันทึกไม่ได้ — มี ${check.issues.length} จุดที่ต้องแก้ (ดูรายการด้านบน)` });
        return;
      }
      setIssues([]);
      refs.current.saving = true;
      setSaving(true);
      try {
        let gen = refs.current.generation;
        if (force) gen = (await api.getContent()).generation;
        const res = await api.saveContent({ content: check.content, generation: gen });
        const saved: Content = { ...check.content, updatedAt: res.updatedAt };
        const unchanged = refs.current.draft === current;
        setDraft((cur) => (cur === current ? saved : cur));
        setBaseline(JSON.stringify(saved));
        setGeneration(res.generation);
        if (res.url) setContentUrl(res.url);
        setConflict(false);
        setRestore(null);
        if (unchanged) clearDraft();
        const at = new Date();
        setLastSaved(at);
        const site = saved.site.url;
        toast.push({
          kind: "ok",
          text: `บันทึกแล้ว ${timeLabel(at)}`,
          detail: unchanged ? "เว็บจะแสดงเนื้อหาใหม่เมื่อรีเฟรช" : "มีการแก้ไขระหว่างบันทึก — ส่วนนั้นยังไม่ได้บันทึก",
          link: site ? { href: site, label: "เปิดเว็บจริง" } : undefined,
        });
      } catch (e) {
        if (isApiError(e) && e.kind === "conflict") {
          setConflict(true);
        } else if (isApiError(e) && e.kind === "invalid" && e.issues.length) {
          setIssues(e.issues);
          toast.push({ kind: "error", text: e.message, detail: "เซิร์ฟเวอร์ตรวจพบข้อมูลไม่ถูกต้อง" });
        } else if (isApiError(e) && e.kind === "unauthorized") {
          toast.push({ kind: "error", text: "เซสชันหมดอายุ — เข้าสู่ระบบแล้วกด “บันทึก” อีกครั้ง การแก้ไขยังอยู่ครบ" });
        } else {
          toast.push({ kind: "error", text: "บันทึกไม่สำเร็จ", detail: errorMessage(e) });
        }
      } finally {
        refs.current.saving = false;
        setSaving(false);
      }
    },
    [api, toast],
  );

  const reloadLatest = useCallback(async () => {
    const ok = await load(false);
    if (ok) {
      clearDraft();
      setConflict(false);
      toast.push({ kind: "info", text: "โหลดเวอร์ชันล่าสุดแล้ว (ทิ้งการแก้ไขในเครื่องนี้)" });
    }
  }, [load, toast]);

  const restoreDraft = useCallback(() => {
    if (!restore) return;
    setDraft(restore.content);
    // keep the generation the draft was based on: if the server changed since, saving gives 409
    setGeneration(restore.generation);
    setRestore(null);
    toast.push({ kind: "info", text: "กู้คืนฉบับร่างแล้ว — อย่าลืมกด “บันทึก”" });
  }, [restore, toast]);

  const discardRestore = useCallback(() => {
    clearDraft();
    setRestore(null);
  }, []);

  /** Write the draft to localStorage right now (before logging out). */
  const flush = useCallback(() => {
    const d = refs.current.draft;
    if (d && refs.current.dirty) storeDraft({ content: d, generation: refs.current.generation, savedAt: new Date().toISOString() });
  }, []);

  return {
    status,
    loadError,
    retry: () => void load(true),
    draft,
    draftJson,
    /** JSON of the version last loaded from / saved to the server (what the site shows). */
    savedJson: baseline,
    setDraft,
    dirty,
    generation,
    contentUrl,
    loadIssues,
    issues,
    saving,
    save,
    conflict,
    dismissConflict: () => setConflict(false),
    reloadLatest,
    lastSaved,
    restore,
    restoreDraft,
    discardRestore,
    flush,
  };
}

export type DraftStore = ReturnType<typeof useDraft>;
