import { describe, expect, it, vi } from 'vitest';
import type { getDatabase } from '@fileforge/database';
import type { ProcessingTask } from '@fileforge/integrations';
import { CancelledTaskError, InvalidTaskError, createTaskProcessor } from './tasks.js';

const task: ProcessingTask = {
  jobId: '6be3cb9c-55b4-4404-8a5f-6d6ea829ab10',
  organizationId: 'org-a',
  type: 'scan',
};
const job = {
  id: task.jobId,
  organizationId: task.organizationId,
  type: 'scan',
  status: 'queued',
  createdById: 'user-a',
};
function setup(overrides: Record<string, unknown> = {}) {
  const db = {
    processingJob: {
      findFirst: vi.fn().mockResolvedValue(job),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    member: { findUnique: vi.fn().mockResolvedValue({ role: 'member' }) },
    businessCardScan: { findFirst: vi.fn().mockResolvedValue(null) },
    ...overrides,
  };
  const storage = { get: vi.fn(), put: vi.fn(), delete: vi.fn() };
  const extractor = { extract: vi.fn() };
  return {
    db,
    storage,
    extractor,
    processor: createTaskProcessor({
      db: db as unknown as ReturnType<typeof getDatabase>,
      storage,
      extractor,
    }),
  };
}

describe('background worker authorization', () => {
  it('rejects forged cross-tenant job identifiers before accessing files or providers', async () => {
    const { processor, storage, extractor, db } = setup({
      processingJob: { findFirst: vi.fn().mockResolvedValue(null) },
    });
    await expect(processor({ ...task, organizationId: 'victim-org' })).rejects.toThrow('workspace');
    expect(db.member.findUnique).not.toHaveBeenCalled();
    expect(storage.get).not.toHaveBeenCalled();
    expect(extractor.extract).not.toHaveBeenCalled();
  });
  it('does not process a cancelled or already-reviewed scan again', async () => {
    for (const status of ['cancelled', 'review', 'completed']) {
      const { processor, extractor, db } = setup({
        processingJob: { findFirst: vi.fn().mockResolvedValue({ ...job, status }) },
      });
      await processor(task);
      expect(db.member.findUnique).not.toHaveBeenCalled();
      expect(extractor.extract).not.toHaveBeenCalled();
    }
  });
  it('does not mutate an existing job when a forged payload supplies its wrong task type', async () => {
    const { processor, db, extractor } = setup();
    await expect(processor({ ...task, type: 'export' })).rejects.toThrow(InvalidTaskError);
    expect(db.processingJob.updateMany).not.toHaveBeenCalled();
    expect(db.member.findUnique).not.toHaveBeenCalled();
    expect(extractor.extract).not.toHaveBeenCalled();
  });
  it('rejects a revoked creator and a viewer trying to process a card', async () => {
    for (const member of [null, { role: 'viewer' }]) {
      const { processor, storage, extractor } = setup({
        member: { findUnique: vi.fn().mockResolvedValue(member) },
      });
      await expect(processor(task)).rejects.toThrow('authorized');
      expect(storage.get).not.toHaveBeenCalled();
      expect(extractor.extract).not.toHaveBeenCalled();
    }
  });
  it('rejects cross-tenant scan images even if the job itself belongs to the caller', async () => {
    const { processor, storage, extractor } = setup({
      businessCardScan: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'scan-a',
          images: [{ file: { organizationId: 'victim-org', objectKey: 'secret' } }],
        }),
      },
    });
    await expect(processor(task)).rejects.toThrow('workspace');
    expect(storage.get).not.toHaveBeenCalled();
    expect(extractor.extract).not.toHaveBeenCalled();
  });
});

describe('business-card processing lifecycle', () => {
  const image = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/wSUAAAAASUVORK5CYII=',
    'base64',
  );
  const scan = {
    id: 'scan-a',
    createdById: 'user-a',
    images: [
      {
        file: {
          organizationId: 'org-a',
          mimeType: 'image/png',
          size: image.length,
          objectKey: 'workspaces/org-a/file.png',
        },
      },
    ],
  };
  const contact = {
    fullName: 'Ada',
    firstName: null,
    lastName: null,
    company: null,
    jobTitle: null,
    department: null,
    address: null,
    city: null,
    state: null,
    country: null,
    postalCode: null,
    notes: null,
    emails: [],
    phones: [],
    websites: [],
    socialLinks: [],
  };
  it('commits validated extraction for human review and token usage together without approving a contact', async () => {
    const tx = {
      processingJob: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      businessCardScan: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      usageRecord: { upsert: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const transaction = vi.fn((callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
    const { processor, storage, extractor } = setup({
      $transaction: transaction,
      businessCardScan: { findFirst: vi.fn().mockResolvedValue(scan) },
    });
    storage.get.mockResolvedValue(image);
    extractor.extract.mockResolvedValue({
      contact,
      model: 'configured-model',
      usage: { inputTokens: 40, outputTokens: 20, estimatedCost: null },
    });
    await processor(task);
    expect(tx.processingJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'review', progress: 100 }),
      }),
    );
    expect(tx.businessCardScan.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'scan-a', organizationId: 'org-a' },
        data: { extractedData: contact, model: 'configured-model' },
      }),
    );
    expect(tx.usageRecord.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { jobId_type: { jobId: task.jobId, type: 'scan' } },
        create: expect.objectContaining({ inputTokens: 40, outputTokens: 20 }),
      }),
    );
    expect(transaction).toHaveBeenCalledOnce();
  });
  it('honors cancellation after inference before committing any result or usage', async () => {
    const transaction = vi.fn();
    const updateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const { processor, storage, extractor } = setup({
      $transaction: transaction,
      processingJob: { findFirst: vi.fn().mockResolvedValue(job), updateMany },
      businessCardScan: { findFirst: vi.fn().mockResolvedValue(scan) },
    });
    storage.get.mockResolvedValue(image);
    extractor.extract.mockResolvedValue({
      contact,
      model: 'configured-model',
      usage: { inputTokens: 40, outputTokens: 20, estimatedCost: null },
    });
    await expect(processor(task)).rejects.toThrow(CancelledTaskError);
    expect(extractor.extract).toHaveBeenCalledOnce();
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe('expired direct-upload cleanup', () => {
  const cleanupTask = { ...task, type: 'cleanup' as const };
  const cleanupJob = { ...job, type: 'cleanup' };
  const pending = {
    id: 'pending-a',
    organizationId: 'org-a',
    status: 'pending',
    objectKey: 'workspaces/org-a/pending-a.png',
    expiresAt: new Date(Date.now() - 60_000),
    deletedAt: null,
  };

  function cleanupSetup(file = pending, claimCount = 1) {
    const fileUpdate = vi.fn().mockResolvedValue({ count: claimCount });
    const tx = {
      processingJob: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const result = setup({
      processingJob: {
        findFirst: vi.fn().mockResolvedValue(cleanupJob),
        findFirstOrThrow: vi.fn().mockResolvedValue(cleanupJob),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      member: { findUnique: vi.fn().mockResolvedValue({ role: 'owner' }) },
      file: { findMany: vi.fn().mockResolvedValue([file]), updateMany: fileUpdate },
      exportRecord: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn((callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    });
    return { ...result, fileUpdate };
  }

  it('removes the expired quarantine object and any private uncommitted copy', async () => {
    const { processor, storage, fileUpdate } = cleanupSetup();
    await processor(cleanupTask);
    expect(storage.delete.mock.calls).toEqual([
      ['quarantine/org-a/pending-a.png'],
      ['workspaces/org-a/pending-a.png'],
    ]);
    expect(fileUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'pending-a', status: 'purging' }),
        data: expect.objectContaining({ status: 'purged' }),
      }),
    );
  });

  it('preserves a final object if completion changed its state before cleanup could claim it', async () => {
    const { processor, storage } = cleanupSetup(pending, 0);
    await processor(cleanupTask);
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('rejects cross-tenant object metadata before deleting anything', async () => {
    const { processor, storage } = cleanupSetup({
      ...pending,
      objectKey: 'workspaces/victim/pending-a.png',
    });
    await expect(processor(cleanupTask)).rejects.toThrow('identity');
    expect(storage.delete).not.toHaveBeenCalled();
  });
});
