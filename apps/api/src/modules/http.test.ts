import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  member: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
}));
vi.mock('@fileforge/database', () => ({
  getAuth: () => ({ api: { getSession: mocks.session } }),
  getDatabase: () => ({
    member: { findFirst: mocks.member },
    contact: { findMany: mocks.findMany, count: mocks.count },
    $transaction: (operations: Promise<unknown>[]) => Promise.all(operations),
  }),
}));
vi.mock('@fileforge/integrations', () => ({
  createTaskQueue: vi.fn(),
  enqueueTask: vi.fn(),
  objectKey: vi.fn(),
  validateImage: vi.fn(),
  MAX_IMAGE_BYTES: 20971520,
  R2Storage: { fromEnvironment: vi.fn() },
}));
import { AccountController, WorkspaceController } from './controller.js';
import { SessionGuard, WorkspaceGuard } from '../guards/auth.js';
import { SafeExceptionFilter } from '../common/errors.js';
@Module({
  controllers: [AccountController, WorkspaceController],
  providers: [SessionGuard, WorkspaceGuard],
})
class TestModule {}

describe('Protected HTTP contact API', () => {
  let app: INestApplication;
  let baseUrl: string;
  beforeAll(async () => {
    app = await NestFactory.create(TestModule, { logger: false });
    app.useGlobalFilters(new SafeExceptionFilter());
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({
      user: { id: 'user', email: 'user@example.test' },
      session: { id: 'session' },
    });
    mocks.member.mockResolvedValue({ role: 'member' });
    mocks.findMany.mockResolvedValue([]);
    mocks.count.mockResolvedValue(0);
  });
  it('returns 401 before reading records for unauthenticated requests', async () => {
    const response = await fetch(`${baseUrl}/api/v1/contacts`);
    expect(response.status).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
  it('rejects a valid session that requests another organization', async () => {
    mocks.member.mockResolvedValue(null);
    const response = await fetch(`${baseUrl}/api/v1/contacts`, {
      headers: { cookie: 'session=valid', 'x-workspace-id': 'another-org' },
    });
    expect(response.status).toBe(403);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
  it('validates server pagination rather than accepting unbounded queries', async () => {
    const response = await fetch(`${baseUrl}/api/v1/contacts?pageSize=100000`, {
      headers: { cookie: 'session=valid', 'x-workspace-id': 'our-org' },
    });
    expect(response.status).toBe(400);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
  it('executes tenant-scoped server pagination and filtering', async () => {
    const response = await fetch(
      `${baseUrl}/api/v1/contacts?page=2&pageSize=10&search=Acme&sort=company&direction=asc`,
      { headers: { cookie: 'session=valid', 'x-workspace-id': 'our-org' } },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [], total: 0, page: 2, pageSize: 10 });
    expect(mocks.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: { organizationId: 'our-org', deletedAt: null },
      orderBy: [{ company: 'asc' }, { id: 'asc' }],
      skip: 10,
      take: 10,
    });
  });
});
