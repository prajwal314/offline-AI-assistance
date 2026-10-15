// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './evaluation/tests',
  fullyParallel: false,       // Sequential — each test hits LLM, avoid flooding
  forbidOnly: false,
  retries: 1,
  workers: 1,
  timeout: 120000,            // 2 min per test (LLM can be slow)
  reporter: [
    ['list'],
    ['json', { outputFile: 'evaluation/playwright_report.json' }],
    ['html', { outputFolder: 'evaluation/playwright_html_report', open: 'never' }],
  ],
  use: {
    baseURL: 'http://localhost:5173',
    browserName: 'chromium',
    headless: true,
    screenshot: 'on',
    video: 'off',
    trace: 'retain-on-failure',
    actionTimeout: 90000,
    navigationTimeout: 30000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
