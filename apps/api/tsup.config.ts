import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { main: 'src/main.ts', migrate: 'src/db/migrate.ts' },
  format: ['cjs'],
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  // Workspace packages ship TypeScript source, so bundle them into the API build.
  noExternal: [/^@season\//],
});
