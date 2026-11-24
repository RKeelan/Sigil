import { defineConfig } from "@playwright/test";

// The end-to-end tests drive the demo page, which `bun run build:demo` builds. They are named
// `*.e2e.ts` so that `bun test` leaves them alone.
export default defineConfig({
  testDir: "e2e",
  testMatch: /.*\.e2e\.ts/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? "github" : "list",
  use: {
    browserName: "chromium",
    viewport: { width: 1000, height: 800 },
  },
});
