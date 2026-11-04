import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { LangProvider, langFromUrl, langPath, urlForLang, useLang } from "../lib/i18n.tsx";

const here = () => `${location.pathname}${location.search}${location.hash}`;

function Probe() {
  const { lang, setLang } = useLang();
  return (
    <>
      <p data-testid="lang">{lang}</p>
      <button type="button" onClick={() => setLang("th")}>
        TH
      </button>
      <button type="button" onClick={() => setLang("en")}>
        EN
      </button>
    </>
  );
}

beforeEach(() => history.replaceState(null, "", "/"));
afterEach(cleanup);

describe("language from the URL", () => {
  it("reads /en/ as English and keeps ?lang working", () => {
    expect(langFromUrl({ pathname: "/en/", search: "" })).toBe("en");
    expect(langFromUrl({ pathname: "/en", search: "" })).toBe("en");
    expect(langFromUrl({ pathname: "/en/x", search: "?lang=th" })).toBe("en");
    expect(langFromUrl({ pathname: "/", search: "?lang=en" })).toBe("en");
    expect(langFromUrl({ pathname: "/", search: "?lang=th" })).toBe("th");
    expect(langFromUrl({ pathname: "/", search: "?lang=de" })).toBeNull();
    expect(langFromUrl({ pathname: "/entry", search: "" })).toBeNull();
    expect(langFromUrl({ pathname: "/", search: "" })).toBeNull();
  });

  it("builds the other language's URL: own path, hash kept, ?lang dropped", () => {
    expect(langPath("en")).toBe("/en/");
    expect(langPath("th")).toBe("/");
    expect(urlForLang("en", { pathname: "/", search: "?lang=th&x=1", hash: "#projects" })).toBe("/en/?x=1#projects");
    expect(urlForLang("th", { pathname: "/en/", search: "?lang=en", hash: "#film" })).toBe("/#film");
    // a site whose default language is English: "/" alone would not say Thai
    expect(urlForLang("th", { pathname: "/en/", search: "", hash: "" }, "en")).toBe("/?lang=th");
  });
});

describe("LangProvider routing", () => {
  it("starts in English on /en/ and in the default language on /", () => {
    history.replaceState(null, "", "/en/#skills");
    render(
      <LangProvider defaultLang="th">
        <Probe />
      </LangProvider>,
    );
    expect(screen.getByTestId("lang").textContent).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    cleanup();
    history.replaceState(null, "", "/");
    render(
      <LangProvider defaultLang="th">
        <Probe />
      </LangProvider>,
    );
    expect(screen.getByTestId("lang").textContent).toBe("th");
  });

  it("switching moves the address between / and /en/, keeps the hash and drops ?lang", () => {
    history.replaceState(null, "", "/?lang=en#projects");
    render(
      <LangProvider defaultLang="th">
        <Probe />
      </LangProvider>,
    );
    expect(screen.getByTestId("lang").textContent).toBe("en");
    // the old ?lang=en link is shown as the English page's own URL
    expect(here()).toBe("/en/#projects");
    act(() => screen.getByRole("button", { name: "TH" }).click());
    expect(screen.getByTestId("lang").textContent).toBe("th");
    expect(here()).toBe("/#projects");
    act(() => screen.getByRole("button", { name: "EN" }).click());
    expect(here()).toBe("/en/#projects");
    // what a reload would read
    expect(langFromUrl()).toBe("en");
  });

  it("follows the address on back/forward", () => {
    render(
      <LangProvider defaultLang="th">
        <Probe />
      </LangProvider>,
    );
    act(() => {
      history.replaceState(null, "", "/en/");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.getByTestId("lang").textContent).toBe("en");
  });

  it("leaves the URL alone with routing off", () => {
    history.replaceState(null, "", "/?lang=en");
    render(
      <LangProvider defaultLang="th" routing={false}>
        <Probe />
      </LangProvider>,
    );
    expect(here()).toBe("/?lang=en");
    act(() => screen.getByRole("button", { name: "TH" }).click());
    expect(screen.getByTestId("lang").textContent).toBe("th");
    expect(here()).toBe("/?lang=en");
  });
});
