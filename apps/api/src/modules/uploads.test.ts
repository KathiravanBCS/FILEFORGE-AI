import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedRequest } from '../common/context.js';
const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  audit: vi.fn(),
  signedUpload: vi.fn(),
  inspect: vi.fn(),
  prefix: vi.fn(),
  promote: vi.fn(),
  delete: vi.fn(),
  signature: vi.fn(),
  transaction: vi.fn<(operation: () => Promise<unknown>) => Promise<unknown>>(),
}));
vi.mock('@fileforge/database', () => {
  const tx = {
    file: { findFirst: mocks.find, create: mocks.create, updateMany: mocks.update },
    auditLog: { create: mocks.audit },
  };
  return {
    getDatabase: () => ({
      ...tx,
      $transaction: (operation: (client: typeof tx) => Promise<unknown>) =>
        mocks.transaction(() => operation(tx)),
    }),
  };
});
vi.mock('@fileforge/integrations', () => ({
  MAX_IMAGE_BYTES: 20 * 1024 * 1024,
  objectKey: ({
    organizationId,
    fileId,
    extension,
  }: {
    organizationId: string;
    fileId: string;
    extension: string;
  }) => `workspaces/${organizationId}/${fileId}.${extension}`,
  quarantineKey: ({
    organizationId,
    fileId,
    extension,
  }: {
    organizationId: string;
    fileId: string;
    extension: string;
  }) => `quarantine/${organizationId}/${fileId}.${extension}`,
  validateImage: mocks.signature,
  R2Storage: {
    fromEnvironment: () => ({
      signedUpload: mocks.signedUpload,
      inspectObject: mocks.inspect,
      getPrefix: mocks.prefix,
      promoteQuarantined: mocks.promote,
      delete: mocks.delete,
    }),
  },
}));
import { DirectUploadsController } from './uploads.js';
const request = {
  workspace: { id: 'tenant', role: 'member' },
  principal: { userId: 'user' },
} as AuthenticatedRequest;
const pending = {
  id: 'file',
  organizationId: 'tenant',
  uploadedById: 'user',
  originalName: 'card.png',
  mimeType: 'image/png',
  size: 1234,
  objectKey: 'workspaces/tenant/file.png',
  status: 'pending',
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 600_000),
};
const ready = { ...pending, status: 'uploaded' };

describe('Quarantined direct R2 uploads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation((operation) => operation());
    mocks.find.mockReset();
    mocks.find.mockResolvedValueOnce(pending).mockResolvedValue(ready);
    mocks.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
      ...data,
      createdAt: new Date(),
    }));
    mocks.update.mockResolvedValue({ count: 1 });
    mocks.audit.mockResolvedValue({});
    mocks.signedUpload.mockResolvedValue('https://private-r2.example/signed-quarantine');
    mocks.inspect.mockResolvedValue({
      size: 1234,
      contentType: 'image/png',
      etag: '"immutable-etag"',
    });
    mocks.prefix.mockResolvedValue(Buffer.from('image-signature'));
    mocks.signature.mockResolvedValue({ mimeType: 'image/png', extension: 'png', size: 15 });
    mocks.promote.mockResolvedValue(undefined);
    mocks.delete.mockResolvedValue(undefined);
  });
  it('initializes a tenant-owned pending file and signs a size-bound quarantine upload', async () => {
    const result = await new DirectUploadsController().initiate(request, {
      originalName: 'C:\\fakepath\\card.png',
      mimeType: 'image/png',
      size: 1234,
    });
    expect(result.file.status).toBe('pending');
    expect(result.file.originalName).toBe('card.png');
    expect(mocks.create.mock.calls[0]?.[0].data).toMatchObject({
      organizationId: 'tenant',
      uploadedById: 'user',
      status: 'pending',
      size: 1234,
    });
    expect(mocks.signedUpload).toHaveBeenCalledWith(
      expect.stringMatching(/^quarantine\/tenant\//),
      'image/png',
      1234,
      300,
    );
    expect(result.upload).toMatchObject({
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      expiresIn: 300,
    });
  });
  it('rejects oversized initialization without allocating a file or URL', async () => {
    await expect(
      new DirectUploadsController().initiate(request, {
        originalName: 'card.png',
        mimeType: 'image/png',
        size: 20 * 1024 * 1024 + 1,
      }),
    ).rejects.toThrow('Check the submitted values');
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.signedUpload).not.toHaveBeenCalled();
  });
  it('validates size, signature and ETag before promoting and publishing the file', async () => {
    const result = await new DirectUploadsController().complete(request, 'file');
    expect(result.status).toBe('uploaded');
    expect(mocks.find.mock.calls[0]?.[0]).toMatchObject({
      where: { id: 'file', organizationId: 'tenant', uploadedById: 'user', deletedAt: null },
    });
    expect(mocks.update.mock.calls[0]?.[0]).toMatchObject({
      where: { status: 'pending' },
      data: { status: 'validating' },
    });
    expect(mocks.prefix).toHaveBeenCalledWith('quarantine/tenant/file.png', '"immutable-etag"');
    expect(mocks.promote).toHaveBeenCalledWith(
      'quarantine/tenant/file.png',
      'workspaces/tenant/file.png',
      '"immutable-etag"',
    );
    expect(mocks.update.mock.calls[1]?.[0]).toMatchObject({
      where: { status: 'validating' },
      data: { status: 'uploaded' },
    });
    expect(mocks.delete).toHaveBeenCalledWith('quarantine/tenant/file.png');
    expect(mocks.promote.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.update.mock.invocationCallOrder[1]!,
    );
  });
  it('never accesses storage for another tenant or uploader file ID', async () => {
    mocks.find.mockReset().mockResolvedValue(null);
    await expect(new DirectUploadsController().complete(request, 'foreign-file')).rejects.toThrow(
      'Record not found',
    );
    expect(mocks.inspect).not.toHaveBeenCalled();
    expect(mocks.promote).not.toHaveBeenCalled();
  });
  it('refuses concurrent completion before accessing storage', async () => {
    mocks.update.mockResolvedValueOnce({ count: 0 });
    await expect(new DirectUploadsController().complete(request, 'file')).rejects.toThrow(
      'already being verified',
    );
    expect(mocks.inspect).not.toHaveBeenCalled();
  });
  it('returns completed metadata idempotently without copying again', async () => {
    mocks.find.mockReset().mockResolvedValue(ready);
    expect((await new DirectUploadsController().complete(request, 'file')).status).toBe('uploaded');
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.promote).not.toHaveBeenCalled();
  });
  it('rejects and deletes a quarantined object with mismatched size', async () => {
    mocks.inspect.mockResolvedValue({ size: 9999, contentType: 'image/png', etag: '"tag"' });
    await expect(new DirectUploadsController().complete(request, 'file')).rejects.toThrow(
      'declared type or size',
    );
    expect(mocks.update.mock.calls[1]?.[0]).toMatchObject({ data: { status: 'rejected' } });
    expect(mocks.delete).toHaveBeenCalledWith('quarantine/tenant/file.png');
    expect(mocks.promote).not.toHaveBeenCalled();
  });
  it('rejects a forged image MIME type based on the object signature', async () => {
    mocks.signature.mockResolvedValue({ mimeType: 'image/jpeg', extension: 'jpg', size: 15 });
    await expect(new DirectUploadsController().complete(request, 'file')).rejects.toThrow(
      'signature',
    );
    expect(mocks.promote).not.toHaveBeenCalled();
    expect(mocks.update.mock.calls[1]?.[0]).toMatchObject({ data: { status: 'rejected' } });
  });
  it('resets a transient or conditional-copy failure to pending without publishing', async () => {
    mocks.promote.mockRejectedValueOnce(new Error('ETag changed'));
    await expect(new DirectUploadsController().complete(request, 'file')).rejects.toThrow(
      'could not be verified',
    );
    expect(mocks.update.mock.calls[1]?.[0]).toMatchObject({ data: { status: 'pending' } });
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it('does not publish a copied object if cleanup or expiry wins the final database claim', async () => {
    mocks.update.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await expect(new DirectUploadsController().complete(request, 'file')).rejects.toThrow(
      'no longer available',
    );
    expect(mocks.update.mock.calls[1]?.[0]).toMatchObject({
      where: { status: 'validating', expiresAt: { gt: expect.any(Date) } },
    });
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.delete).not.toHaveBeenCalledWith('workspaces/tenant/file.png');
  });
  it('retains a final object after an uncertain commit instead of deleting a possibly published file', async () => {
    mocks.transaction.mockImplementationOnce(async (operation) => {
      await operation();
      throw new Error('Commit response lost');
    });
    mocks.update
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    await expect(new DirectUploadsController().complete(request, 'file')).rejects.toThrow(
      'could not be verified',
    );
    expect(mocks.promote).toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalled();
    expect(mocks.delete).not.toHaveBeenCalledWith('workspaces/tenant/file.png');
  });
  it('rejects viewers before allocating or finalizing uploads', async () => {
    const viewer = {
      ...request,
      workspace: { id: 'tenant', role: 'viewer' },
    } as AuthenticatedRequest;
    await expect(
      new DirectUploadsController().initiate(viewer, {
        originalName: 'card.png',
        mimeType: 'image/png',
        size: 1234,
      }),
    ).rejects.toThrow('read only');
    await expect(new DirectUploadsController().complete(viewer, 'file')).rejects.toThrow(
      'read only',
    );
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.inspect).not.toHaveBeenCalled();
  });
});
