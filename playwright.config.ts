import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 240_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    ...devices["iPhone 14"],
    browserName: "chromium",
    permissions: ["clipboard-read", "clipboard-write"],
    trace: "retain-on-failure",
  },
  // Start the dev server automatically when it isn't already running.
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/api/me",
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
