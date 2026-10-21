import { Queue, type JobsOptions, type ConnectionOptions } from 'bullmq';
import { z } from 'zod';

export const QUEUE_NAME = 'fileforge-processing';
export const taskSchema = z
  .object({
    jobId: z.string().uuid(),
    organizationId: z.string().min(1).max(128),
    type: z.enum(['scan', 'export', 'cleanup']),
  })
  .strict();
export type ProcessingTask = z.infer<typeof taskSchema>;
export const RETRY_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: { age: 86_400, count: 500 },
  removeOnFail: { age: 604_800, count: 500 },
};

export function redisConnection(
  env: NodeJS.ProcessEnv = process.env,
  role: 'producer' | 'worker' = 'producer',
): ConnectionOptions {
  if (!env.REDIS_URL) throw new Error('REDIS_URL is required for background processing.');
  const url = new URL(env.REDIS_URL);
  if (!['redis:', 'rediss:'].includes(url.protocol))
    throw new Error('REDIS_URL must use a Redis connection protocol, not the REST API.');
  if (!url.hostname.endsWith('.upstash.io') && !url.hostname.endsWith('.upstash.com'))
    throw new Error('REDIS_URL must reference the managed Upstash service.');
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: decodeURIComponent(url.username) || undefined,
    // Upstash sometimes supplies a redis:// URL. TLS is mandatory regardless of that spelling.
    password: decodeURIComponent(url.password) || undefined,
    tls: { servername: url.hostname },
    maxRetriesPerRequest: role === 'worker' ? null : 1,
    connectTimeout: 10_000,
    retryStrategy: (attempt: number) =>
      role === 'producer' && attempt > 3 ? null : Math.min(attempt * 1_000, 30_000),
    enableReadyCheck: false,
  };
}

export function createTaskQueue(env: NodeJS.ProcessEnv = process.env) {
  return new Queue<ProcessingTask>(QUEUE_NAME, {
    connection: redisConnection(env),
    defaultJobOptions: RETRY_OPTIONS,
  });
}

export async function enqueueTask(
  queue: ReturnType<typeof createTaskQueue>,
  input: ProcessingTask,
) {
  const task = taskSchema.parse(input);
  return queue.add(task.type, task, { jobId: task.jobId });
}

export function workerConcurrency(value = process.env.WORKER_CONCURRENCY) {
  const parsed = Number(value ?? 2);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10)
    throw new Error('WORKER_CONCURRENCY must be an integer between 1 and 10.');
  return parsed;
}
