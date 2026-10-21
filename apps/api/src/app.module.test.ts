import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

vi.mock('@fileforge/database', () => ({ getDatabase: vi.fn(), getAuth: vi.fn() }));
vi.mock('@fileforge/integrations', () => ({
  createTaskQueue: vi.fn(),
  enqueueTask: vi.fn(),
  objectKey: vi.fn(),
  validateImage: vi.fn(),
  MAX_IMAGE_BYTES: 20 * 1024 * 1024,
  R2Storage: { fromEnvironment: vi.fn() },
}));

import { AppModule } from './app.module.js';
import { SafeExceptionFilter } from './common/errors.js';

describe('Actual application module', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    app.useGlobalFilters(new SafeExceptionFilter());
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('boots the production module, protects data, and enforces the configured rate limit', async () => {
    const health = await fetch(`${baseUrl}/api/v1/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: 'ok', service: 'fileforge-api' });

    const contacts = await fetch(`${baseUrl}/api/v1/contacts`);
    expect(contacts.status).toBe(401);

    const statuses: number[] = [];
    let retryAfter: string | null = null;
    for (let request = 0; request < 120; request++) {
      const response = await fetch(`${baseUrl}/api/v1/health`);
      statuses.push(response.status);
      if (response.status === 429) retryAfter = response.headers.get('retry-after');
      await response.arrayBuffer();
    }
    expect(statuses.filter((status) => status === 200)).toHaveLength(119);
    expect(statuses.filter((status) => status === 429)).toHaveLength(1);
    expect(Number(retryAfter)).toBeGreaterThan(0);
  });
});
