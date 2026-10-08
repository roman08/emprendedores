import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 4399);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: 'e2e',
  reporter: 'list',
  timeout: 60000,
  outputDir: 'qa-output/test-results',
  use: { baseURL, screenshot: 'only-on-failure', trace: 'off' },
  webServer: {
    command: `npx astro dev --port ${port} --ignore-lock`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    {
      name: 'mobile',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
});
