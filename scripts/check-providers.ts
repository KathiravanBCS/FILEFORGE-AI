/** Opt-in, read-only connectivity checks. Does not call inference or upload files. */
import { getDatabase } from '../packages/database/src/index.js';
import { createTaskQueue, R2Storage } from '../packages/integrations/src/index.js';

let failed = false;
async function check(name: string, run: () => Promise<void>) {
  try {
    await run();
    console.log(`${name}: passed`);
  } catch {
    failed = true;
    console.error(
      `${name}: failed — check credentials, TLS, provider health and network allowlists. No secret values are logged.`,
    );
  }
}
await check('Neon PostgreSQL', async () => {
  const db = getDatabase();
  try {
    await db.$queryRaw`SELECT 1`;
  } finally {
    await db.$disconnect();
  }
});
await check('Cloudflare R2 private bucket access', async () => {
  const storage = R2Storage.fromEnvironment();
  try {
    await storage.head();
  } finally {
    storage.close();
  }
});
await check('Upstash Redis TLS', async () => {
  const queue = createTaskQueue();
  queue.on('error', () => {});
  try {
    await queue.getJobCounts('waiting');
  } finally {
    await queue.close();
  }
});
await check('Configured Groq vision model availability', async () => {
  if (!process.env.GROQ_API_KEY) throw new Error('Missing key');
  const response = await fetch('https://api.groq.com/openai/v1/models', {
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error('Model listing failed');
  const result = (await response.json()) as { data: { id: string }[] };
  const model = process.env.GROQ_VISION_MODEL || 'qwen/qwen3.8-27b';
  if (!result.data.some((entry) => entry.id === model))
    throw new Error('Configured model unavailable');
  console.log('Model is listed; a real image inference is still required to verify capabilities.');
});
process.exitCode = failed ? 1 : 0;
