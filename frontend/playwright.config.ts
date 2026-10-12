import { defineConfig, devices } from "@playwright/test";

/** E2E runs against the full Docker Compose stack (`docker compose up`), through Caddy. */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  // Scenario tests sign up several users through real email verification.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /server-restart\.spec\.ts/,
    },
    {
      // Restarts the API container: runs alone, after everything else.
      name: "restart",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /server-restart\.spec\.ts/,
      dependencies: ["chromium"],
    },
  ],
});
