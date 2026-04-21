import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    // Playwright specs live under tests/e2e and use the Playwright
    // runner, not vitest. Excluding them here prevents vitest from
    // trying to import @playwright/test and failing.
    exclude: ["node_modules/**", "tests/e2e/**", "dist/**", ".next/**"],
  },
});
