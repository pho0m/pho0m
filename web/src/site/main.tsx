import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../lib/theme.css";
import "./site.css";
import "./sections.css";
import { App } from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
