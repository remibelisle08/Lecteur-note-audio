import { defineConfig, devices } from '@playwright/test';

/** Test bout en bout : l'app construite (`npm run build`) servie par `vite preview` sous son chemin de base. */
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: 0,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:4173/Lecteur-note-audio/',
    launchOptions: {
      // Chromium déjà installé localement : PW_CHROMIUM_PATH (absent en CI, où le navigateur est installé par Playwright).
      executablePath: process.env.PW_CHROMIUM_PATH || undefined,
      args: ['--autoplay-policy=no-user-gesture-required'],
    },
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/Lecteur-note-audio/',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
