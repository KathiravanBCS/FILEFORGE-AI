import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client.js';

const globalDatabase = globalThis as unknown as { fileforgeDatabase?: PrismaClient };
/** Lazy initialization permits builds and public pages without cloud credentials. */
export function getDatabase(): PrismaClient {
  if (globalDatabase.fileforgeDatabase) return globalDatabase.fileforgeDatabase;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required to connect to Neon PostgreSQL.');
  const adapter = new PrismaPg({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  const database = new PrismaClient({ adapter, log: ['warn'] });
  globalDatabase.fileforgeDatabase = database;
  return database;
}
