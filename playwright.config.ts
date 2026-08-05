import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  globalTimeout: 180_000,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    actionTimeout: 10_000,
    baseURL: "http://127.0.0.1:3100",
    browserName: "chromium",
    navigationTimeout: 30_000,
    serviceWorkers: "block",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { viewport: { width: 1440, height: 900 } },
    },
    {
      name: "chromium-mobile",
      use: { viewport: { width: 390, height: 844 } },
    },
  ],
});
