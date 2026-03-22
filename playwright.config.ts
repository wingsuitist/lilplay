import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:18082',
    headless: true,
  },
  webServer: {
    command: 'DATA_PATH=./fixtures/data.test.json PORT=18082 PUBLIC_DIR=./public deno run --allow-net --allow-read --allow-write --allow-env server/main.ts',
    port: 18082,
    reuseExistingServer: false,
    timeout: 10_000,
  },
});
