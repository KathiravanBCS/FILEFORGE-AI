import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedRequest } from '../common/context.js';
const mocks = vi.hoisted(() => ({
  file: vi.fn(),
  scan: vi.fn(),
  job: vi.fn(),
  export: vi.fn(),
  contact: vi.fn(),
  signedDownload: vi.fn(),
}));
vi.mock('@fileforge/database', () => ({
  getDatabase: () => ({
    file: { findFirst: mocks.file },
    businessCardScan: { findFirst: mocks.scan },
    processingJob: { findFirst: mocks.job },
    exportRecord: { findFirst: mocks.export },
    contact: { findFirst: mocks.contact },
  }),
  getAuth: vi.fn(),
}));
vi.mock('@fileforge/integrations', () => ({
  createTaskQueue: vi.fn(),
  enqueueTask: vi.fn(),
  objectKey: vi.fn(),
  validateImage: vi.fn(),
  MAX_IMAGE_BYTES: 20971520,
  R2Storage: { fromEnvironment: () => ({ signedDownload: mocks.signedDownload }) },
}));
import { WorkspaceController } from './controller.js';
const request = {
  workspace: { id: 'allowed-tenant', role: 'member' },
  principal: { userId: 'user' },
} as AuthenticatedRequest;
describe('Tenant-scoped private records', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const name of ['file', 'scan', 'job', 'export', 'contact'] as const)
      mocks[name].mockResolvedValue(null);
  });
  it('never signs another tenant file even when its ID is known', async () => {
    await expect(
      new WorkspaceController().fileDownload(request, 'known-other-file'),
    ).rejects.toThrow('Record not found');
    expect(mocks.file).toHaveBeenCalledWith({
      where: {
        id: 'known-other-file',
        organizationId: 'allowed-tenant',
        deletedAt: null,
        status: 'uploaded',
      },
    });
    expect(mocks.signedDownload).not.toHaveBeenCalled();
  });
  it('never signs another tenant export', async () => {
    await expect(
      new WorkspaceController().exportDownload(request, 'known-other-export'),
    ).rejects.toThrow('Record not found');
    expect(mocks.export).toHaveBeenCalledWith({
      where: { id: 'known-other-export', organizationId: 'allowed-tenant' },
      include: { job: true },
    });
    expect(mocks.signedDownload).not.toHaveBeenCalled();
  });
  it('does not release export output before the job commits completion', async () => {
    mocks.export.mockResolvedValue({ objectKey: 'temporary-key', job: { status: 'processing' } });
    await expect(new WorkspaceController().exportDownload(request, 'export')).rejects.toThrow(
      'not ready',
    );
    expect(mocks.signedDownload).not.toHaveBeenCalled();
  });
  it('does not release expired exports', async () => {
    mocks.export.mockResolvedValue({
      objectKey: 'expired-key',
      job: { status: 'completed' },
      expiresAt: new Date(0),
    });
    await expect(new WorkspaceController().exportDownload(request, 'export')).rejects.toThrow(
      'expired',
    );
    expect(mocks.signedDownload).not.toHaveBeenCalled();
  });
  it('scopes job IDs and contact IDs to active tenant', async () => {
    const controller = new WorkspaceController();
    await expect(controller.job(request, 'other-job')).rejects.toThrow('Record not found');
    await expect(controller.contact(request, 'other-contact')).rejects.toThrow('Record not found');
    expect(mocks.job).toHaveBeenCalledWith({
      where: { id: 'other-job', organizationId: 'allowed-tenant' },
    });
    expect(mocks.contact).toHaveBeenCalledWith({
      where: { id: 'other-contact', organizationId: 'allowed-tenant', deletedAt: null },
      include: { emails: true, phones: true, socialLinks: true },
    });
  });
});
