// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: false,
  retries: 1,
  workers: 1,
  timeout: 180000,         // 3 min per test (LLM streaming can be slow)
  reporter: [
    ['list'],
    ['json', { outputFile: './playwright_report.json' }],
    ['html', { outputFolder: './playwright_html_report', open: 'never' }],
  ],
  use: {
    baseURL: 'http://localhost:5173',
    browserName: 'chromium',
    headless: true,
    screenshot: 'on',
    video: 'off',
    trace: 'retain-on-failure',
    actionTimeout: 120000,
    navigationTimeout: 30000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
