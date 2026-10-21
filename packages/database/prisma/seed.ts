import { getDatabase } from '../src/client.js';
// Deliberately does not insert accounts, passwords, sample contacts, or production metrics.
const database = getDatabase();
await database.$queryRaw`SELECT 1`;
console.log(
  'Neon connection verified. No sample records inserted; register through the application.',
);
await database.$disconnect();
