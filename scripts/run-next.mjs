import { fileURLToPath } from 'node:url';

// Loading in-process avoids Next propagating --env-file into a child NODE_OPTIONS.
try {
  process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const command = process.argv[2];
if (command === 'dev') process.env.NODE_ENV = 'development';
else if (command === 'build' || command === 'start') process.env.NODE_ENV = 'production';
await import('../apps/web/node_modules/next/dist/bin/next');
