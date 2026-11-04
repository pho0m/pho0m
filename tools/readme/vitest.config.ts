import { defineConfig } from "vitest/config";

// Each test that renders the README builds every card and the film GIF (~1 s); give
// them room when the test files run in parallel on a slow CI machine.
export default defineConfig({ test: { testTimeout: 30_000 } });
