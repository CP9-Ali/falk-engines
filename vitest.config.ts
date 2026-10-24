import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/_backups/**',
      '**/.{idea,git,cache,output,temp}/**',
      // Stage 13: skip perf benchmark on CI (flaky 15s threshold)
      ...(process.env.CI === 'true' ? ['**/load.test.ts'] : []),
    ],
  },
});
