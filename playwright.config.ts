import { defineConfig, devices } from '@playwright/test';

// Один конфиг обслуживает локальный webServer, CI-стек и внешний production smoke-test.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.WEB_URL ?? 'http://127.0.0.1:4200',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // При внешнем стенде Playwright не пытается запустить второй локальный dev server.
  webServer: process.env.PLAYWRIGHT_EXTERNAL_SERVER
    ? undefined
    : {
        command: 'pnpm dev',
        // Запрос идёт через Angular proxy: один URL доказывает готовность и web, и Nest/PostgreSQL.
        url: 'http://127.0.0.1:4200/api/health/ready',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
