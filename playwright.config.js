import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  use: {
    baseURL: 'http://127.0.0.1:5174',
    browserName: 'chromium',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
      args: process.env.PLAYWRIGHT_CHROMIUM_ARGS ? JSON.parse(process.env.PLAYWRIGHT_CHROMIUM_ARGS) : undefined,
    },
  },
  webServer: {
    command: 'VITE_API_URL=/ npm run dev -- --port 5174 --strictPort',
    url: 'http://127.0.0.1:5174', reuseExistingServer: false,
  },
});
