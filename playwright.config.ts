import { defineConfig } from "@playwright/test";

const port = Number(process.env.PORT ?? 5850);

// The end-to-end tests drive the demo site, built from the current source. They use the server
// `bun run demo` keeps running, if there is one, and otherwise start one. They are named
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
    // The browser reports a light colour scheme whatever the operating system is set to, so the
    // page looks the same on every machine.
    colorScheme: "light",
    baseURL: `http://localhost:${port}`,
  },
  webServer: {
    command: "bun scripts/serve-demo.ts",
    url: `http://localhost:${port}/`,
    reuseExistingServer: !process.env.CI,
  },
});
