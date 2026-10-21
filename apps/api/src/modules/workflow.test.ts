import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedRequest } from '../common/context.js';
const mocks = vi.hoisted(() => ({
  fileCount: vi.fn(),
  jobCreate: vi.fn(),
  scanCreate: vi.fn(),
  auditCreate: vi.fn(),
  jobUpdate: vi.fn(),
  enqueue: vi.fn(),
  scanFind: vi.fn(),
  contactCreate: vi.fn(),
  contactFind: vi.fn(),
}));
vi.mock('@fileforge/database', () => {
  const tx = {
    file: { count: mocks.fileCount },
    processingJob: { create: mocks.jobCreate, updateMany: mocks.jobUpdate },
    businessCardScan: { create: mocks.scanCreate, findFirst: mocks.scanFind },
    auditLog: { create: mocks.auditCreate },
    contact: { create: mocks.contactCreate, findFirst: mocks.contactFind },
  };
  return {
    getDatabase: () => ({
      ...tx,
      $transaction: (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
    }),
    getAuth: vi.fn(),
  };
});
vi.mock('@fileforge/integrations', () => ({
  createTaskQueue: () => ({}),
  enqueueTask: mocks.enqueue,
  objectKey: vi.fn(),
  validateImage: vi.fn(),
  MAX_IMAGE_BYTES: 20971520,
  R2Storage: { fromEnvironment: vi.fn() },
}));
import { WorkspaceController } from './controller.js';
const fileId = 'f65ef20a-28ce-4aa5-b1a5-631430568194';
const jobId = '3864ca7e-dc59-4921-b502-d07c7f3c936c';
const request = {
  workspace: { id: 'organization', role: 'member' },
  principal: { userId: 'user' },
} as AuthenticatedRequest;
describe('Scan and review state transitions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fileCount.mockResolvedValue(1);
    mocks.jobCreate.mockResolvedValue({ id: jobId });
    mocks.scanCreate.mockResolvedValue({ id: 'scan', jobId, job: { status: 'queued' } });
    mocks.enqueue.mockResolvedValue({ id: jobId });
    mocks.jobUpdate.mockResolvedValue({ count: 1 });
  });
  it('rejects cross-tenant source images before creating a job', async () => {
    mocks.fileCount.mockResolvedValue(0);
    await expect(
      new WorkspaceController().createScan(request, { fileIds: [fileId] }),
    ).rejects.toThrow('unavailable in this workspace');
    expect(mocks.fileCount.mock.calls[0]?.[0]).toMatchObject({
      where: { id: { in: [fileId] }, organizationId: 'organization', deletedAt: null },
    });
    expect(mocks.jobCreate).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it('rejects duplicate front/back image IDs without database calls', async () => {
    await expect(
      new WorkspaceController().createScan(request, { fileIds: [fileId, fileId] }),
    ).rejects.toThrow('Each image must be unique');
    expect(mocks.fileCount).not.toHaveBeenCalled();
  });
  it('enqueues only tenant-scoped database job references', async () => {
    const result = await new WorkspaceController().createScan(request, { fileIds: [fileId] });
    expect(result.job.status).toBe('queued');
    expect(mocks.enqueue).toHaveBeenCalledWith(
      {},
      { jobId, organizationId: 'organization', type: 'scan' },
    );
  });
  it('persists a truthful retryable failure when the queue cannot accept work', async () => {
    mocks.enqueue.mockRejectedValue(new Error('redis unavailable'));
    await expect(
      new WorkspaceController().createScan(request, { fileIds: [fileId] }),
    ).rejects.toThrow('processing queue is unavailable');
    expect(mocks.jobUpdate).toHaveBeenCalledWith({
      where: { id: jobId, organizationId: 'organization', status: 'queued' },
      data: { status: 'failed', error: expect.stringContaining('queue is unavailable') },
    });
  });
  it('never approves extraction while its scan is still processing', async () => {
    mocks.scanFind.mockResolvedValue({ id: 'scan', jobId, job: { status: 'processing' } });
    await expect(
      new WorkspaceController().createContact(request, {
        scanId: fileId,
        data: {},
        status: 'approved',
      }),
    ).rejects.toThrow('not ready for review');
    expect(mocks.contactCreate).not.toHaveBeenCalled();
  });
  it.each(['completed', 'review'])(
    'rescans a %s scan into a new queued job without changing its approved contact',
    async (status) => {
      const original = {
        id: 'original-scan',
        jobId: 'original-job',
        job: { status },
        images: [{ fileId, position: 0 }],
        contacts: [{ id: 'approved-contact', status: 'approved' }],
      };
      mocks.scanFind.mockResolvedValue(original);
      mocks.scanCreate.mockResolvedValue({ id: 'new-scan', jobId, job: { status: 'queued' } });
      const result = await new WorkspaceController().rescan(request, 'original-scan');
      expect(result).toMatchObject({ id: 'new-scan', jobId, job: { status: 'queued' } });
      expect(mocks.scanFind.mock.calls[0]?.[0]).toMatchObject({
        where: { id: 'original-scan', organizationId: 'organization' },
      });
      expect(mocks.fileCount.mock.calls[0]?.[0]).toMatchObject({
        where: {
          id: { in: [fileId] },
          organizationId: 'organization',
          deletedAt: null,
          status: 'uploaded',
        },
      });
      expect(mocks.scanCreate.mock.calls[0]?.[0]).toMatchObject({
        data: {
          jobId,
          organizationId: 'organization',
          images: { create: [{ fileId, position: 0 }] },
        },
      });
      expect(mocks.enqueue).toHaveBeenCalledWith(
        {},
        { jobId, organizationId: 'organization', type: 'scan' },
      );
      expect(mocks.jobUpdate).not.toHaveBeenCalled();
      expect(mocks.contactCreate).not.toHaveBeenCalled();
      expect(original.job.status).toBe(status);
      expect(original.contacts).toEqual([{ id: 'approved-contact', status: 'approved' }]);
    },
  );
  it('does not rescan a known ID from another tenant', async () => {
    mocks.scanFind.mockResolvedValue(null);
    await expect(new WorkspaceController().rescan(request, 'foreign-scan')).rejects.toThrow(
      'Record not found',
    );
    expect(mocks.jobCreate).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it('revalidates source image availability when rescanning', async () => {
    mocks.scanFind.mockResolvedValue({ id: 'original-scan', images: [{ fileId }] });
    mocks.fileCount.mockResolvedValue(0);
    await expect(new WorkspaceController().rescan(request, 'original-scan')).rejects.toThrow(
      'unavailable in this workspace',
    );
    expect(mocks.jobCreate).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it('rejects viewer scan mutations before reading records', async () => {
    const viewer = {
      ...request,
      workspace: { id: 'organization', role: 'viewer' },
    } as AuthenticatedRequest;
    await expect(
      new WorkspaceController().createScan(viewer, { fileIds: [fileId] }),
    ).rejects.toThrow('read only');
    expect(mocks.fileCount).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});
