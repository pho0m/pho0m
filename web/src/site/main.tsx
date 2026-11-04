import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../lib/theme.css";
import "./site.css";
import "./sections.css";
import { initialContent } from "../lib/content.ts";
import { App } from "./App.tsx";

// Read the content the build baked into the page before React replaces #root (and the snapshot in it).
void initialContent().then((initial) => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App initial={initial} />
    </StrictMode>,
  );
});
