import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['reflect-metadata'],
    // Database tests need Postgres; CI runs them in the database job with `pnpm test:db`.
    exclude: ['test/db/**', 'node_modules/**', 'dist/**'],
  },
});
