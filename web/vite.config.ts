/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Local admin API (npm run dev:api) — only used when VITE_API_URL is empty.
    proxy: { "/api": "http://localhost:8787" },
    fs: { allow: [r("..")] },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: { main: r("index.html"), admin: r("admin.html") },
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
