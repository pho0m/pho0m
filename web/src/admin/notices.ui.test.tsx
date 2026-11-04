import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { type Link, type SaveContentResponse } from "@pho0m/content";
import { seed } from "@pho0m/content/seed";
import { createAdminApi, type AdminApi, type ContentReadResponse } from "./api.ts";
import { ApiProvider, ToastProvider } from "./context.tsx";
import { ContentWarningBanner } from "./Editor.tsx";
import { ContactField, UrlField } from "./fields/basic.tsx";
import { LinksEditor } from "./fields/LinksEditor.tsx";
import { Login } from "./Login.tsx";
import { HIDDEN_HINT } from "./notices.ts";
import { URL_ERROR } from "./urls.ts";
import { useDraft } from "./useDraft.ts";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

const DECRYPT = "drafts could not be decrypted; showing the published version";

/* ---------- URL fields ---------- */

function Url({ initial }: { initial: string }) {
  const [v, setV] = useState(initial);
  return <UrlField label="ลิงก์" value={v} onChange={setV} />;
}

describe("UrlField", () => {
  it("flags an unsafe URL as the owner types and clears once it is fixed", () => {
    render(<Url initial="" />);
    const input = screen.getByLabelText("ลิงก์");
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.change(input, { target: { value: "javascript:alert(1)" } });
    expect(screen.getByRole("alert").textContent).toBe(URL_ERROR);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(input, { target: { value: "https://github.com/pho0m" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(input.getAttribute("aria-invalid")).toBeNull();
  });

  it("is used for every link in the links editor (required there)", () => {
    const links: Link[] = [
      { kind: "website", label: "bad", url: "data:text/html,hi" },
      { kind: "email", label: "mail", url: "" },
      { kind: "github", label: "ok", url: "https://github.com/pho0m" },
    ];
    render(<LinksEditor value={links} onChange={() => undefined} />);
    const alerts = screen.getAllByRole("alert").map((a) => a.textContent);
    expect(alerts).toEqual([URL_ERROR, "ต้องกรอก URL"]);
  });
});

describe("ContactField", () => {
  it("says a hidden email is not published and is stored encrypted", () => {
    render(<ContactField label="อีเมล" type="email" value={{ value: "a@b.co", visible: false }} onChange={() => undefined} />);
    expect(screen.getByText(HIDDEN_HINT)).toBeTruthy();
  });
});

/* ---------- content warning ---------- */

describe("ContentWarningBanner", () => {
  it("shows the decrypt warning as an alert with what to do", () => {
    render(<ContentWarningBanner warning={DECRYPT} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("อ่านฉบับร่างและรายการที่ซ่อนไม่ได้");
    expect(alert.textContent).toContain("SESSION_SECRET");
    expect(alert.textContent).toContain(DECRYPT);
  });
  it("renders nothing without a warning", () => {
    const { container } = render(<ContentWarningBanner warning="" />);
    expect(container.innerHTML).toBe("");
  });
});

/* ---------- useDraft: warning + redeploy status after a save ---------- */

function fakeApi(get: Partial<ContentReadResponse>, save: Partial<SaveContentResponse>) {
  const api = {
    getContent: vi.fn(async () => ({ content: structuredClone(seed), generation: "1", url: null, ...get })),
    saveContent: vi.fn(async () => ({ generation: "2", updatedAt: "2026-11-04T01:00:00.000Z", url: null, ...save })),
  };
  return api as unknown as AdminApi & typeof api;
}

function Harness({ api }: { api: AdminApi }) {
  const d = useDraft(api, 0);
  return (
    <>
      <output data-testid="status">{d.status}</output>
      <output data-testid="warning">{d.warning}</output>
      <button type="button" onClick={() => void d.save()}>
        save
      </button>
    </>
  );
}

async function mountAndSave(api: AdminApi) {
  render(
    <ToastProvider>
      <Harness api={api} />
    </ToastProvider>,
  );
  await screen.findByText("ready");
  await act(async () => {
    fireEvent.click(screen.getByText("save"));
  });
  await screen.findByText(/^บันทึกแล้ว/);
}

describe("useDraft", () => {
  it("exposes the GET warning and clears it after a successful save", async () => {
    const api = fakeApi({ warning: DECRYPT }, { redeploy: "sent" });
    render(
      <ToastProvider>
        <Harness api={api} />
      </ToastProvider>,
    );
    await screen.findByText("ready");
    expect(screen.getByTestId("warning").textContent).toBe(DECRYPT);
    await act(async () => {
      fireEvent.click(screen.getByText("save"));
    });
    await screen.findByText(/^บันทึกแล้ว/);
    expect(screen.getByTestId("warning").textContent).toBe("");
  });

  it.each([
    ["sent", "สั่งอัปเดต SEO/README แล้ว (ประมาณ 2–5 นาที)"],
    ["queued", "จะอัปเดต SEO/README รอบถัดไป"],
    ["off", "SEO/README อัปเดตรอบรายวัน (ยังไม่ได้ตั้ง DISPATCH_TOKEN)"],
  ] as const)("adds the %s rebuild status to the save toast", async (redeploy, text) => {
    await mountAndSave(fakeApi({}, { redeploy }));
    expect(screen.getByText(text).closest(".toast-ok")).not.toBeNull();
    expect(document.querySelector(".toast-warn")).toBeNull();
  });

  it("shows a separate warning when the rebuild request failed", async () => {
    await mountAndSave(fakeApi({}, { redeploy: "failed" }));
    const warn = document.querySelector(".toast-warn");
    expect(warn?.textContent).toContain("สั่งอัปเดต SEO/README ไม่สำเร็จ");
    expect(warn?.textContent).toContain("Deploy");
    expect(document.querySelector(".toast-ok .toast-note")).toBeNull();
  });

  it("says nothing about the rebuild when an older API does not report it", async () => {
    await mountAndSave(fakeApi({}, {}));
    expect(document.querySelector(".toast-note")).toBeNull();
    expect(document.querySelector(".toast-warn")).toBeNull();
  });
});

/* ---------- login errors ---------- */

function loginWith(status: number, error: string) {
  const fetch = vi.fn(async () => ({
    ok: false,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify({ error }),
  }));
  const api = createAdminApi({ baseUrl: "", getToken: () => null, fetch: fetch as never });
  render(
    <ApiProvider value={api}>
      <Login health={{ status: "loading" }} onRetryHealth={() => undefined} apiLabel="/api" onLoggedIn={() => undefined} />
    </ApiProvider>,
  );
  fireEvent.change(screen.getByLabelText("รหัสผ่าน (Password)"), { target: { value: "secret" } });
  fireEvent.click(screen.getByRole("button", { name: "เข้าสู่ระบบ" }));
  return fetch;
}

describe("Login", () => {
  it("explains a 403 (origin not allowed) and shows this page's origin", async () => {
    const fetch = loginWith(403, "login is not allowed from this origin");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("ALLOWED_ORIGINS");
    expect(alert.textContent).toContain(`โดเมนนี้: ${window.location.origin}`);
    const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("explains a 415 without talking about file types", async () => {
    loginWith(415, "login needs Content-Type: application/json");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("โหลดหน้านี้ใหม่แล้วลองอีกครั้ง");
    expect(alert.textContent).not.toContain("JPG");
  });
});
