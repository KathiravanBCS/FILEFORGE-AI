import { getDatabase, Prisma } from '@fileforge/database';
import { UnrecoverableError } from 'bullmq';
import { can, exportRequestSchema } from '@fileforge/shared';
import {
  type ContactExtractor,
  createContactsWorkbook,
  objectKey,
  type ProcessingTask,
  type R2Storage,
  validateImage,
} from '@fileforge/integrations';

type Database = ReturnType<typeof getDatabase>;
type Storage = Pick<R2Storage, 'get' | 'put' | 'delete'>;
export class CancelledTaskError extends Error {
  constructor() {
    super('Processing was cancelled.');
    this.name = 'CancelledTaskError';
  }
}
export class InvalidTaskError extends UnrecoverableError {
  constructor() {
    super('Job does not belong to this workspace or task type.');
    this.name = 'InvalidTaskError';
  }
}

/** All privileged values are reloaded from PostgreSQL; queue payloads carry identifiers only. */
export function createTaskProcessor(deps: {
  db: Database;
  storage: Storage;
  extractor: ContactExtractor;
}) {
  const { db, storage, extractor } = deps;

  async function progress(task: ProcessingTask, percent: number) {
    const changed = await db.processingJob.updateMany({
      where: { id: task.jobId, organizationId: task.organizationId, status: 'processing' },
      data: { progress: percent },
    });
    if (!changed.count) throw new CancelledTaskError();
  }

  async function scan(task: ProcessingTask) {
    const scan = await db.businessCardScan.findFirst({
      where: { jobId: task.jobId, organizationId: task.organizationId },
      include: { images: { include: { file: true }, orderBy: { position: 'asc' } } },
    });
    if (!scan || !scan.images.length || scan.images.length > 2)
      throw new Error('A valid workspace-owned scan with one or two images is required.');
    const images = [];
    for (const image of scan.images) {
      if (
        image.file.organizationId !== task.organizationId ||
        image.file.deletedAt ||
        (image.file.expiresAt && image.file.expiresAt < new Date())
      ) {
        throw new Error('A scan image is not available in this workspace.');
      }
      const bytes = await storage.get(image.file.objectKey);
      const detected = await validateImage(bytes);
      if (detected.mimeType !== image.file.mimeType || detected.size !== image.file.size)
        throw new Error('Stored image metadata does not match its contents.');
      images.push({ data: bytes, mimeType: detected.mimeType });
    }
    await progress(task, 30);
    const result = await extractor.extract(images);
    await progress(task, 85);
    await db.$transaction(async (tx) => {
      const claimed = await tx.processingJob.updateMany({
        where: { id: task.jobId, organizationId: task.organizationId, status: 'processing' },
        data: { status: 'review', progress: 100, completedAt: new Date(), error: null },
      });
      if (!claimed.count) throw new CancelledTaskError();
      await tx.businessCardScan.updateMany({
        where: { id: scan.id, organizationId: task.organizationId },
        data: { extractedData: result.contact as Prisma.InputJsonValue, model: result.model },
      });
      await tx.usageRecord.upsert({
        where: { jobId_type: { jobId: task.jobId, type: 'scan' } },
        update: {},
        create: {
          organizationId: task.organizationId,
          userId: scan.createdById,
          jobId: task.jobId,
          type: 'scan',
          quantity: 1,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          estimatedCost: result.usage.estimatedCost,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: task.organizationId,
          actorId: scan.createdById,
          action: 'scan.extracted',
          resourceType: 'scan',
          resourceId: scan.id,
        },
      });
    });
    // Contact creation deliberately happens only in the authenticated review-and-approval endpoint.
  }

  async function exportContacts(task: ProcessingTask) {
    const record = await db.exportRecord.findFirst({
      where: { jobId: task.jobId, organizationId: task.organizationId },
    });
    if (!record) throw new Error('Export does not exist in this workspace.');
    const filters = exportRequestSchema.parse(record.filters);
    const where: Prisma.ContactWhereInput = {
      organizationId: task.organizationId,
      deletedAt: null,
      ...(filters.ids ? { id: { in: filters.ids } } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.company ? { company: { contains: filters.company, mode: 'insensitive' } } : {}),
      ...(filters.jobTitle
        ? { jobTitle: { contains: filters.jobTitle, mode: 'insensitive' } }
        : {}),
      ...(filters.search
        ? {
            OR: [
              { fullName: { contains: filters.search, mode: 'insensitive' } },
              { company: { contains: filters.search, mode: 'insensitive' } },
              { emails: { some: { email: { contains: filters.search, mode: 'insensitive' } } } },
              { phones: { some: { number: { contains: filters.search } } } },
            ],
          }
        : {}),
    };
    const count = await db.contact.count({ where });
    const maximumRows = 25_000;
    if (count > maximumRows)
      throw new Error(
        'Export exceeds 25,000 contacts. Narrow the filters or split the export into batches.',
      );
    const contacts = [];
    let cursor: string | undefined;
    while (true) {
      const batch = await db.contact.findMany({
        where,
        include: { emails: true, phones: true, socialLinks: true },
        orderBy: { id: 'asc' },
        take: 500,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      contacts.push(...batch);
      if (contacts.length > maximumRows)
        throw new Error(
          'Export limit exceeded while contacts changed. Retry with narrower filters.',
        );
      await progress(
        task,
        Math.min(70, 10 + Math.round((60 * contacts.length) / Math.max(count, 1))),
      );
      if (batch.length < 500) break;
      cursor = batch.at(-1)?.id;
    }
    const key = objectKey({
      organizationId: task.organizationId,
      fileId: record.id,
      extension: 'xlsx',
    });
    // Retain the deterministic key before uploading, so failed uploads can be cleaned or retried.
    await db.exportRecord.updateMany({
      where: { id: record.id, organizationId: task.organizationId },
      data: { objectKey: key },
    });
    const body = await createContactsWorkbook(contacts);
    await progress(task, 85);
    await storage.put({
      key,
      body,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    try {
      await db.$transaction(async (tx) => {
        const claimed = await tx.processingJob.updateMany({
          where: { id: task.jobId, organizationId: task.organizationId, status: 'processing' },
          data: { status: 'completed', progress: 100, completedAt: new Date(), error: null },
        });
        if (!claimed.count) throw new CancelledTaskError();
        await tx.exportRecord.updateMany({
          where: { id: record.id, organizationId: task.organizationId },
          data: {
            count: contacts.length,
            fileName: `contacts-${record.id}.xlsx`,
            expiresAt: new Date(Date.now() + 7 * 86_400_000),
          },
        });
        await tx.usageRecord.upsert({
          where: { jobId_type: { jobId: task.jobId, type: 'export' } },
          update: {},
          create: {
            organizationId: task.organizationId,
            userId: record.createdById,
            jobId: task.jobId,
            type: 'export',
            quantity: contacts.length,
          },
        });
        await tx.auditLog.create({
          data: {
            organizationId: task.organizationId,
            actorId: record.createdById,
            action: 'export.completed',
            resourceType: 'export',
            resourceId: record.id,
          },
        });
      });
    } catch (error) {
      if (error instanceof CancelledTaskError) await storage.delete(key);
      throw error;
    }
  }

  async function cleanup(task: ProcessingTask) {
    const expiredFiles = await db.file.findMany({
      where: {
        organizationId: task.organizationId,
        OR: [{ expiresAt: { lte: new Date() } }, { deletedAt: { not: null } }],
        status: { not: 'purged' },
      },
      take: 100,
    });
    for (const file of expiredFiles) {
      await progress(task, 25);
      await storage.delete(file.objectKey);
      await db.file.updateMany({
        where: { id: file.id, organizationId: task.organizationId },
        data: { status: 'purged', deletedAt: file.deletedAt || new Date() },
      });
    }
    const expiredExports = await db.exportRecord.findMany({
      where: {
        organizationId: task.organizationId,
        expiresAt: { lte: new Date() },
        objectKey: { not: null },
      },
      take: 100,
    });
    for (const record of expiredExports) {
      await progress(task, 65);
      if (record.objectKey) await storage.delete(record.objectKey);
      await db.exportRecord.updateMany({
        where: { id: record.id, organizationId: task.organizationId },
        data: { objectKey: null },
      });
    }
    const job = await db.processingJob.findFirstOrThrow({
      where: { id: task.jobId, organizationId: task.organizationId },
    });
    await db.$transaction(async (tx) => {
      const claimed = await tx.processingJob.updateMany({
        where: { id: task.jobId, organizationId: task.organizationId, status: 'processing' },
        data: { status: 'completed', progress: 100, completedAt: new Date() },
      });
      if (!claimed.count) throw new CancelledTaskError();
      await tx.auditLog.create({
        data: {
          organizationId: task.organizationId,
          actorId: job.createdById,
          action: 'retention.cleaned',
          resourceType: 'job',
          resourceId: task.jobId,
          metadata: { files: expiredFiles.length, exports: expiredExports.length },
        },
      });
    });
  }

  return async (task: ProcessingTask, attempt = 1) => {
    const job = await db.processingJob.findFirst({
      where: { id: task.jobId, organizationId: task.organizationId },
    });
    if (!job || job.type !== task.type) throw new InvalidTaskError();
    if (['completed', 'review', 'cancelled'].includes(job.status)) return;
    const member = await db.member.findUnique({
      where: {
        organizationId_userId: { organizationId: task.organizationId, userId: job.createdById },
      },
    });
    const permission = task.type === 'cleanup' ? 'manage' : task.type === 'scan' ? 'write' : 'read';
    if (!member || !can(member.role, permission))
      throw new Error('The job creator is no longer authorized in this workspace.');
    const claimed = await db.processingJob.updateMany({
      where: {
        id: task.jobId,
        organizationId: task.organizationId,
        status: { in: ['queued', 'processing', 'failed'] },
      },
      data: {
        status: 'processing',
        progress: 5,
        attempts: attempt,
        startedAt: new Date(),
        error: null,
      },
    });
    if (!claimed.count) return;
    if (task.type === 'scan') return scan(task);
    if (task.type === 'export') return exportContacts(task);
    return cleanup(task);
  };
}
