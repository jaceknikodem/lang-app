import { defineConfig, devices } from '@playwright/test';

process.env.E2E_FORCE_LOCAL_SERVICES = '1';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // Electron tests should run sequentially
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 2, // More seems faster, but Ollama can handle too many requests.
  reporter: 'line',
  timeout: 60000, // Longer timeout for Electron app startup
  use: {
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'electron',
      use: { 
        ...devices['Desktop Chrome'],
        // Electron-specific settings
        headless: false, // Electron apps need to be visible
      },
    },
  ],

  // Remove webServer config as we launch Electron directly in tests
});
