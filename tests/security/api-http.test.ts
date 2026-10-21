import '../../apps/api/node_modules/reflect-metadata/Reflect.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Module, type INestApplication } from '../../apps/api/node_modules/@nestjs/common/index.js';
import { NestFactory } from '../../apps/api/node_modules/@nestjs/core/index.js';

const fixture = vi.hoisted(() => ({
  role: 'member' as string | null,
  getSession: vi.fn(),
  signedDownload: vi.fn(),
  upload: vi.fn(),
  fileQuery: vi.fn(),
  membershipQuery: vi.fn(),
}));
vi.mock('../../packages/database/src/index.ts', () => ({
  getAuth: () => ({ api: { getSession: fixture.getSession } }),
  getDatabase: () => ({
    member: { findFirst: fixture.membershipQuery },
    file: { findFirst: fixture.fileQuery },
  }),
}));
vi.mock('../../packages/integrations/src/index.ts', () => ({
  createTaskQueue: vi.fn(),
  enqueueTask: vi.fn(),
  objectKey: vi.fn(),
  validateImage: fixture.upload,
  MAX_IMAGE_BYTES: 20 * 1024 * 1024,
  R2Storage: { fromEnvironment: () => ({ signedDownload: fixture.signedDownload }) },
}));

import { AccountController, WorkspaceController } from '../../apps/api/src/modules/controller.js';
import { SessionGuard, WorkspaceGuard } from '../../apps/api/src/guards/auth.js';
import { SafeExceptionFilter } from '../../apps/api/src/common/errors.js';

class SecurityTestModule {}
Module({
  controllers: [AccountController, WorkspaceController],
  providers: [SessionGuard, WorkspaceGuard],
})(SecurityTestModule);

let app: INestApplication;
let baseURL: string;
const fileA = 'f9a5aa76-c0d8-40d4-971d-f2c6f37eb2fb';
const fileB = '2c7077ad-703f-4c98-a75e-e64a63f980f9';
const files = [
  {
    id: fileA,
    organizationId: 'tenant-a',
    originalName: 'owned-card.png',
    objectKey: 'workspaces/tenant-a/file-a.png',
    deletedAt: null,
    expiresAt: null,
  },
  {
    id: fileB,
    organizationId: 'tenant-b',
    originalName: 'private-card.png',
    objectKey: 'workspaces/tenant-b/file-b.png',
    deletedAt: null,
    expiresAt: null,
  },
];
const headers = (cookie = 'session=valid', workspace = 'tenant-a') => ({
  cookie,
  'x-workspace-id': workspace,
});

describe('HTTP authentication and tenant boundaries', () => {
  beforeAll(async () => {
    app = await NestFactory.create(SecurityTestModule, { logger: false });
    app.useGlobalFilters(new SafeExceptionFilter());
    await app.listen(0, '127.0.0.1');
    baseURL = await app.getUrl();
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    fixture.role = 'member';
    fixture.getSession.mockImplementation(
      async ({ headers: requestHeaders }: { headers: Headers }) => {
        if (requestHeaders.get('cookie') !== 'session=valid') return null;
        return { user: { id: 'user-a', email: 'a@example.test' }, session: { id: 'session-a' } };
      },
    );
    fixture.membershipQuery.mockImplementation(
      async ({ where }: { where: { organizationId: string; userId: string } }) =>
        where.userId === 'user-a' && where.organizationId === 'tenant-a' && fixture.role
          ? { role: fixture.role, userId: 'user-a', organizationId: 'tenant-a' }
          : null,
    );
    fixture.fileQuery.mockImplementation(
      async ({ where }: { where: { id: string; organizationId: string } }) =>
        files.find(
          (file) => file.id === where.id && file.organizationId === where.organizationId,
        ) ?? null,
    );
    fixture.signedDownload.mockResolvedValue(
      'https://private-storage.example.test/short-lived-signed-download',
    );
  });

  it('blocks unauthenticated HTTP callers before looking up membership or files', async () => {
    const response = await fetch(`${baseURL}/api/v1/files/${fileA}/download`, {
      headers: { 'x-user-id': 'user-a', 'x-workspace-id': 'tenant-a' },
    });
    expect(response.status).toBe(401);
    expect(fixture.getSession).not.toHaveBeenCalled();
    expect(fixture.membershipQuery).not.toHaveBeenCalled();
    expect(fixture.fileQuery).not.toHaveBeenCalled();
  });

  it('rejects an expired HTTP session even when its requested workspace is valid', async () => {
    const response = await fetch(`${baseURL}/api/v1/files/${fileA}/download`, {
      headers: headers('session=expired'),
    });
    expect(response.status).toBe(401);
    expect(fixture.membershipQuery).not.toHaveBeenCalled();
    expect(fixture.signedDownload).not.toHaveBeenCalled();
  });

  it('denies changing the workspace header to another organization', async () => {
    const response = await fetch(`${baseURL}/api/v1/files/${fileB}/download`, {
      headers: headers('session=valid', 'tenant-b'),
    });
    expect(response.status).toBe(403);
    expect(fixture.fileQuery).not.toHaveBeenCalled();
    expect(fixture.signedDownload).not.toHaveBeenCalled();
  });

  it('returns 404 for a known other-tenant file ID under the authorized workspace', async () => {
    const response = await fetch(`${baseURL}/api/v1/files/${fileB}/download`, {
      headers: headers(),
    });
    expect(response.status).toBe(404);
    expect(fixture.signedDownload).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain('private-card');
  });

  it('signs an owned file only after session and membership checks pass', async () => {
    const response = await fetch(`${baseURL}/api/v1/files/${fileA}/download`, {
      headers: headers(),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url: 'https://private-storage.example.test/short-lived-signed-download',
    });
    expect(fixture.signedDownload).toHaveBeenCalledOnce();
    expect(fixture.signedDownload).toHaveBeenCalledWith(
      'workspaces/tenant-a/file-a.png',
      'owned-card.png',
    );
  });

  it('rechecks membership on the next HTTP request after access is revoked', async () => {
    const first = await fetch(`${baseURL}/api/v1/files/${fileA}/download`, { headers: headers() });
    expect(first.status).toBe(200);
    fixture.role = null;
    const second = await fetch(`${baseURL}/api/v1/files/${fileA}/download`, { headers: headers() });
    expect(second.status).toBe(403);
    expect(fixture.signedDownload).toHaveBeenCalledOnce();
  });

  it('rejects viewer mutation before reading an uploaded image or accessing the queue', async () => {
    fixture.role = 'viewer';
    const response = await fetch(`${baseURL}/api/v1/scans`, {
      method: 'POST',
      headers: { ...headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileIds: [fileA] }),
    });
    expect(response.status).toBe(403);
    expect(fixture.upload).not.toHaveBeenCalled();
  });
});
