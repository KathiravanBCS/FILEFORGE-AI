import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  outExtension: () => ({ js: '.mjs' }),
  target: 'node24',
  outDir: 'dist',
  noExternal: [/^@fileforge\//],
  clean: true,
  banner: {
    js: "import { createRequire as fileforgeCreateRequire } from 'node:module'; const require = fileforgeCreateRequire(import.meta.url);",
  },
});
