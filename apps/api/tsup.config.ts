import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  outExtension: () => ({ js: '.mjs' }),
  target: 'node24',
  outDir: 'dist',
  // Throttler is CommonJS while Nest 12 is ESM. Bundle the Nest packages in
  // one module graph so function loaders never need require(ESM), and DI
  // tokens retain their identity across the framework and its extensions.
  noExternal: [/^@fileforge\//, /^@nestjs\/(?!(?:microservices|websockets)(?:\/|$))/],
  // Optional adapters and validation features are unused by this HTTP/Zod API.
  external: [
    '@nestjs/microservices',
    '@nestjs/microservices/*',
    '@nestjs/websockets',
    '@nestjs/websockets/*',
    '@fastify/static',
    'class-validator',
    'class-transformer',
    'class-transformer/*',
  ],
  clean: true,
  banner: {
    js: "import { createRequire as fileforgeCreateRequire } from 'node:module'; const require = fileforgeCreateRequire(import.meta.url);",
  },
});
