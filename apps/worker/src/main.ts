import { Worker, UnrecoverableError } from 'bullmq';
import pino from 'pino';
import { getDatabase } from '@fileforge/database';
import {
  GroqExtractor,
  ProviderError,
  QUEUE_NAME,
  R2Storage,
  redisConnection,
  taskSchema,
  workerConcurrency,
} from '@fileforge/integrations';
import { CancelledTaskError, InvalidTaskError, createTaskProcessor } from './processors/tasks.js';

const logger = pino({
  redact: ['password', 'token', 'secret', 'authorization', 'cookie', '*.password', '*.token'],
});
const db = getDatabase();
const storage = R2Storage.fromEnvironment();
// Construction is lazy for Groq: export/cleanup workers remain useful without AI credentials.
const processor = createTaskProcessor({
  db,
  storage,
  extractor: { extract: (images) => GroqExtractor.fromEnvironment().extract(images) },
});
let activeJobs = 0;
const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const task = taskSchema.parse(job.data);
    activeJobs += 1;
    try {
      await processor(task, job.attemptsMade + 1);
    } catch (error) {
      if (error instanceof CancelledTaskError) return;
      if (error instanceof InvalidTaskError) throw error;
      const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      const message =
        error instanceof ProviderError
          ? error.message
          : 'Processing failed. Check worker diagnostics and provider configuration before retrying.';
      await db.processingJob.updateMany({
        where: {
          id: task.jobId,
          organizationId: task.organizationId,
          type: task.type,
          status: { notIn: ['cancelled', 'completed', 'review', 'failed'] },
        },
        data: {
          status: finalAttempt ? 'failed' : 'queued',
          error: message,
          ...(finalAttempt ? { completedAt: new Date() } : {}),
        },
      });
      logger.warn(
        {
          jobId: task.jobId,
          type: task.type,
          attempt: job.attemptsMade + 1,
          code: error instanceof ProviderError ? error.code : 'processing_failed',
        },
        'Background job failed',
      );
      throw new Error(message);
    } finally {
      activeJobs -= 1;
    }
  },
  {
    connection: redisConnection(process.env, 'worker'),
    concurrency: workerConcurrency(),
    drainDelay: 30,
    stalledInterval: 60_000,
    lockDuration: 120_000,
    maxStalledCount: 1,
  },
);

worker.on('ready', () =>
  logger.info(
    { concurrency: workerConcurrency() },
    'FileForge worker connected; TLS queue is ready',
  ),
);
worker.on('error', () =>
  logger.error(
    { code: 'queue_connection_error' },
    'Worker queue error; verify Redis TLS connectivity',
  ),
);
worker.on('failed', async (job, error) => {
  if (error instanceof InvalidTaskError) return;
  if (!job || !taskSchema.safeParse(job.data).success) return;
  // A malformed privileged payload is rejected without making arbitrary database changes.
  if (error instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1)) {
    const task = taskSchema.parse(job.data);
    await db.processingJob
      .updateMany({
        where: {
          id: task.jobId,
          organizationId: task.organizationId,
          type: task.type,
          status: { notIn: ['cancelled', 'completed', 'review', 'failed'] },
        },
        data: {
          status: 'failed',
          error: 'Background processing exhausted its retries.',
          completedAt: new Date(),
        },
      })
      .catch(() => logger.error({ jobId: task.jobId }, 'Could not persist failed job state'));
  }
});

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  logger.info({ signal }, 'Draining in-flight work');
  // Closing an unconnected, idle worker must not wait forever for Redis readiness.
  await worker.close(activeJobs === 0);
  storage.close();
  await db.$disconnect();
}
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
