import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ database: vi.fn(), storage: vi.fn(), queue: vi.fn() }));
vi.mock('@fileforge/database', () => ({ getDatabase: () => ({ $queryRaw: mocks.database }) }));
vi.mock('@fileforge/integrations', () => ({
  R2Storage: { fromEnvironment: () => ({ head: mocks.storage }) },
}));
vi.mock('./controller.js', () => ({ checkApiQueue: mocks.queue }));

describe('API readiness independent of worker-only secrets', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('REDIS_URL', 'rediss://unit-test.upstash.io');
    vi.stubEnv('BETTER_AUTH_SECRET', 'x'.repeat(32));
    vi.stubEnv('GROQ_API_KEY', undefined);
    mocks.database.mockResolvedValue([{ result: 1 }]);
    mocks.storage.mockResolvedValue(undefined);
    mocks.queue.mockResolvedValue(undefined);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('reports API queue capability/readiness without requiring the external worker Groq secret', async () => {
    const { HealthController } = await import('./health.js');
    const controller = new HealthController();
    expect(controller.capabilities()).toMatchObject({
      processing: true,
      workerReadiness: 'not-checked',
    });
    expect(await controller.readiness()).toMatchObject({
      status: 'ok',
      checks: {
        database: true,
        storage: true,
        queue: true,
        authentication: true,
        queueConfigured: true,
      },
      note: expect.stringContaining('Worker availability and model availability are not checked'),
    });
  });
  it('does not consider an undersized authentication secret ready', async () => {
    vi.stubEnv('BETTER_AUTH_SECRET', 'too-short');
    const { HealthController } = await import('./health.js');
    await expect(new HealthController().readiness()).rejects.toMatchObject({
      status: 503,
      response: { checks: { authentication: false } },
    });
  });
  it('reports a failed real queue probe separately from configured credentials', async () => {
    mocks.queue.mockRejectedValue(new Error('queue unavailable'));
    const { HealthController } = await import('./health.js');
    await expect(new HealthController().readiness()).rejects.toMatchObject({
      status: 503,
      response: { checks: { queue: false, queueConfigured: true } },
    });
  });
});
