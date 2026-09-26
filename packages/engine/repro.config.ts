// Runs the Playwright repro scripts Nomad generates for a run:
//   REPRO_DIR=runs/<run-id>/repro npm --workspace @nomad/engine run repro
// Every script is expected to FAIL while its bug exists and PASS once it is fixed.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: process.env.REPRO_DIR || 'runs',
  testMatch: /nle-\d+\.spec\.ts$/,
  timeout: 20000,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'runs/repro-results.json' }]],
  use: {
    headless: true,
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {},
  },
});
