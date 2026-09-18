import { defineConfig, devices } from '@playwright/test'

const externalUrl = process.env.CORU_E2E_URL

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: externalUrl ?? 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: externalUrl ? undefined : {
    command: 'pnpm dev --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
  },
})
