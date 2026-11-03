import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['reflect-metadata'],
    include: ['test/db/**/*.test.ts'],
    // Tests share one database, so files run one after another.
    fileParallelism: false,
  },
});
