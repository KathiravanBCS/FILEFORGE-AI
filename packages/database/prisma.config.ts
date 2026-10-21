import { defineConfig } from 'prisma/config';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx --env-file-if-exists=../../.env prisma/seed.ts',
  },
  datasource: { url: process.env.DIRECT_URL || process.env.DATABASE_URL },
});
